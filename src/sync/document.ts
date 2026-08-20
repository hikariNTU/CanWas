/**
 * Version stamps on everything this app writes to a remote.
 *
 * Not for the format as it stands — a single writer needs no version — but for
 * the moment there are two. Devices update independently: a phone that has not
 * been opened in a month is a client running last month's code, and it will
 * read whatever the laptop wrote this morning. Without a stamp, an older build
 * reading a newer document does not fail, it *half-succeeds*: it takes the
 * fields it knows, drops the ones it does not, and writes the result back.
 * That is not a bug report, it is silent data loss, and the evidence is
 * destroyed by the write that caused it.
 *
 * So the rule is: stamp on the way out, refuse on the way in. A document from
 * the future is an error the user can see and a maintainer can act on, and
 * refusing to read it also means refusing to overwrite it.
 *
 * A missing stamp is version 0, which is what the boards written before this
 * existed carry. They are read normally and stamped on the next write.
 */

/** The board document: `boards/<id>.json`. */
export const BOARD_VERSION = 1;

/** A recognition: `text/<hash>.json`. */
export const TEXT_VERSION = 1;

interface Versioned {
  _version?: number;
}

/** Adds the stamp. Never call this on anything that is not about to be written. */
export function stamped<T extends object>(
  document: T,
  version: number,
): T & Versioned {
  return { ...document, _version: version };
}

/**
 * Checks the stamp and strips it, so nothing above this layer ever sees it.
 *
 * Stripped rather than carried because the field belongs to the wire and not
 * to the model: leaving it on would let it reach the merge, where two devices
 * running different versions would find one more thing to disagree about.
 */
export function accepted<T extends object>(
  raw: unknown,
  version: number,
  what: string,
): T {
  if (raw === null || typeof raw !== "object") {
    throw new Error(`${what} is not a document`);
  }
  const { _version: found, ...rest } = raw as Versioned & Record<string, never>;
  // Absent means it predates versioning, which is readable by definition — it
  // is what this code used to write.
  if (found !== undefined && found > version) {
    throw new Error(
      `${what} was written by a newer version of CanWas (${found} > ${version}). Update this device before syncing, or it would overwrite what it cannot read.`,
    );
  }
  return rest as unknown as T;
}
