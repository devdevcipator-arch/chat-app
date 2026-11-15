// Generic file attachments: any extension except executables.
//
// Keep in sync with:
//  - supabase/migrations/20261115000000_allow_all_file_formats.sql (the
//    media_url_is_object_key / gallery_media_url_is_vault_key checks)
//  - mobile/lib/core/media.dart (blockedExtensions, documentMimeTypes)

/** Extensions never accepted: Windows executables, installers and script hosts. */
export const BLOCKED_EXTENSIONS = [
  "exe", "bat", "cmd", "com", "scr", "msi", "msp", "pif", "cpl", "dll",
  "vbs", "vbe", "js", "jse", "ws", "wsf", "wsh", "ps1", "hta", "reg", "lnk", "jar",
] as const;

/** Extension syntax for stored object keys (lowercase, 1–10 chars). */
export const EXTENSION_PATTERN = /^[a-z0-9]{1,10}$/;

const BLOCKED = new Set<string>(BLOCKED_EXTENSIONS);

export const isBlockedExtension = (ext: string) => BLOCKED.has(ext.toLowerCase());

/** "Book.EPUB" -> "epub"; "" when there is none (or it isn't a usable extension). */
export function fileExtension(name: string) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXTENSION_PATTERN.test(ext) ? ext : "";
}

/**
 * Content-Types for well-known document, ebook and archive formats. Anything
 * else is stored as application/octet-stream, so browsers download it rather
 * than render it (no HTML/SVG/script is ever served inline from our bucket).
 */
export const DOCUMENT_MIME_TYPES: Record<string, string> = {
  // Ebooks
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
  fb2: "application/x-fictionbook+xml",
  djvu: "image/vnd.djvu",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook-rar",
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  md: "text/markdown",
  // Spreadsheets
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  // Presentations
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  key: "application/vnd.apple.keynote",
  // Archives
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  // Data
  json: "application/json",
};

export const OCTET_STREAM = "application/octet-stream";

/** Upper-case format badge for a file card: "EPUB", "PDF", "ZIP", or "FILE". */
export function formatBadge(name: string | null | undefined) {
  const ext = fileExtension(name ?? "");
  return ext ? ext.toUpperCase().slice(0, 5) : "FILE";
}
