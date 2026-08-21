/**
 * The commit-msg hook: the subject has to be conventional, and has to be true.
 *
 * The version this app reports is written by `post-commit` from this subject
 * (D89), so a subject nobody checked is a version nobody can trust. The second
 * check is the one that matters: a commit that changes `src/` under a type
 * that moves no version ships code the version number never noticed.
 *
 * Armed by `npm install`, via `prepare`.
 */
import { readFileSync } from "node:fs";

import { BUMP, git, read, TYPES } from "./commit-version.mjs";

const fail = (...lines) => {
  console.error(lines.join("\n"));
  process.exit(1);
};

const commit = read(readFileSync(process.argv[2], "utf8"));
if (commit === null) {
  process.exit(0);
}

if (commit.type === null) {
  fail(
    "commit rejected: subject is not conventional",
    `  got:   ${commit.subject}`,
    "  want:  type(scope)!: summary",
    `  types: ${TYPES.join(" ")}`,
  );
}

const staged = git("diff", "--cached", "--name-only")
  .split("\n")
  .filter(Boolean);

if (
  BUMP[commit.type] === null &&
  staged.some((file) => file.startsWith("src/"))
) {
  fail(
    `commit rejected: src/ changed under type '${commit.type}'`,
    `  '${commit.type}' moves no version, so this code would ship unversioned.`,
    "  Use fix, perf, refactor, style or feat — or commit with --no-verify.",
  );
}
