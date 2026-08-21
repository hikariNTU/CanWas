import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * The commit hook, exercised against a real repository.
 *
 * The logic is only reachable through git — an amend, a squash merge and a
 * partial commit each hand the hook a different `HEAD` — so a unit test of the
 * arithmetic would test the half that was never in doubt. This builds a
 * throwaway repo, arms the same hooks the project uses, and commits into it.
 */

const ROOT = new URL("..", import.meta.url).pathname;

/** A lockfile with the root version in both places npm puts it, and a dependency. */
const LOCK = `{
  "name": "canwas",
  "version": "0.46.0",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "name": "canwas",
      "version": "0.46.0"
    },
    "node_modules/thing": {
      "version": "0.46.0"
    }
  }
}
`;

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "canwas-hook-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");

  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(join(ROOT, ".githooks"), join(dir, ".githooks"), { recursive: true });
  for (const script of [
    "commit-version.mjs",
    "lint-commit.mjs",
    "bump-version.mjs",
  ]) {
    cpSync(join(ROOT, "scripts", script), join(dir, "scripts", script));
  }
  writeFileSync(
    join(dir, "package.json"),
    `{\n  "name": "canwas",\n  "version": "0.46.0"\n}\n`,
  );
  writeFileSync(join(dir, "package-lock.json"), LOCK);

  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "chore: start");
  git("config", "core.hooksPath", ".githooks");

  const write = (file: string, text: string) => {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), text);
    git("add", "--", file);
  };
  // What the hooks said last, kept because a hook that does the right thing
  // while complaining about it is still wrong.
  let said = "";
  /** Commits, returning the hook's complaint instead of throwing when it refuses. */
  const commit = (message: string): string | null => {
    const run = spawnSync("git", ["commit", "-q", "-m", message], {
      cwd: dir,
      encoding: "utf8",
    });
    said = run.stderr;
    return run.status === 0 ? null : run.stderr;
  };
  const output = () => said;
  const version = () =>
    (
      JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        version: string;
      }
    ).version;

  return { dir, git, write, commit, version, output };
}

test("a feature moves the minor, a fix moves the patch", () => {
  const { write, commit, version } = repo();

  write("src/a.ts", "export const a = 1;\n");
  expect(commit("feat(canvas): a thing")).toBeNull();
  expect(version()).toBe("0.47.0");

  write("src/a.ts", "export const a = 2;\n");
  expect(commit("fix(canvas): the thing")).toBeNull();
  expect(version()).toBe("0.47.1");

  write("src/a.ts", "export const a = 3;\n");
  expect(commit("style(canvas): the thing, prettier")).toBeNull();
  expect(version()).toBe("0.47.2");
});

test("the bump rides in the commit that caused it", () => {
  const { git, write, commit, version } = repo();

  write("src/a.ts", "export const a = 1;\n");
  commit("feat: a thing");

  // Not a follow-up commit and not a dirty tree afterwards: the version is
  // part of the change, so a checkout of any commit builds its own version.
  expect(git("status", "--porcelain")).toBe("");
  const files = git("show", "--name-only", "--format=", "HEAD")
    .trim()
    .split("\n");
  expect(files.sort()).toEqual([
    "package-lock.json",
    "package.json",
    "src/a.ts",
  ]);
  expect(version()).toBe("0.47.0");
});

test("both copies of the version in the lockfile move, and nothing else does", () => {
  const { dir, write, commit } = repo();

  write("src/a.ts", "export const a = 1;\n");
  commit("feat: a thing");

  const lock = JSON.parse(
    readFileSync(join(dir, "package-lock.json"), "utf8"),
  ) as {
    version: string;
    packages: Record<string, { version: string }>;
  };
  expect(lock.version).toBe("0.47.0");
  expect(lock.packages[""].version).toBe("0.47.0");
  // A dependency that happens to share the old version is not the root package.
  expect(lock.packages["node_modules/thing"].version).toBe("0.46.0");
});

