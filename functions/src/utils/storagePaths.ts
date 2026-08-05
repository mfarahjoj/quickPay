/**
 * Resolving a Cloud Storage object path from whatever the client stored.
 *
 * The customer app uploads ID photos and saves `getDownloadURL()`, which is a
 * permanent, unauthenticated link carrying its own access token — anyone who
 * gets hold of it has that person's passport photo indefinitely, regardless of
 * Storage rules. The admin console must never hand those around, so it
 * re-derives the object path and mints a short-lived signed URL instead.
 *
 * Kept pure and separate so the parsing is testable without Storage.
 */

/** `https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?…` */
const DOWNLOAD_URL_RE = /^https?:\/\/[^/]*firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/i;

/** `https://storage.googleapis.com/{bucket}/{path}` */
const GCS_URL_RE = /^https?:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/i;

/** `gs://{bucket}/{path}` */
const GS_URI_RE = /^gs:\/\/([^/]+)\/(.+)$/i;

/** Any `scheme:` prefix — matched before the first slash, so paths are safe. */
const SCHEME_PREFIX_RE = /^[a-z][a-z0-9+.-]*:/i;

export interface ParsedStorageRef {
  /** Object path within the bucket, e.g. `kyc/abc123/front_169.jpg`. */
  path: string;
  /** Present when the source carried one; otherwise the default bucket. */
  bucket?: string;
}

/**
 * Parse a stored reference into a bucket-relative object path.
 *
 * Accepts Firebase download URLs, plain GCS URLs, `gs://` URIs and bare paths.
 * Returns null when the value is not something we can resolve — the caller
 * must then refuse rather than fall back to the raw URL.
 */
export function parseStorageRef(value: unknown): ParsedStorageRef | null {
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw) return null;

  const download = DOWNLOAD_URL_RE.exec(raw);
  if (download) {
    try {
      // The path segment is percent-encoded, slashes included.
      return { bucket: download[1], path: decodeURIComponent(download[2]) };
    } catch {
      return null;
    }
  }

  const gcs = GCS_URL_RE.exec(raw);
  if (gcs) {
    try {
      return { bucket: gcs[1], path: decodeURIComponent(gcs[2].split("?")[0]) };
    } catch {
      return null;
    }
  }

  const gs = GS_URI_RE.exec(raw);
  if (gs) {
    return { bucket: gs[1], path: gs[2] };
  }

  // A bare object path. Reject anything carrying a URI scheme, so neither an
  // unrecognised host (`https://evil.example/…`) nor a scheme-only value
  // (`data:image/png;base64,…`) can be mistaken for one. The scheme must
  // precede the first slash, so paths containing a colon still parse.
  if (SCHEME_PREFIX_RE.test(raw)) return null;

  return { path: raw.replace(/^\/+/, "") };
}

/**
 * True when the path is inside the KYC area for this user.
 *
 * Defence in depth: the path comes from a document the user once influenced,
 * so it must not be usable to mint a signed URL for arbitrary objects in the
 * bucket.
 */
export function isKycPathFor(path: string, userId: string): boolean {
  return path.startsWith(`kyc/${userId}/`) && !path.includes("..");
}
