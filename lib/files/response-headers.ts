const SAFE_INLINE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/avif",
  "application/pdf", "text/plain", "text/markdown", "text/csv",
]);

export function fileResponseHeaders(name: string, mimeType: string, forceDownload = false): Record<string, string> {
  const disposition = !forceDownload && SAFE_INLINE_TYPES.has(mimeType) ? "inline" : "attachment";
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    "Content-Type": mimeType,
    "Content-Disposition": `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self'",
    "Referrer-Policy": "no-referrer",
  };
}
