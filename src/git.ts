import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

function exec(cmd: string, args: string[], cwd?: string): GitResult {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
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
  return exec("git", args, cwd);
}

export function filterRepo(args: string[], cwd?: string): GitResult {
  const resolved = resolveFilterRepo();
  if (!resolved) {
    return {
      stdout: "",
      stderr: "git-filter-repo not found and could not be auto-installed",
      exitCode: 1,
      success: false,
    };
  }
  return exec(resolved.command, [...resolved.prefixArgs, ...args], cwd);
}

export function isFilterRepoInstalled(): boolean {
  return resolveFilterRepo() !== null;
}

export function getGitVersion(): string {
  const result = git(["--version"]);
  if (!result.success) throw new Error("git is not installed or not in PATH.");
  return result.stdout.replace(/^git version\s+/, "").trim();
}

export function parseGitVersion(version: string): [number, number, number] {
  const parts = version.split(".");
  return [
    parseInt(parts[0] ?? "0", 10),
    parseInt(parts[1] ?? "0", 10),
    parseInt(parts[2] ?? "0", 10),
  ];
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

// --- filter-repo resolution ---

const FILTER_REPO_URL =
  "https://raw.githubusercontent.com/newren/git-filter-repo/main/git-filter-repo";

interface FilterRepoCmd {
  command: string;
  prefixArgs: string[];
}

let cachedCmd: FilterRepoCmd | null | undefined;

function resolveFilterRepo(): FilterRepoCmd | null {
  if (cachedCmd !== undefined) return cachedCmd;

  // 1. Try existing installs
  const existing = findFilterRepoOnDisk();
  if (existing) {
    cachedCmd = { command: existing, prefixArgs: [] };
    return cachedCmd;
  }

  // 2. Try auto-provisioning (download + cache)
  cachedCmd = provisionFilterRepo();
  return cachedCmd;
}

function findFilterRepoOnDisk(): string | null {
  const envPath = process.env.GIT_FILTER_REPO;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const check = spawnSync("git-filter-repo", ["--version"], {
    stdio: "ignore",
    timeout: 5000,
  });
  if (check.status === 0) return "git-filter-repo";

  const home = os.homedir();
  const candidates = [
    path.join(home, ".local", "bin", "git-filter-repo"),
    "/usr/local/bin/git-filter-repo",
    "/opt/homebrew/bin/git-filter-repo",
  ];

  // macOS Python framework installs
  const pyLibDir = path.join(home, "Library", "Python");
  try {
    for (const ver of fs.readdirSync(pyLibDir)) {
      candidates.push(path.join(pyLibDir, ver, "bin", "git-filter-repo"));
    }
  } catch {}

  return (
    candidates.find((c) => {
      try {
        return fs.existsSync(c);
      } catch {
        return false;
      }
    }) ?? null
  );
}

// --- auto-provisioning ---

function provisionFilterRepo(): FilterRepoCmd | null {
  const python = findPython();
  if (!python) return null;

  const cacheDir = path.join(os.homedir(), ".cache", "monopoly");
  const scriptPath = path.join(cacheDir, "git-filter-repo");

  // Already cached from a previous run
  if (fs.existsSync(scriptPath)) {
    const check = spawnSync(python, [scriptPath, "--version"], {
      stdio: "ignore",
      timeout: 5000,
    });
    if (check.status === 0) return { command: python, prefixArgs: [scriptPath] };
    // Cached copy is broken — re-download
    try { fs.unlinkSync(scriptPath); } catch {}
  }

  process.stderr.write("git-filter-repo not found, downloading...\n");

  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    return null;
  }

  if (!downloadFile(FILTER_REPO_URL, scriptPath)) return null;

  // Verify the downloaded script works
  const check = spawnSync(python, [scriptPath, "--version"], {
    stdio: "ignore",
    timeout: 5000,
  });
  if (check.status !== 0) {
    try { fs.unlinkSync(scriptPath); } catch {}
    return null;
  }

  process.stderr.write("git-filter-repo ready.\n");
  return { command: python, prefixArgs: [scriptPath] };
}

function downloadFile(url: string, dest: string): boolean {
  const curlResult = spawnSync("curl", ["-fsSL", "-o", dest, url], {
    stdio: "ignore",
    timeout: 30000,
  });
  if (curlResult.status === 0) return true;

  const wgetResult = spawnSync("wget", ["-q", "-O", dest, url], {
    stdio: "ignore",
    timeout: 30000,
  });
  if (wgetResult.status === 0) return true;

  return false;
}

function findPython(): string | null {
  const py3 = spawnSync("python3", ["--version"], {
    stdio: "ignore",
    timeout: 5000,
  });
  if (py3.status === 0) return "python3";

  // On Windows, Python 3 is often just "python"
  const py = spawnSync("python", ["--version"], {
    encoding: "utf-8",
    timeout: 5000,
  });
  if (py.status === 0 && (py.stdout ?? "").includes("Python 3")) {
    return "python";
  }

  return null;
}