test("a subject that is not conventional is not a commit", () => {
  const { write, commit, version } = repo();

  write("src/a.ts", "export const a = 1;\n");
  const complaint = commit("update the canvas a bit");
  expect(complaint).toContain("subject is not conventional");
  expect(version()).toBe("0.46.0");
});

test("code cannot ship under a type that moves nothing", () => {
  const { write, commit, version } = repo();

  write("src/a.ts", "export const a = 1;\n");
  expect(commit("chore: tidy")).toContain("src/ changed under type 'chore'");

  // The same change under a type that does move the version is fine — the
  // rejection was about the label, not the edit.
  expect(commit("refactor: tidy")).toBeNull();
  expect(version()).toBe("0.46.1");
});

test("a commit that ships nothing moves nothing", () => {
  const { write, commit, version } = repo();

  write("docs/notes.md", "# notes\n");
  expect(commit("docs: notes")).toBeNull();
  expect(version()).toBe("0.46.0");
});

test("a breaking change moves the minor, not the major", () => {
  const { write, commit, version } = repo();

  write("src/a.ts", "export const a = 1;\n");
  // While the major is 0 nothing was promised, so nothing can be broken —
  // and 1.0 stays a decision rather than a side effect of a subject line.
  expect(commit("feat(sync)!: change the format")).toBeNull();
  expect(version()).toBe("0.47.0");
});

test("amending a commit does not charge for it twice", () => {
  const { git, write, commit, version, output } = repo();

  write("src/a.ts", "export const a = 1;\n");
  commit("feat: a thing");
  expect(version()).toBe("0.47.0");

  git("commit", "-q", "--amend", "-m", "feat: a thing, said better");
  expect(version()).toBe("0.47.0");

  // Rewording is not the only amend: adding to the change must not bump either.
  write("src/b.ts", "export const b = 1;\n");
  git("commit", "-q", "--amend", "--no-edit");
  expect(version()).toBe("0.47.0");

  // Quietly, too. The amend the hook makes itself re-enters the hook, and
  // recognising that has to be a decision rather than a replacement that
  // happens to find nothing to replace — which would leave the right number
  // behind a warning on every single commit.
  expect(output()).not.toContain("not bumped");
});

test("a squash merge keeps the version the branch already reached", () => {
  const { git, write, commit, version } = repo();

  git("checkout", "-q", "-b", "feature");
  write("src/a.ts", "export const a = 1;\n");
  commit("feat: a thing");
  write("src/a.ts", "export const a = 2;\n");
  commit("fix: the thing");
  expect(version()).toBe("0.47.1");

  git("checkout", "-q", "main");
  git("merge", "--squash", "feature");
  // The branch's own bumps arrive staged. Counting the squash as one more
  // change would bill the same work twice.
  expect(commit("feat: a thing")).toBeNull();
  expect(version()).toBe("0.47.1");
});

test("an unstaged package.json is never swept into a commit", () => {
  const { dir, git, write, commit, version } = repo();

  write("src/a.ts", "export const a = 1;\n");
  writeFileSync(
    join(dir, "package.json"),
    `{\n  "name": "canwas",\n  "version": "0.46.0",\n  "private": true\n}\n`,
  );
  // Amending would stage that edit along with the bump. The commit itself is
  // already made by the time the hook runs, so the only honest move left is to
  // leave the version alone and say so.
  expect(commit("feat: a thing")).toBeNull();
  expect(version()).toBe("0.46.0");
  expect(git("show", "--name-only", "--format=", "HEAD").trim()).toBe(
    "src/a.ts",
  );
});

test("git's own merge subject is left alone", () => {
  const { git, write, commit, version } = repo();

  git("checkout", "-q", "-b", "feature");
  write("src/a.ts", "export const a = 1;\n");
  commit("feat: a thing");

  git("checkout", "-q", "main");
  write("docs/notes.md", "# notes\n");
  commit("docs: notes");

  // A merge subject is git's wording rather than a claim about what changed,
  // so it is neither rejected for being unconventional nor counted as one more
  // change on top of the branch it brings in.
  git("merge", "--no-ff", "-m", "Merge branch 'feature'", "feature");
  expect(version()).toBe("0.47.0");
});
