/**
 * AirBrowse Content Script
 *
 * Handles all DOM-based tool operations. Receives commands from the background
 * service worker via chrome.runtime.onMessage and returns results.
 */

(() => {
  // Avoid double-injection
  if (window.__airbrowse_content_loaded) return;
  window.__airbrowse_content_loaded = true;

  // -------------------------------------------------------------------------
  // Console monitor buffer
  // -------------------------------------------------------------------------

  const MAX_CONSOLE_BUFFER = 500;
  let consoleBuffer = [];
  let consoleMonitorInitialized = false;

  function initConsoleMonitor() {
    if (consoleMonitorInitialized) return;
    consoleMonitorInitialized = true;

    const levels = ['log', 'warn', 'error'];
    levels.forEach((level) => {
      const original = console[level].bind(console);
      console[level] = (...args) => {
        if (consoleBuffer.length < MAX_CONSOLE_BUFFER) {
          consoleBuffer.push({
            level,
            message: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
            timestamp: Date.now()
          });
        }
        original(...args);
      };
    });
  }

  // -------------------------------------------------------------------------
  // Network monitor via PerformanceObserver
  // -------------------------------------------------------------------------

  let networkEntries = [];
  let networkObserverInitialized = false;

  function initNetworkObserver() {
    if (networkObserverInitialized) return;
    networkObserverInitialized = true;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          networkEntries.push({
            url: entry.name,
            type: entry.initiatorType || 'unknown',
            duration: Math.round(entry.duration),
            transferSize: entry.transferSize || 0,
            startTime: Math.round(entry.startTime)
          });
          // Cap the buffer
          if (networkEntries.length > 1000) {
            networkEntries = networkEntries.slice(-500);
          }
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch (e) {
      // PerformanceObserver not supported in this context
    }
  }

  // Start the network observer immediately
  initNetworkObserver();

  // -------------------------------------------------------------------------
  // Tool handlers
  // -------------------------------------------------------------------------

  const handlers = {
    // -- Page extraction tools -----------------------------------------------

    'page.getText': (params) => {
      try {
        // Attempt to use Readability (loaded from lib/readability.js)
        if (typeof Readability !== 'undefined') {
          const clone = document.cloneNode(true);
          const parsed = new Readability(clone).parse();
          if (parsed) {
            return {
              result: {
                title: parsed.title || document.title,
                text: parsed.textContent || parsed.content,
                excerpt: parsed.excerpt || '',
                byline: parsed.byline || '',
                length: (parsed.textContent || parsed.content || '').length
              }
            };
          }
        }
      } catch (e) {
        // Readability failed, fall through
      }

      // Fallback
      const text = document.body.innerText;
      return {
        result: {
          title: document.title,
          text,
          excerpt: text.slice(0, 200),
          byline: '',
          length: text.length
        }
      };
    },

    'page.getMarkdown': (params) => {
      // Find main content area
      const contentEl =
        document.querySelector('article') ||
        document.querySelector('main') ||
        document.querySelector('[role="main"]') ||
        document.body;

      let markdown = '';
      try {
        if (typeof TurndownService !== 'undefined') {
          const td = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            bulletListMarker: '-'
          });
          markdown = td.turndown(contentEl.innerHTML);
        } else {
          // Very basic fallback
          markdown = contentEl.innerText;
        }
      } catch (e) {
        markdown = contentEl.innerText;
      }

      const wordCount = markdown.split(/\s+/).filter(Boolean).length;

      return {
        result: {
          markdown,
          wordCount,
          url: location.href,
          title: document.title
        }
      };
    },

    'page.getHTML': (params) => {
      let html;
      if (params && params.selector) {
        const el = document.querySelector(params.selector);
        if (!el) return { error: `No element found for selector: ${params.selector}` };
        html = el.outerHTML;
      } else {
        html = document.documentElement.outerHTML;
      }
      return { result: { html, length: html.length } };
    },

    'page.getTables': (params) => {
      const tableEls = document.querySelectorAll('table');
      const tables = [];

      tableEls.forEach((table, index) => {
        const headers = [];
        const rows = [];

        // Try th elements first
        table.querySelectorAll('th').forEach((th) => {
          headers.push(th.textContent.trim());
        });

        const trs = table.querySelectorAll('tr');
        let startRow = 0;

        // If no th headers found, use first row
        if (headers.length === 0 && trs.length > 0) {
          trs[0].querySelectorAll('td').forEach((td) => {
            headers.push(td.textContent.trim());
          });
          startRow = 1;
        } else if (headers.length > 0) {
          // Skip header row(s) — find first tr that contains th
          for (let i = 0; i < trs.length; i++) {
            if (trs[i].querySelector('th')) {
              startRow = i + 1;
              break;
            }
          }
        }

        for (let i = startRow; i < trs.length; i++) {
          const row = [];
          trs[i].querySelectorAll('td').forEach((td) => {
            row.push(td.textContent.trim());
          });
          if (row.length > 0) rows.push(row);
        }

        tables.push({ index, headers, rows, rowCount: rows.length });
      });

      return { result: { tables, count: tables.length } };
    },

    'page.getLinks': (params) => {
      const anchors = document.querySelectorAll('a[href]');
      const seen = new Set();
      let links = [];

      anchors.forEach((a) => {
        let href;
        try {
          href = new URL(a.href, location.href).href;
        } catch {
          return;
        }

        if (seen.has(href)) return;
        seen.add(href);

        const isInternal = (() => {
          try {
            return new URL(href).origin === location.origin;
          } catch {
            return false;
          }
        })();

        links.push({
          text: a.textContent.trim(),
          href,
          isInternal
        });
      });

      if (params && params.sameDomain) {
        links = links.filter((l) => l.isInternal);
      }

      return { result: { links, count: links.length } };
    },

    'page.getStructure': (params) => {
      const headingEls = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
      const headings = [];

      headingEls.forEach((el) => {
        headings.push({
          level: parseInt(el.tagName[1], 10),
          text: el.textContent.trim(),
          id: el.id || ''
        });
      });

      return { result: { headings, count: headings.length } };
    },

    'page.getCurrentUrl': (params) => {
      return { result: { url: location.href, title: document.title } };
    },

    // -- Interaction tools ---------------------------------------------------

    'interact.click': (params) => {
      if (!params || !params.selector) return { error: 'selector param is required' };

      const el = document.querySelector(params.selector);
      if (!el) return { error: `No element found for selector: ${params.selector}` };

      el.focus();
      el.click();

      return {
        result: {
          success: true,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 100)
        }
      };
    },

    'interact.type': (params) => {
      if (!params || !params.selector) return { error: 'selector param is required' };

      const el = document.querySelector(params.selector);
      if (!el) return { error: `No element found for selector: ${params.selector}` };

      el.focus();
      el.value = params.value || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      return { result: { success: true } };
    },

    'interact.select': (params) => {
      if (!params || !params.selector) return { error: 'selector param is required' };

      const el = document.querySelector(params.selector);
      if (!el) return { error: `No element found for selector: ${params.selector}` };

      el.value = params.value || '';
      el.dispatchEvent(new Event('change', { bubbles: true }));

      return { result: { success: true } };
    },

    'interact.submit': (params) => {
      if (!params || !params.selector) return { error: 'selector param is required' };

      const el = document.querySelector(params.selector);
      if (!el) return { error: `No element found for selector: ${params.selector}` };

      const form = el.closest('form');
      if (form) {
        // Try submitting the form via submit event first
        const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
        const cancelled = !form.dispatchEvent(submitEvent);
        if (!cancelled) {
          form.submit();
        }
      } else {
        el.click();
      }

      return { result: { success: true } };
    },

    'interact.scroll': (params) => {
      if (params && params.selector) {
        const el = document.querySelector(params.selector);
        if (!el) return { error: `No element found for selector: ${params.selector}` };
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (params && params.y !== undefined) {
        window.scrollTo({ top: params.y, behavior: 'smooth' });
      } else {
        // Default: scroll down one viewport
        window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
      }

      return { result: { scrollY: window.scrollY } };
    },

    // -- Monitor tools -------------------------------------------------------

    'monitor.console': (params) => {
      initConsoleMonitor();

      let entries = [...consoleBuffer];

      if (params && params.level) {
        entries = entries.filter((e) => e.level === params.level);
      }

      // Clear after reading
      consoleBuffer = [];

      return { result: { entries, count: entries.length } };
    },

    'monitor.network': (params) => {
      let requests = networkEntries.map((e) => ({
        url: e.url,
        type: e.type,
        duration: e.duration,
        transferSize: e.transferSize
      }));

      if (params && params.filter) {
        const filter = params.filter.toLowerCase();
        requests = requests.filter(
          (r) =>
            r.url.toLowerCase().includes(filter) ||
            r.type.toLowerCase().includes(filter)
        );
      }

      return { result: { requests, count: requests.length } };
    }
  };

  // -------------------------------------------------------------------------
  // Message listener
  // -------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, params, id } = message;

    const handler = handlers[action];
    if (!handler) {
      sendResponse({ id, error: `Unknown action: ${action}` });
      return;
    }

    try {
      const response = handler(params);
      sendResponse({ id, ...response });
    } catch (err) {
      sendResponse({ id, error: err.message || String(err) });
    }
  });
})();
