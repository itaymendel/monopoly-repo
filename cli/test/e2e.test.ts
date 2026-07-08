import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { git } from "../src/git";
import { parseArgs } from "../src/args";
import { validate } from "../src/validate";
import { executeMove } from "../src/move";

// --- Test helpers ---

let tmpRoot: string;

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "monopoly-test-"));
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(["init"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
}

function writeAndCommit(
  repoDir: string,
  filePath: string,
  content: string,
  message: string
): void {
  const full = path.join(repoDir, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  git(["add", filePath], repoDir);
  git(["commit", "-m", message], repoDir);
}

/** Build a monorepo with packages/auth (5 commits) and packages/api (2 commits) */
function buildMonorepo(dir: string): void {
  initRepo(dir);
  writeAndCommit(dir, "packages/auth/index.ts", 'export function login() { return "v1"; }\n', "feat(auth): initial login");
  writeAndCommit(dir, "packages/api/index.ts", 'import { login } from "@mono/auth";\n', "feat(api): initial api");
  writeAndCommit(dir, "packages/auth/index.ts", 'export function login() { return "v2"; }\n', "fix(auth): patch login");
  writeAndCommit(dir, "packages/auth/logout.ts", 'export function logout() { return true; }\n', "feat(auth): add logout");
  writeAndCommit(dir, "packages/auth/README.md", "# Auth\n", "docs(auth): add readme");
  writeAndCommit(dir, "packages/api/index.ts", 'console.log("api v2");\n', "feat(api): v2 logging");
}

function runMove(
  source: string,
  to: string,
  as?: string,
  dryRun = false
): ReturnType<typeof executeMove> | "dry-run" {
  const argv = ["move", source, "--to", to];
  if (as) argv.push("--as", as);
  if (dryRun) argv.push("--dry-run");

  const args = parseArgs(argv);
  if (args.kind !== "move") throw new Error("Expected move args");

  const ctx = validate(args);

  if (args.dryRun) return "dry-run";
  return executeMove(args, ctx);
}

// --- Tests ---

beforeEach(() => {
  tmpRoot = createTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("directory move", () => {
  test("moves a directory with full history into target repo", () => {
    const mono = path.join(tmpRoot, "mono");
    const target = path.join(tmpRoot, "target");

    buildMonorepo(mono);
    initRepo(target);
    // Target needs at least one commit for the merge
    writeAndCommit(target, ".gitkeep", "", "chore: init");

    const result = runMove(
      path.join(mono, "packages/auth"),
      target,
      "auth"
    );

    expect(result).not.toBe("dry-run");
    if (result === "dry-run") return;

    // Files landed at auth/
    expect(fs.existsSync(path.join(target, "auth/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "auth/logout.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "auth/README.md"))).toBe(true);

    // Content is correct
    const content = fs.readFileSync(path.join(target, "auth/index.ts"), "utf-8");
    expect(content).toContain("v2");

    // Extracted commits > 0
    expect(result.commitCount).toBeGreaterThan(0);

    // MERGE_MSG exists for the staged merge
    const gitDirResult = git(["rev-parse", "--git-dir"], target);
    const gitDir = path.resolve(target, gitDirResult.stdout);
    expect(fs.existsSync(path.join(gitDir, "MERGE_MSG"))).toBe(true);
    const mergeMsg = fs.readFileSync(path.join(gitDir, "MERGE_MSG"), "utf-8");
    expect(mergeMsg).toContain("packages/auth");

    // No api commits leaked — check that api files don't exist
    expect(fs.existsSync(path.join(target, "packages/api"))).toBe(false);
    expect(fs.existsSync(path.join(target, "api"))).toBe(false);
  });

  test("moves directory with nested --as path", () => {
    const mono = path.join(tmpRoot, "mono");
    const target = path.join(tmpRoot, "target");

    buildMonorepo(mono);
    initRepo(target);
    writeAndCommit(target, ".gitkeep", "", "chore: init");

    const result = runMove(
      path.join(mono, "packages/auth"),
      target,
      "libs/auth"
    );

    expect(result).not.toBe("dry-run");
    if (result === "dry-run") return;

    expect(fs.existsSync(path.join(target, "libs/auth/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "libs/auth/logout.ts"))).toBe(true);
  });

  test("extracted entry named like the --as target lands at the right path", () => {
    const mono = path.join(tmpRoot, "mono");
    const target = path.join(tmpRoot, "target");

    initRepo(mono);
    // The moved package contains its own `auth/` subdirectory — the same name
    // as the --as target. This used to be silently dropped at the target root.
    writeAndCommit(mono, "packages/auth/index.ts", "export const x = 1;\n", "feat: init");
    writeAndCommit(mono, "packages/auth/auth/nested.ts", "export const nested = 1;\n", "feat: nested auth");

    initRepo(target);
    writeAndCommit(target, ".gitkeep", "", "chore: init");

    const result = runMove(path.join(mono, "packages/auth"), target, "auth");

    expect(result).not.toBe("dry-run");
    if (result === "dry-run") return;

    // The colliding nested entry ends up under the target, not at the root.
    expect(fs.existsSync(path.join(target, "auth/auth/nested.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "auth/index.ts"))).toBe(true);

    // Nothing was left stranded at the target repo root.
    expect(fs.existsSync(path.join(target, "auth/nested.ts"))).toBe(false);
    expect(fs.existsSync(path.join(target, "nested.ts"))).toBe(false);
    expect(fs.existsSync(path.join(target, "index.ts"))).toBe(false);
  });
});

describe("file move", () => {
  test("moves a single file with history", () => {
    const mono = path.join(tmpRoot, "mono");
    const target = path.join(tmpRoot, "target");

    buildMonorepo(mono);
    initRepo(target);
    writeAndCommit(target, ".gitkeep", "", "chore: init");

    const result = runMove(
      path.join(mono, "packages/auth/index.ts"),
      target,
      "auth.ts"
    );

    expect(result).not.toBe("dry-run");
    if (result === "dry-run") return;

    expect(fs.existsSync(path.join(target, "auth.ts"))).toBe(true);
    const content = fs.readFileSync(path.join(target, "auth.ts"), "utf-8");
    expect(content).toContain("v2");
    expect(result.commitCount).toBeGreaterThan(0);

    // Only the single file, not the whole directory
    expect(fs.existsSync(path.join(target, "logout.ts"))).toBe(false);
    expect(fs.existsSync(path.join(target, "README.md"))).toBe(false);
  });
});

describe("empty target repo", () => {
  test("moves into a repo with zero commits", () => {
    const mono = path.join(tmpRoot, "mono");
    const target = path.join(tmpRoot, "target");

    buildMonorepo(mono);
    // Init target with NO commits
    initRepo(target);

    const result = runMove(
      path.join(mono, "packages/auth"),
      target,
      "auth"
    );

    expect(result).not.toBe("dry-run");
    if (result === "dry-run") return;

    expect(fs.existsSync(path.join(target, "auth/index.ts"))).toBe(true);
    expect(result.commitCount).toBeGreaterThan(0);
  });
});

describe("dry run", () => {
  test("does not modify target repo", () => {
    const mono = path.join(tmpRoot, "mono");
    const target = path.join(tmpRoot, "target");

    buildMonorepo(mono);
    initRepo(target);
    writeAndCommit(target, ".gitkeep", "", "chore: init");

    const headBefore = git(["rev-parse", "HEAD"], target).stdout;
    const result = runMove(
      path.join(mono, "packages/auth"),
      target,
      "auth",
      true
    );
    const headAfter = git(["rev-parse", "HEAD"], target).stdout;

    expect(result).toBe("dry-run");
    expect(headBefore).toBe(headAfter);
    expect(fs.existsSync(path.join(target, "auth"))).toBe(false);
  });
});

describe("validation errors", () => {
  test("rejects nonexistent source", () => {
    const target = path.join(tmpRoot, "target");
    initRepo(target);
    writeAndCommit(target, ".gitkeep", "", "chore: init");

    expect(() =>
      runMove(path.join(tmpRoot, "nope/does-not-exist"), target, "stuff")
    ).toThrow("Source path does not exist");
  });

  test("rejects target with uncommitted changes", () => {
    const mono = path.join(tmpRoot, "mono");
    const target = path.join(tmpRoot, "target");

    buildMonorepo(mono);
    initRepo(target);
    writeAndCommit(target, ".gitkeep", "", "chore: init");
    // Create uncommitted change
    fs.writeFileSync(path.join(target, "dirty.txt"), "dirty", "utf-8");
    git(["add", "dirty.txt"], target);

    expect(() =>
      runMove(path.join(mono, "packages/auth"), target, "auth")
    ).toThrow("uncommitted changes");
  });

  test("rejects target path that already exists", () => {
    const mono = path.join(tmpRoot, "mono");
    const target = path.join(tmpRoot, "target");

    buildMonorepo(mono);
    initRepo(target);
    writeAndCommit(target, "auth/existing.txt", "taken", "chore: occupy path");

    expect(() =>
      runMove(path.join(mono, "packages/auth"), target, "auth")
    ).toThrow("already exists");
  });

  test("rejects non-git target directory", () => {
    const mono = path.join(tmpRoot, "mono");
    const notARepo = path.join(tmpRoot, "not-a-repo");
    fs.mkdirSync(notARepo, { recursive: true });

    buildMonorepo(mono);

    expect(() =>
      runMove(path.join(mono, "packages/auth"), notARepo, "auth")
    ).toThrow("not a git repository");
  });
});

describe("relay move (A → B → C)", () => {
  test("history survives a two-hop relay", () => {
    const repoA = path.join(tmpRoot, "repo-a");
    const repoB = path.join(tmpRoot, "repo-b");
    const repoC = path.join(tmpRoot, "repo-c");

    // Build repo A with some auth code
    buildMonorepo(repoA);

    // Move auth from A → B
    initRepo(repoB);
    writeAndCommit(repoB, ".gitkeep", "", "chore: init");
    const resultAB = runMove(
      path.join(repoA, "packages/auth"),
      repoB,
      "auth"
    );
    expect(resultAB).not.toBe("dry-run");
    if (resultAB === "dry-run") return;

    // Commit the staged merge in B
    git(["commit", "-m", "monopoly: import auth from repo-a"], repoB);

    // Add new work in B
    writeAndCommit(repoB, "auth/oauth.ts", 'export function oauth() { return "pkce"; }\n', "feat(auth): add oauth");

    // Move auth from B → C
    initRepo(repoC);
    writeAndCommit(repoC, ".gitkeep", "", "chore: init");
    const resultBC = runMove(
      path.join(repoB, "auth"),
      repoC,
      "auth"
    );
    expect(resultBC).not.toBe("dry-run");
    if (resultBC === "dry-run") return;

    // Commit the staged merge in C
    git(["commit", "-m", "monopoly: import auth from repo-b"], repoC);

    // C should have all auth files including the one added in B
    expect(fs.existsSync(path.join(repoC, "auth/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(repoC, "auth/oauth.ts"))).toBe(true);

    // History from B is reachable in C (the oauth commit added in B)
    const log = git(["log", "--oneline", "--all"], repoC);
    expect(log.stdout).toContain("feat(auth): add oauth");
  });
});

describe("default --as (basename)", () => {
  test("uses source basename when --as is omitted", () => {
    const mono = path.join(tmpRoot, "mono");
    const target = path.join(tmpRoot, "target");

    buildMonorepo(mono);
    initRepo(target);
    writeAndCommit(target, ".gitkeep", "", "chore: init");

    // No --as flag — should default to "auth" (basename of packages/auth)
    const result = runMove(path.join(mono, "packages/auth"), target);

    expect(result).not.toBe("dry-run");
    if (result === "dry-run") return;

    expect(fs.existsSync(path.join(target, "auth/index.ts"))).toBe(true);
    expect(result.targetFullPath).toContain("/auth");
  });
});

describe("dotfiles", () => {
  test("dotfiles survive the move", () => {
    const source = path.join(tmpRoot, "source");
    const target = path.join(tmpRoot, "target");

    initRepo(source);
    writeAndCommit(source, "mylib/.eslintrc.json", '{ "extends": "next" }\n', "chore: add eslint config");
    writeAndCommit(source, "mylib/.env.example", "DB_HOST=localhost\n", "chore: add env example");
    writeAndCommit(source, "mylib/index.ts", 'export const x = 1;\n', "feat: init mylib");

    initRepo(target);
    writeAndCommit(target, ".gitkeep", "", "chore: init");

    const result = runMove(path.join(source, "mylib"), target, "mylib");

    expect(result).not.toBe("dry-run");
    if (result === "dry-run") return;

    expect(fs.existsSync(path.join(target, "mylib/.eslintrc.json"))).toBe(true);
    expect(fs.existsSync(path.join(target, "mylib/.env.example"))).toBe(true);
    expect(fs.existsSync(path.join(target, "mylib/index.ts"))).toBe(true);

    const eslint = fs.readFileSync(path.join(target, "mylib/.eslintrc.json"), "utf-8");
    expect(eslint).toContain("next");
  });
});

describe("nested subdirectories", () => {
  test("deeply nested source structure is preserved", () => {
    const source = path.join(tmpRoot, "source");
    const target = path.join(tmpRoot, "target");

    initRepo(source);
    writeAndCommit(source, "pkg/src/core/utils/helpers.ts", "export const h = 1;\n", "feat: add helpers");
    writeAndCommit(source, "pkg/src/core/index.ts", "export * from './utils/helpers';\n", "feat: core barrel");
    writeAndCommit(source, "pkg/src/index.ts", "export * from './core';\n", "feat: src barrel");
    writeAndCommit(source, "pkg/package.json", '{ "name": "pkg" }\n', "chore: package.json");
    writeAndCommit(source, "pkg/__tests__/core.test.ts", "test('works', () => {});\n", "test: add core test");

    initRepo(target);
    writeAndCommit(target, ".gitkeep", "", "chore: init");

    const result = runMove(path.join(source, "pkg"), target, "pkg");

    expect(result).not.toBe("dry-run");
    if (result === "dry-run") return;

    expect(fs.existsSync(path.join(target, "pkg/src/core/utils/helpers.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "pkg/src/core/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "pkg/src/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "pkg/__tests__/core.test.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "pkg/package.json"))).toBe(true);

    const helpers = fs.readFileSync(path.join(target, "pkg/src/core/utils/helpers.ts"), "utf-8");
    expect(helpers).toContain("export const h");
  });
});

describe("round-trip (A → B → A)", () => {
  test("code returns home with accumulated history", () => {
    const repoA = path.join(tmpRoot, "repo-a");
    const repoB = path.join(tmpRoot, "repo-b");

    // Build repo A with auth module
    buildMonorepo(repoA);

    // Move auth from A → B
    initRepo(repoB);
    writeAndCommit(repoB, ".gitkeep", "", "chore: init");
    runMove(path.join(repoA, "packages/auth"), repoB, "auth");
    git(["commit", "-m", "monopoly: import auth from repo-a"], repoB);

    // Do new work in B
    writeAndCommit(repoB, "auth/mfa.ts", 'export function mfa() { return "totp"; }\n', "feat(auth): add MFA");

    // Move auth back from B → A (under a different path to avoid conflict)
    runMove(path.join(repoB, "auth"), repoA, "packages/auth-v2");
    git(["commit", "-m", "monopoly: return auth from repo-b"], repoA);

    // Original auth should still be there untouched
    expect(fs.existsSync(path.join(repoA, "packages/auth/index.ts"))).toBe(true);

    // Returned auth-v2 should have the new MFA file
    expect(fs.existsSync(path.join(repoA, "packages/auth-v2/mfa.ts"))).toBe(true);
    expect(fs.existsSync(path.join(repoA, "packages/auth-v2/index.ts"))).toBe(true);

    const mfa = fs.readFileSync(path.join(repoA, "packages/auth-v2/mfa.ts"), "utf-8");
    expect(mfa).toContain("totp");

    // Original repo history is intact (api commits still there)
    const apiLog = git(["log", "--oneline", "--", "packages/api/"], repoA);
    expect(apiLog.stdout).toContain("feat(api)");

    // The full graph has both histories merged
    const fullLog = git(["log", "--oneline", "--all"], repoA);
    expect(fullLog.stdout).toContain("feat(auth): add MFA");
    expect(fullLog.stdout).toContain("monopoly: return auth from repo-b");
  });
});

describe("multiple moves into same repo", () => {
  test("can move two different paths into the same target", () => {
    const mono = path.join(tmpRoot, "mono");
    const target = path.join(tmpRoot, "target");

    buildMonorepo(mono);
    initRepo(target);
    writeAndCommit(target, ".gitkeep", "", "chore: init");

    // First move: auth
    runMove(path.join(mono, "packages/auth"), target, "auth");
    git(["commit", "-m", "monopoly: import auth"], target);

    // Second move: api
    runMove(path.join(mono, "packages/api"), target, "api");
    git(["commit", "-m", "monopoly: import api"], target);

    expect(fs.existsSync(path.join(target, "auth/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "api/index.ts"))).toBe(true);
  });
});
