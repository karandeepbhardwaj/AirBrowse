/**
 * Text chunking and truncation utilities for managing large content
 * passed to language models or relay commands.
 */

const DEFAULT_CHUNK_SIZE = 4000;
const DEFAULT_OVERLAP = 200;

/**
 * Split text into overlapping chunks suitable for LLM processing.
 * Tries to break on paragraph or sentence boundaries when possible.
 */
export function chunkText(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP
): string[] {
  if (!text || text.length <= chunkSize) {
    return text ? [text] : [];
  }

  const chunks: string[] = [];
  let offset = 0;

  while (offset < text.length) {
    let end = Math.min(offset + chunkSize, text.length);

    // If we're not at the very end, try to break at a natural boundary
    if (end < text.length) {
      const segment = text.slice(offset, end);

      // Prefer paragraph break
      const paraBreak = segment.lastIndexOf('\n\n');
      if (paraBreak > chunkSize * 0.5) {
        end = offset + paraBreak + 2;
      } else {
        // Fall back to sentence break
        const sentenceBreak = segment.lastIndexOf('. ');
        if (sentenceBreak > chunkSize * 0.3) {
          end = offset + sentenceBreak + 2;
        } else {
          // Fall back to line break
          const lineBreak = segment.lastIndexOf('\n');
          if (lineBreak > chunkSize * 0.3) {
            end = offset + lineBreak + 1;
          }
        }
      }
    }

    chunks.push(text.slice(offset, end));
    offset = end - overlap;

    // Guard against infinite loop if we didn't advance
    if (offset <= (end - chunkSize + overlap)) {
      offset = end;
    }
  }

  return chunks;
}

/**
 * Truncate text to a maximum character length, breaking at a natural boundary
 * and appending a truncation notice.
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text ?? '';
  }

  const notice = '\n\n... [truncated]';
  const target = maxLength - notice.length;

  if (target <= 0) {
    return text.slice(0, maxLength);
  }

  const segment = text.slice(0, target);

  // Try to break at paragraph
  const paraBreak = segment.lastIndexOf('\n\n');
  if (paraBreak > target * 0.7) {
    return segment.slice(0, paraBreak) + notice;
  }

  // Try sentence
  const sentenceBreak = segment.lastIndexOf('. ');
  if (sentenceBreak > target * 0.7) {
    return segment.slice(0, sentenceBreak + 1) + notice;
  }

  // Try line
  const lineBreak = segment.lastIndexOf('\n');
  if (lineBreak > target * 0.5) {
    return segment.slice(0, lineBreak) + notice;
  }

  return segment + notice;
}
