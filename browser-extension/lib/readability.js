/**
 * Simplified Readability implementation for AirBrowse.
 *
 * This is a minimal stand-in for Mozilla's Readability.js. It strips
 * non-content elements and attempts to locate the main content area.
 * Replace with the full @mozilla/readability package for production use.
 */

// eslint-disable-next-line no-unused-vars
class Readability {
  constructor(doc) {
    this._doc = doc;
  }

  parse() {
    const doc = this._doc;

    // Strip unwanted elements
    const removeSelectors = [
      'script', 'style', 'noscript', 'iframe', 'nav', 'footer',
      'aside', 'header', '[role="banner"]', '[role="navigation"]',
      '[role="complementary"]', '[role="contentinfo"]', '.ad', '.ads',
      '.advertisement', '.social-share', '.comments', '#comments'
    ];

    removeSelectors.forEach((sel) => {
      try {
        doc.querySelectorAll(sel).forEach((el) => el.remove());
      } catch (e) {
        // Ignore invalid selectors in different DOM contexts
      }
    });

    // Find main content container
    const contentEl =
      doc.querySelector('article') ||
      doc.querySelector('main') ||
      doc.querySelector('[role="main"]') ||
      doc.querySelector('.post-content') ||
      doc.querySelector('.entry-content') ||
      doc.querySelector('.article-body') ||
      this._findLargestTextBlock(doc);

    if (!contentEl) {
      return null;
    }

    const title =
      (doc.querySelector('title') && doc.querySelector('title').textContent) ||
      (doc.querySelector('h1') && doc.querySelector('h1').textContent) ||
      '';

    const textContent = this._getTextContent(contentEl);
    const excerpt = textContent.slice(0, 300).trim();

    // Try to find byline
    const bylineEl =
      doc.querySelector('[rel="author"]') ||
      doc.querySelector('.author') ||
      doc.querySelector('.byline') ||
      doc.querySelector('[itemprop="author"]');

    const byline = bylineEl ? bylineEl.textContent.trim() : '';

    return {
      title: title.trim(),
      content: contentEl.innerHTML,
      textContent,
      excerpt,
      byline,
      length: textContent.length
    };
  }

  /**
   * Heuristic: find the element with the most direct text content
   * among likely container elements.
   */
  _findLargestTextBlock(doc) {
    const candidates = doc.querySelectorAll(
      'div, section, article, main'
    );

    let best = null;
    let bestScore = 0;

    candidates.forEach((el) => {
      // Simple score: count of paragraph children + text length
      const paragraphs = el.querySelectorAll('p');
      const textLen = el.textContent.length;
      const score = paragraphs.length * 100 + Math.min(textLen, 5000);

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    });

    return best || doc.body;
  }

  _getTextContent(el) {
    // Walk text nodes to produce clean output
    const blocks = [];
    const walker = document.createTreeWalker
      ? document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      : null;

    if (walker) {
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (text) blocks.push(text);
      }
    } else {
      // Fallback
      blocks.push(el.textContent);
    }

    return blocks.join('\n');
  }
}
