/**
 * Crockford's base32 alphabet, lowercased: the digits plus the letters, minus
 * `i`, `l`, `o` and `u`. Dropping those removes every pair that is misread when
 * an id is spoken or retyped (1/l/i, 0/o), and `u` so the alphabet cannot spell
 * accidental profanity.
 *
 * Exactly 32 symbols, which is what makes the generator below unbiased.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** 12 symbols is 60 bits — far past collision risk for a local-first store. */
const DEFAULT_LENGTH = 12;

/**
 * A short, URL-friendly identifier: `k7m2q9x4rb0t`.
 *
 * Chosen over `crypto.randomUUID()`, whose 36 characters dominate the address
 * bar and every stored node record, for ids that are never typed by a machine
 * that cares about RFC 4122.
 *
 * Unbiased by construction: 32 divides 256, so masking a uniform byte to its
 * low 5 bits gives a uniform symbol. An alphabet whose size is not a power of
 * two would need rejection sampling to avoid favouring its earlier letters.
 */
export function createId(length: number = DEFAULT_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const byte of bytes) {
    id += ALPHABET[byte & 31];
  }
  return id;
}
