/**
 * Board URLs carry a readable slug after the id: `#/board/qyzs34jb14rz-mood-board`.
 *
 * The id is authoritative and the slug is decoration — a stale or wrong slug
 * still resolves, and the app rewrites the URL to the canonical form. This is
 * the arrangement GitHub and Notion use, and it means renaming a board can
 * never break a link someone kept.
 */

const MAX_SLUG_LENGTH = 48;

/**
 * A readable fragment of a board name.
 *
 * Letters and numbers in *any* script survive — `\p{L}` keeps 未命名畫板 intact
 * rather than percent-encoding it into noise, and browsers display UTF-8 in the
 * address bar decoded. Everything else collapses to a hyphen.
 */
export function toSlug(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, "");
}

/** The canonical URL segment for a board. */
export function boardSlug(id: string, name: string): string {
  const slug = toSlug(name);
  return slug === "" ? id : `${id}-${slug}`;
}

/**
 * Recovers the id from a URL segment, with or without a slug.
 *
 * The base32 id alphabet excludes `-` (D32), so the first hyphen is always the
 * boundary. Ids minted before that were UUIDs containing four hyphens of their
 * own; those links are not supported and would resolve to a new empty board.
 */
export function parseBoardId(segment: string): string {
  const boundary = segment.indexOf("-");
  return boundary === -1 ? segment : segment.slice(0, boundary);
}
