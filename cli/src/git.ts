import { spawnSync } from "child_process";
import path from "path";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

// Uses spawnSync (no shell) — safe against argument injection.
export function run(cmd: string, args: string[], cwd?: string): GitResult {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    // Default 1 MB is too small for git output on large monorepos.
    maxBuffer: 50 * 1024 * 1024,
    // Force a stable locale so git's output (notices, "CONFLICT" markers, etc.)
    // is deterministic regardless of the user's LANG/LC_ALL. Without this,
    // localized output would break any code that inspects what git printed.
    env: { ...process.env, LC_ALL: "C" },
  });
  return {
    stdout: (result.stdout ?? "").trimEnd(),
    stderr: (result.stderr ?? "").trimEnd(),
    exitCode: result.status ?? 1,
    success: result.status === 0,
  };
}

/** Normalize a path to forward slashes for git commands (Windows compat). */
export function toGitPath(p: string): string {
  return p.split(path.sep).join("/");
}

export function git(args: string[], cwd?: string): GitResult {
  return run("git", args, cwd);
}

export function requireSuccess(result: GitResult, message: string): void {
  if (!result.success) {
    throw new Error(`${message}: ${result.stderr}`);
  }
}

export function getGitVersion(): string {
  const result = git(["--version"]);
  if (!result.success) throw new Error("git is not installed or not in PATH.");
  return result.stdout.replace(/^git version\s+/, "").trim();
}

export function parseGitVersion(version: string): [number, number] {
  const parts = version.split(".");
  return [parseInt(parts[0] ?? "0", 10), parseInt(parts[1] ?? "0", 10)];
}

export function isGitRepo(dir: string): boolean {
  return git(["rev-parse", "--git-dir"], dir).success;
}

export function hasUncommittedChanges(dir: string): boolean {
  const status = git(["status", "--porcelain"], dir);
  return status.success && status.stdout.length > 0;
}

export function getCurrentBranch(dir: string): string {
  const result = git(["symbolic-ref", "--short", "HEAD"], dir);
  if (result.success) return result.stdout;
  return git(["rev-parse", "--short", "HEAD"], dir).stdout;
}

export function getHeadHash(dir: string): string {
  const result = git(["rev-parse", "HEAD"], dir);
  return result.success ? result.stdout : "";
}

export function countCommitsForPath(filePath: string, cwd: string): number {
  // --full-history defeats TREESAME simplification at merge boundaries
  const result = git(
    ["rev-list", "--count", "--full-history", "HEAD", "--", filePath],
    cwd
  );
  return result.success ? parseInt(result.stdout, 10) : 0;
}

export function countCommits(cwd: string): number {
  const result = git(["rev-list", "--count", "HEAD"], cwd);
  return result.success ? parseInt(result.stdout, 10) : 0;
}

export function hasAnyCommits(dir: string): boolean {
  return countCommits(dir) > 0;
}

export function findRepoRoot(startPath: string): string | null {
  const result = git(["rev-parse", "--show-toplevel"], startPath);
  return result.success ? result.stdout : null;
}
