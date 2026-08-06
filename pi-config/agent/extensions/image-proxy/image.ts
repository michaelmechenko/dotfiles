/**
 * Pure helpers for the image-proxy extension.
 *
 * Kept free of any pi imports (runtime or type) so it can be unit-tested with
 * `node --test` without resolving the pi packages, and so the main `index.ts`
 * stays a thin wiring layer around these functions.
 */

// ── Path / MIME ────────────────────────────────────────────────────────────

/** Lowercased extension (no dot) → MIME type, for the image formats we accept. */
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

export const SUPPORTED_IMAGE_EXTENSIONS = Object.keys(MIME_BY_EXT);

/** 10 MB, matching the upstream proxy's default. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Returns the MIME type for an image path, or null if unsupported. */
export function mimeTypeForPath(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? null;
}

/** True for any of the accepted image extensions (case-insensitive). */
export function isImagePath(path: string): boolean {
  return mimeTypeForPath(path) !== null;
}

// ── Hashing ────────────────────────────────────────────────────────────────

/**
 * Compact, non-cryptographic hash of an image's base64 data.
 *
 * Used only as a per-session lookup key to match an image block in the
 * `context` event back to the description produced for the same image in
 * `before_agent_start`. Collisions across a handful of session images are
 * negligible; this is not a security boundary.
 */
export function hashImageData(data: string): string {
  // djb2 — small, fast, good distribution for short keys.
  let h = 5381;
  for (let i = 0; i < data.length; i++) {
    h = ((h << 5) + h + data.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

// ── Fence building ─────────────────────────────────────────────────────────

export const FENCE_TAG = "image_proxy_description";

/**
 * Neutralise any sequence that would close the description fence early.
 *
 * The fence is plain text in a message body (there is no real parser), but an
 * embedded `</image_proxy_description>` inside a transcription of an image
 * could confuse the model. Insert a zero-width space between `<` and `/` so
 * the literal close tag can never re-form.
 */
export function neutralizeFenceBody(text: string): string {
  return text.replace(/<\//g, "<\u200B/");
}

export interface DescriptionInput {
  /** 1-based index among the images analyzed in the same turn. */
  index: number;
  /** Filename for attached images, or the basename for file reads. May be "". */
  filename?: string;
  /** The description text, or null when analysis failed. */
  description: string | null;
  /** Error message when analysis failed; shown in place of the description. */
  error?: string;
}

/** Build the fenced description block injected into context. */
export function buildDescriptionFence(input: DescriptionInput): string {
  const attrs: string[] = [`index="${input.index}"`];
  if (input.filename) attrs.push(`filename="${escapeAttr(input.filename)}"`);

  const header = `<${FENCE_TAG} ${attrs.join(" ")}>`;

  let body: string;
  if (input.description != null && input.description.length > 0) {
    body = neutralizeFenceBody(input.description);
  } else if (input.error) {
    body = `[analysis failed: ${neutralizeFenceBody(input.error)}]`;
  } else {
    body = `[analysis returned no content]`;
  }

  const footer = `</${FENCE_TAG}>`;
  return `${header}\n${body}\n${footer}`;
}

/** Escape a string for safe use inside a double-quoted fence attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u0000/g, "\uFFFD");
}

// ── Image-block replacement ─────────────────────────────────────────────────

/** Structural check for a pi-ai image content block. */
export function isImageBlock(block: unknown): boolean {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "image"
  );
}

/** Structural check for a text content block. */
function isTextBlock(block: unknown): boolean {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "text"
  );
}

/**
 * A pure transformation over a user message's content: every image block is
 * replaced by a text block carrying `replacementFor(hash)`, where `hash` is the
 * image block's data hash. Non-image blocks are preserved in order.
 *
 * Returns the original object untouched when the content is a plain string or
 * contains no image blocks, so callers can skip returning a modified messages
 * array when nothing changed.
 */
export function replaceImageBlocks(
  content: unknown,
  replacementFor: (hash: string, imageIndex: number) => string,
): unknown {
  if (!Array.isArray(content)) return content;

  let changed = false;
  let imageIndex = 0;
  const next = content.map((block) => {
    if (!isImageBlock(block)) return block;
    changed = true;
    imageIndex += 1;
    const data = String((block as { data?: unknown }).data ?? "");
    return { type: "text", text: replacementFor(hashImageData(data), imageIndex) };
  });

  return changed ? next : content;
}

/** True if a message content array contains at least one image block. */
export function contentHasImages(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(isImageBlock);
}