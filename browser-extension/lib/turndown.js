/**
 * Simplified TurndownService — HTML to Markdown converter for AirBrowse.
 *
 * Handles headings, paragraphs, bold, italic, links, images, lists,
 * code blocks, tables, and line breaks. Replace with the full
 * turndown npm package for production use.
 */

// eslint-disable-next-line no-unused-vars
class TurndownService {
  constructor(options = {}) {
    this.options = {
      headingStyle: options.headingStyle || 'atx',
      codeBlockStyle: options.codeBlockStyle || 'fenced',
      bulletListMarker: options.bulletListMarker || '-',
      ...options
    };
  }

  turndown(html) {
    // Create a temporary container to parse the HTML
    const container = document.createElement('div');
    container.innerHTML = html;

    return this._processNode(container).trim();
  }

  _processNode(node) {
    let result = '';

    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        result += child.textContent;
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = child.tagName.toLowerCase();

      switch (tag) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
          const level = parseInt(tag[1], 10);
          const prefix = '#'.repeat(level);
          const text = this._getInlineContent(child).trim();
          result += `\n\n${prefix} ${text}\n\n`;
          break;
        }

        case 'p': {
          const text = this._getInlineContent(child).trim();
          if (text) result += `\n\n${text}\n\n`;
          break;
        }

        case 'br':
          result += '\n';
          break;

        case 'strong': case 'b':
          result += `**${this._getInlineContent(child).trim()}**`;
          break;

        case 'em': case 'i':
          result += `*${this._getInlineContent(child).trim()}*`;
          break;

        case 'a': {
          const href = child.getAttribute('href') || '';
          const text = this._getInlineContent(child).trim();
          if (href) {
            result += `[${text}](${href})`;
          } else {
            result += text;
          }
          break;
        }

        case 'img': {
          const src = child.getAttribute('src') || '';
          const alt = child.getAttribute('alt') || '';
          result += `![${alt}](${src})`;
          break;
        }

        case 'code': {
          // Inline code vs block code
          if (child.parentElement && child.parentElement.tagName.toLowerCase() === 'pre') {
            // Handled by pre case
            break;
          }
          result += `\`${child.textContent}\``;
          break;
        }

        case 'pre': {
          const codeEl = child.querySelector('code');
          const codeText = codeEl ? codeEl.textContent : child.textContent;
          const lang = codeEl
            ? (codeEl.className.match(/language-(\w+)/) || [])[1] || ''
            : '';
          result += `\n\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
          break;
        }

        case 'blockquote': {
          const inner = this._processNode(child).trim();
          const quoted = inner.split('\n').map((l) => `> ${l}`).join('\n');
          result += `\n\n${quoted}\n\n`;
          break;
        }

        case 'ul': {
          const items = child.querySelectorAll(':scope > li');
          const marker = this.options.bulletListMarker;
          let list = '\n\n';
          items.forEach((li) => {
            const text = this._getInlineContent(li).trim();
            list += `${marker} ${text}\n`;
          });
          result += list + '\n';
          break;
        }

        case 'ol': {
          const items = child.querySelectorAll(':scope > li');
          let list = '\n\n';
          items.forEach((li, i) => {
            const text = this._getInlineContent(li).trim();
            list += `${i + 1}. ${text}\n`;
          });
          result += list + '\n';
          break;
        }

        case 'table': {
          result += '\n\n' + this._convertTable(child) + '\n\n';
          break;
        }

        case 'hr':
          result += '\n\n---\n\n';
          break;

        case 'div': case 'section': case 'article': case 'main': case 'span':
        case 'figure': case 'figcaption': case 'details': case 'summary':
        case 'li': case 'dd': case 'dt':
          result += this._processNode(child);
          break;

        default:
          // For other elements, just process children
          result += this._processNode(child);
          break;
      }
    }

    return result;
  }

  /**
   * Get inline content of an element, processing inline children
   * but not adding block-level separators.
   */
  _getInlineContent(node) {
    let result = '';

    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        result += child.textContent;
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = child.tagName.toLowerCase();

      switch (tag) {
        case 'strong': case 'b':
          result += `**${this._getInlineContent(child).trim()}**`;
          break;
        case 'em': case 'i':
          result += `*${this._getInlineContent(child).trim()}*`;
          break;
        case 'a': {
          const href = child.getAttribute('href') || '';
          const text = this._getInlineContent(child).trim();
          result += href ? `[${text}](${href})` : text;
          break;
        }
        case 'code':
          result += `\`${child.textContent}\``;
          break;
        case 'br':
          result += '\n';
          break;
        case 'img': {
          const src = child.getAttribute('src') || '';
          const alt = child.getAttribute('alt') || '';
          result += `![${alt}](${src})`;
          break;
        }
        default:
          result += this._getInlineContent(child);
          break;
      }
    }

    return result;
  }

  /**
   * Convert an HTML table to a Markdown table.
   */
  _convertTable(tableEl) {
    const rows = [];
    const trs = tableEl.querySelectorAll('tr');

    trs.forEach((tr) => {
      const cells = [];
      tr.querySelectorAll('th, td').forEach((cell) => {
        cells.push(cell.textContent.trim().replace(/\|/g, '\\|'));
      });
      rows.push(cells);
    });

    if (rows.length === 0) return '';

    const colCount = Math.max(...rows.map((r) => r.length));
    // Normalize all rows to same column count
    rows.forEach((row) => {
      while (row.length < colCount) row.push('');
    });

    let md = '';
    // Header row
    md += '| ' + rows[0].join(' | ') + ' |\n';
    // Separator
    md += '| ' + rows[0].map(() => '---').join(' | ') + ' |\n';
    // Data rows
    for (let i = 1; i < rows.length; i++) {
      md += '| ' + rows[i].join(' | ') + ' |\n';
    }

    return md.trim();
  }
}
