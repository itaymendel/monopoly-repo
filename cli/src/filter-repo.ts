import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { run, type GitResult } from "./git";

const FILTER_REPO_URL =
  "https://raw.githubusercontent.com/newren/git-filter-repo/main/git-filter-repo";

interface FilterRepoCmd {
  command: string;
  prefixArgs: string[];
}

// Triple-state cache: undefined = not yet checked, null = checked & not found,
// value = resolved. Avoids re-running discovery on every call.
let cachedCmd: FilterRepoCmd | null | undefined;

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
  return run(resolved.command, [...resolved.prefixArgs, ...args], cwd);
}

export function isFilterRepoInstalled(): boolean {
  return resolveFilterRepo() !== null;
}

function resolveFilterRepo(): FilterRepoCmd | null {
  if (cachedCmd !== undefined) return cachedCmd;

  const existing = findFilterRepoOnDisk();
  if (existing) {
    cachedCmd = { command: existing, prefixArgs: [] };
    return cachedCmd;
  }

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

  // pip's macOS framework installs land under ~/Library/Python/<ver>/bin
  const pyLibDir = path.join(home, "Library", "Python");
  try {
    for (const ver of fs.readdirSync(pyLibDir)) {
      candidates.push(path.join(pyLibDir, ver, "bin", "git-filter-repo"));
    }
  } catch {
    // Directory absent on non-macOS or fresh systems — non-fatal.
  }

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

function provisionFilterRepo(): FilterRepoCmd | null {
  const python = findPython();
  if (!python) return null;

  const cacheDir = path.join(os.homedir(), ".cache", "monopoly");
  const scriptPath = path.join(cacheDir, "git-filter-repo");

  if (fs.existsSync(scriptPath)) {
    const check = spawnSync(python, [scriptPath, "--version"], {
      stdio: "ignore",
      timeout: 5000,
    });
    if (check.status === 0) return { command: python, prefixArgs: [scriptPath] };
    try {
      fs.unlinkSync(scriptPath);
    } catch {}
  }

  process.stderr.write("git-filter-repo not found, downloading...\n");

  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    return null;
  }

  if (!downloadFile(FILTER_REPO_URL, scriptPath)) return null;

  const check = spawnSync(python, [scriptPath, "--version"], {
    stdio: "ignore",
    timeout: 5000,
  });
  if (check.status !== 0) {
    try {
      fs.unlinkSync(scriptPath);
    } catch {}
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
  return wgetResult.status === 0;
}

function findPython(): string | null {
  const py3 = spawnSync("python3", ["--version"], {
    stdio: "ignore",
    timeout: 5000,
  });
  if (py3.status === 0) return "python3";

  // On Windows, Python 3 is often just "python".
  const py = spawnSync("python", ["--version"], {
    encoding: "utf-8",
    timeout: 5000,
  });
  if (py.status === 0 && (py.stdout ?? "").includes("Python 3")) {
    return "python";
  }

  return null;
}
