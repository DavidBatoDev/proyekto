// Pure text chunker for the knowledge ingest pipeline. ~1000 tokens per
// chunk at the ≈4 chars/token heuristic, with overlap so a fact straddling a
// boundary is retrievable from either side. Prefers paragraph then sentence
// boundaries; falls back to a hard cut for unbroken text.

const DEFAULT_MAX_CHARS = 4_000;
const DEFAULT_OVERLAP_CHARS = 600;
const MIN_CONTENT_CHARS = 12;

export interface KnowledgeChunk {
  index: number;
  content: string;
}

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

export function chunkText(
  text: string,
  options: ChunkOptions = {},
): KnowledgeChunk[] {
  const maxChars = Math.max(options.maxChars ?? DEFAULT_MAX_CHARS, 200);
  const overlapChars = Math.min(
    Math.max(options.overlapChars ?? DEFAULT_OVERLAP_CHARS, 0),
    Math.floor(maxChars / 2),
  );

  const normalized = (text ?? '').replace(/\r\n/g, '\n').trim();
  // Attachment-only chat messages, bare emoji, etc. produce no chunks.
  if (normalized.length < MIN_CONTENT_CHARS) return [];
  if (normalized.length <= maxChars) {
    return [{ index: 0, content: normalized }];
  }

  const chunks: KnowledgeChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      end = findBreak(normalized, start, end);
    }
    const content = normalized.slice(start, end).trim();
    if (content.length >= MIN_CONTENT_CHARS) {
      chunks.push({ index: chunks.length, content });
    }
    if (end >= normalized.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}

// Search backwards from the hard limit for a paragraph break, then a sentence
// end, then a space — never further back than half the window.
function findBreak(text: string, start: number, hardEnd: number): number {
  const floor = start + Math.floor((hardEnd - start) / 2);
  const window = text.slice(floor, hardEnd);

  const paragraph = window.lastIndexOf('\n\n');
  if (paragraph !== -1) return floor + paragraph + 2;

  const sentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('.\n'),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
  );
  if (sentence !== -1) return floor + sentence + 2;

  const space = window.lastIndexOf(' ');
  if (space !== -1) return floor + space + 1;

  return hardEnd;
}
