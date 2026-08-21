/**
 * What a commit subject says about the version, shared by both hooks.
 *
 * `commit-msg` refuses a commit whose type moves nothing while `src/` changes;
 * `post-commit` moves the number. They have to agree on which types bump, or
 * the check rejects commits the bump would have handled and vice versa (D89).
 */
import { execFileSync } from "node:child_process";

export const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trimEnd();

/** How each type moves the number. `null` moves nothing. */
export const BUMP = {
  feat: "minor",
  fix: "patch",
  perf: "patch",
  // `refactor` and `style` are patches rather than nothing, because in this
  // repo both change shipped code: `style` means visual styling
  // (`style(chrome): capsules everywhere`), not whitespace.
  refactor: "patch",
  style: "patch",
  revert: "patch",
  docs: null,
  test: null,
  chore: null,
  ci: null,
  build: null,
};

export const TYPES = Object.keys(BUMP);

const SUBJECT = new RegExp(`^(${TYPES.join("|")})(\\(([^()]+)\\))?(!)?: (.+)$`);

/** Git's own wording — a merge or an autosquash marker — claims nothing. */
const GENERATED = /^(Merge |Revert "|fixup!|squash!|amend!)/;

/**
 * `null` when the subject is git's own; otherwise the type and what it moves,
 * with `type: null` when the subject is not conventional at all.
 */
export function read(message) {
  const body = message
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  const subject = body.trimStart().split("\n")[0] ?? "";

  if (GENERATED.test(subject)) {
    return null;
  }

  const match = SUBJECT.exec(subject);
  if (!match) {
    return { subject, type: null, kind: null };
  }

  const [, type, , , bang] = match;
  // A breaking change moves the minor while the major is 0. Semver says 0.x
  // promises nothing, and letting a subject line declare 1.0 would make the
  // biggest claim this project has by accident.
  const breaking = bang === "!" || /^BREAKING CHANGE:/m.test(body);
  return { subject, type, kind: breaking ? "minor" : BUMP[type] };
}

/** The version recorded in a commit, or `null` if there is no reading it. */
export function versionAt(ref) {
  try {
    return JSON.parse(git("show", `${ref}:package.json`)).version;
  } catch {
    return null;
  }
}

export function next(version, kind) {
  const [major, minor, patch] = version.split(".").map(Number);
  return kind === "minor"
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;
}
