/**
 * AirBrowse Crawl Manager
 *
 * BFS multi-page crawler that runs in the Chrome extension background service
 * worker. It navigates a tab between pages on the same domain, extracts
 * content via content-script messages, and reports progress through a
 * configurable callback.
 */

class CrawlManager {
  constructor(options = {}) {
    this.maxDepth = options.maxDepth ?? 2;
    this.maxPages = options.maxPages ?? 50;
    this.sameDomainOnly = options.sameDomainOnly ?? true;
    this.delayMs = options.delayMs ?? 1000;
    this.followSitemaps = options.followSitemaps ?? true;

    this.visited = new Set();
    this.results = new Map();
    this.queue = []; // [{url, depth}]
    this.cancelled = false;
    this.running = false;
    this.tabId = null;

    this.onProgress = null; // ({visited, queued, current, total}) => void
    this.onComplete = null; // (results) => void
    this.onError = null;    // (error) => void
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Set the tab that this crawl manager will drive.
   * @param {number} tabId
   */
  setTabId(tabId) {
    this.tabId = tabId;
  }

  /**
   * Set progress callback. Receives crawl status updates suitable for
   * forwarding through the WebSocket relay as crawl.progress events.
   * @param {Function} fn
   */
  setProgressCallback(fn) {
    this.onProgress = fn;
  }

  // -------------------------------------------------------------------------
  // URL helpers
  // -------------------------------------------------------------------------

  /**
   * Normalize a URL for deduplication: strip hash, trailing slash (except
   * root), lowercase hostname.
   * @param {string} rawUrl
   * @returns {string}
   */
  normalizeUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      u.hash = '';
      // Lowercase hostname (URL constructor already does this, but be explicit)
      u.hostname = u.hostname.toLowerCase();
      let href = u.href;
      // Remove trailing slash unless the path is exactly "/"
      if (u.pathname !== '/' && href.endsWith('/')) {
        href = href.slice(0, -1);
      }
      return href;
    } catch {
      return rawUrl;
    }
  }

  /**
   * Check whether two URLs share the same hostname.
   * @param {string} url
   * @param {string} referenceUrl
   * @returns {boolean}
   */
  isSameDomain(url, referenceUrl) {
    try {
      const a = new URL(url);
      const b = new URL(referenceUrl);
      return a.hostname.toLowerCase() === b.hostname.toLowerCase();
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Sitemap parsing
  // -------------------------------------------------------------------------

  /**
   * Parse a sitemap (or sitemap index) XML string and return an array of
   * same-domain URLs.
   * @param {string} xmlText
   * @param {string} referenceUrl
   * @returns {string[]}
   */
  parseSitemap(xmlText, referenceUrl) {
    const urls = [];
    // Match <loc>...</loc> entries from both <url> and <sitemap> elements
    const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
    let match;
    while ((match = locRegex.exec(xmlText)) !== null) {
      const loc = match[1].trim();
      if (loc && this.isSameDomain(loc, referenceUrl)) {
        const normalized = this.normalizeUrl(loc);
        if (normalized) {
          urls.push(normalized);
        }
      }
    }
    return urls;
  }

  /**
   * Attempt to fetch and parse the sitemap at the given origin. Returns an
   * array of discovered URLs, or an empty array on failure.
   * @param {string} origin
   * @param {string} referenceUrl
   * @returns {Promise<string[]>}
   */
  async fetchSitemap(origin, referenceUrl) {
    const sitemapUrl = `${origin}/sitemap.xml`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(sitemapUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'application/xml, text/xml, */*' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) return [];

      const text = await response.text();
      return this.parseSitemap(text, referenceUrl);
    } catch {
      // Network error, timeout, or parse failure — not critical
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Tab navigation & content extraction
  // -------------------------------------------------------------------------

  /**
   * Navigate the managed tab to a URL and wait for it to finish loading.
   * @param {string} url
   * @returns {Promise<void>}
   */
  async navigateAndWait(url) {
    if (this.tabId == null) {
      throw new Error('CrawlManager: no tabId set — call setTabId() first');
    }

    await chrome.tabs.update(this.tabId, { url });

    return new Promise((resolve, reject) => {
      const NAV_TIMEOUT_MS = 30000;

      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        // Resolve instead of reject — partial loads are still useful
        resolve();
      }, NAV_TIMEOUT_MS);

      const listener = (tabId, changeInfo) => {
        if (tabId === this.tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          // Brief settle delay so content scripts can initialize
          setTimeout(resolve, 300);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  /**
   * Send a message to the content script on the managed tab with a timeout.
   * Returns null if the message fails (e.g., no content script injected).
   * @param {string} action
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  async sendToContentScript(action, params = {}) {
    const SEND_TIMEOUT_MS = 10000;

    try {
      const result = await Promise.race([
        chrome.tabs.sendMessage(this.tabId, { action, params }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Content script timeout')), SEND_TIMEOUT_MS)
        ),
      ]);
      if (result && result.error) return null;
      return result?.result ?? result ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Extract all useful page data from the current tab via content script
   * messages.
   * @returns {Promise<object>}
   */
  async extractPageData() {
    // Fire all extraction requests in parallel for speed
    const [text, markdown, tables, tabInfo] = await Promise.all([
      this.sendToContentScript('page.getText'),
      this.sendToContentScript('page.getMarkdown'),
      this.sendToContentScript('page.getTables'),
      chrome.tabs.get(this.tabId).catch(() => null),
    ]);

    return {
      title: tabInfo?.title || '',
      url: tabInfo?.url || '',
      text: text || '',
      markdown: markdown || '',
      tables: tables || [],
    };
  }

  /**
   * Get all links from the current page via the content script.
   * @returns {Promise<string[]>}
   */
  async getPageLinks() {
    const result = await this.sendToContentScript('page.getLinks');
    if (Array.isArray(result)) return result;
    // The content script might return {links: [...]} or similar
    if (result && Array.isArray(result.links)) return result.links;
    return [];
  }

  // -------------------------------------------------------------------------
  // Queue helpers
  // -------------------------------------------------------------------------

  /**
   * Enqueue a URL if it hasn't been visited or already queued, and if it
   * passes the same-domain check.
   * @param {string} rawUrl
   * @param {number} depth
   * @param {string} referenceUrl
   */
  enqueue(rawUrl, depth, referenceUrl) {
    // Skip non-HTTP(S) URLs
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    } catch {
      return;
    }

    const normalized = this.normalizeUrl(rawUrl);
    if (!normalized) return;

    if (this.visited.has(normalized)) return;

    // Check same-domain constraint
    if (this.sameDomainOnly && !this.isSameDomain(normalized, referenceUrl)) return;

    // Skip if already in queue
    if (this.queue.some((item) => item.url === normalized)) return;

    // Skip common non-content resources
    if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|pdf|zip|tar|gz)(\?|$)/i.test(normalized)) {
      return;
    }

    this.queue.push({ url: normalized, depth });
  }

  // -------------------------------------------------------------------------
  // Main crawl loop
  // -------------------------------------------------------------------------

  /**
   * Start a breadth-first crawl beginning at startUrl.
   * @param {string} startUrl
   * @returns {Promise<Map<string, object>>}
   */
  async startCrawl(startUrl) {
    // Reset state
    this.visited.clear();
    this.results.clear();
    this.queue = [];
    this.cancelled = false;
    this.running = true;

    const normalizedStart = this.normalizeUrl(startUrl);
    const origin = new URL(normalizedStart).origin;

    // Optionally seed the queue from sitemap.xml
    if (this.followSitemaps) {
      try {
        const sitemapUrls = await this.fetchSitemap(origin, normalizedStart);
        for (const sitemapUrl of sitemapUrls) {
          this.enqueue(sitemapUrl, 0, normalizedStart);
        }
      } catch {
        // Sitemap fetch is best-effort; continue without it
      }
    }

    // Ensure the start URL is in the queue (at the front)
    if (!this.queue.some((item) => item.url === normalizedStart)) {
      this.queue.unshift({ url: normalizedStart, depth: 0 });
    }

    // BFS loop
    while (this.queue.length > 0 && !this.cancelled) {
      // Enforce page limit
      if (this.visited.size >= this.maxPages) break;

      const { url, depth } = this.queue.shift();

      // Skip if already visited (could have been added to visited while in queue)
      if (this.visited.has(url)) continue;

      // Skip if beyond max depth
      if (depth > this.maxDepth) continue;

      // Same-domain check (belt-and-suspenders)
      if (this.sameDomainOnly && !this.isSameDomain(url, normalizedStart)) continue;

      // Mark as visited before navigation to prevent re-queuing
      this.visited.add(url);

      try {
        // Navigate
        await this.navigateAndWait(url);

        // Extract content
        const pageData = await this.extractPageData();

        const result = {
          url,
          title: pageData.title,
          text: pageData.text,
          markdown: pageData.markdown,
          tables: pageData.tables,
          links: [],
          depth,
          timestamp: Date.now(),
        };

        // Discover links for the next depth level
        if (depth < this.maxDepth) {
          const links = await this.getPageLinks();
          result.links = links;

          for (const link of links) {
            this.enqueue(link, depth + 1, normalizedStart);
          }
        }

        this.results.set(url, result);
      } catch (err) {
        // Record the error but keep crawling
        this.results.set(url, {
          url,
          title: '',
          text: '',
          markdown: '',
          tables: [],
          links: [],
          depth,
          timestamp: Date.now(),
          error: err.message || String(err),
        });

        if (this.onError) {
          try {
            this.onError({ url, error: err.message || String(err) });
          } catch {
            // Don't let callback errors kill the crawl
          }
        }
      }

      // Report progress
      if (this.onProgress) {
        try {
          this.onProgress({
            visited: this.visited.size,
            queued: this.queue.length,
            current: url,
            total: this.maxPages,
          });
        } catch {
          // Don't let callback errors kill the crawl
        }
      }

      // Delay between pages to avoid hammering the server
      if (this.queue.length > 0 && !this.cancelled) {
        await this._delay(this.delayMs);
      }
    }

    this.running = false;

    // Build aggregated results
    const aggregated = {
      startUrl: normalizedStart,
      pagesVisited: this.visited.size,
      pagesQueued: this.queue.length,
      results: Array.from(this.results.values()),
      cancelled: this.cancelled,
      timestamp: Date.now(),
    };

    if (this.onComplete) {
      try {
        this.onComplete(aggregated);
      } catch {
        // Swallow callback errors
      }
    }

    return aggregated;
  }

  /**
   * Cancel the running crawl. The current page will finish processing but no
   * further pages will be visited.
   */
  cancelCrawl() {
    this.cancelled = true;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Promise-based delay.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export for testability (Node.js) while remaining loadable as a plain script
// in the Chrome extension service worker.
if (typeof module !== 'undefined') module.exports = CrawlManager;
