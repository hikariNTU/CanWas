/**
 * The post-commit hook: writes the version the commit just made true.
 *
 * It has to be `post-commit` and it has to amend. Git snapshots the tree
 * between `pre-commit` and `prepare-commit-msg`, so the only hook that can add
 * a file to a commit runs before the message exists — and the type in that
 * message is the whole input. So the commit lands first and is rewritten a
 * moment later, before it can have been pushed or seen (D89).
 *
 * The amend re-enters this hook, which is why the first thing it does is ask
 * whether the version already moved.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { git, next, read, versionAt } from "./commit-version.mjs";

const root = git("rev-parse", "--show-toplevel");
const path = (file) => `${root}/${file}`;

const commit = read(git("log", "-1", "--format=%B"));
if (commit === null || commit.kind === null) {
  process.exit(0);
}

const parent = versionAt("HEAD^");
const here = versionAt("HEAD");
// No parent to count from — the first commit in a repository, or a
// `package.json` that is not tracked yet. Neither is worth an opinion.
if (parent === null || here === null) {
  process.exit(0);
}

// The version already moved in this commit, so there is nothing left to do.
// Three ways to get here and all of them mean the same thing: this is the
// amend below re-entering, or the author amended a commit that was already
// bumped, or a squash merge brought a branch's own bumps across. Moving again
// would bill one change twice.
if (here !== parent) {
  process.exit(0);
}

// Amending stages whatever is in these two files, so an unstaged edit sitting
// in either would be swept into a commit that never meant to include it.
// Skipping loudly beats a silent commit of something nobody chose.
const dirty = git(
  "diff",
  "--name-only",
  "--",
  "package.json",
  "package-lock.json",
);
if (dirty !== "") {
  console.error(
    `  version not bumped: unstaged changes in ${dirty.split("\n").join(", ")}`,
  );
  process.exit(0);
}

const to = next(parent, commit.kind);

/** Rewrite the one field by hand, so the file's own formatting survives. */
const bump = (file, edit) => {
  const text = readFileSync(path(file), "utf8");
  const replaced = edit(text);
  if (replaced === text) {
    console.error(`  version not bumped: no "version": "${parent}" in ${file}`);
    process.exit(0);
  }
  writeFileSync(path(file), replaced);
};

bump("package.json", (text) =>
  text.replace(`"version": "${parent}"`, `"version": "${to}"`),
);

// The lockfile records the root version twice — at the top and under
// `packages[""]` — and `npm ci` refuses a lockfile that disagrees with
// `package.json`, so missing either copy breaks CI rather than this hook.
// Both sit above the first `node_modules/` key, which is what keeps the
// replacement off a dependency that happens to share the version.
bump("package-lock.json", (text) => {
  const split = text.indexOf('"node_modules/');
  const head = split === -1 ? text : text.slice(0, split);
  const rest = split === -1 ? "" : text.slice(split);
  return head.replaceAll(`"version": "${parent}"`, `"version": "${to}"`) + rest;
});

git("add", "--", "package.json", "package-lock.json");
// `--no-verify`: the subject was already checked on the way in, and checking
// it again would only risk rejecting a commit that has already happened.
git("commit", "--amend", "--no-edit", "--no-verify");
console.error(`  ${parent} -> ${to}`);
