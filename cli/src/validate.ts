import fs from "fs";
import path from "path";
import {
  getGitVersion,
  parseGitVersion,
  isGitRepo,
  hasUncommittedChanges,
  getCurrentBranch,
  getHeadHash,
  countCommitsForPath,
  findRepoRoot,
  toGitPath,
} from "./git";
import { isFilterRepoInstalled } from "./filter-repo";
import type { MoveArgs } from "./args";

export interface ValidatedContext {
  sourceRepoRoot: string;
  extractionPath: string;
  targetRepoRoot: string;
  sourceBranch: string;
  sourceHead: string;
  commitCount: number;
  isDirectory: boolean;
}

export function validate(args: MoveArgs): ValidatedContext {
  assertGitVersion();
  assertFilterRepoInstalled();

  const resolvedSource = path.resolve(args.source);
  const sourceStat = safeStat(resolvedSource);
  if (!sourceStat) {
    throw new Error(`Source path does not exist: ${args.source}`);
  }

  // Resolve symlinks so path.relative works correctly against git's
  // repo root (which is always a real path, not a symlink).
  const realSource = fs.realpathSync(resolvedSource);
  const isDirectory = sourceStat.isDirectory();
  const sourceDir = isDirectory ? realSource : path.dirname(realSource);
  const sourceRepoRoot = findRepoRoot(sourceDir);
  if (!sourceRepoRoot) {
    throw new Error(
      `Source path is not inside a git repository: ${args.source}`
    );
  }

  // Normalize to forward slashes — git and filter-repo expect Unix paths.
  const extractionPath = toGitPath(path.relative(sourceRepoRoot, realSource));
  if (!extractionPath || extractionPath.startsWith("..")) {
    throw new Error(
      `Source path is outside the repository root: ${args.source}`
    );
  }

  const sourceCommitCount = countCommitsForPath(extractionPath, sourceRepoRoot);
  if (sourceCommitCount === 0) {
    throw new Error(
      `No commits found for ${args.source}. The path exists but has no git history.`
    );
  }

  const resolvedTarget = path.resolve(args.to);
  if (!isGitRepo(resolvedTarget)) {
    throw new Error(`Target is not a git repository: ${args.to}`);
  }

  const targetRepoRoot = findRepoRoot(resolvedTarget) ?? resolvedTarget;

  if (hasUncommittedChanges(targetRepoRoot)) {
    throw new Error(
      `Target repo has uncommitted changes: ${args.to}. Commit or stash them first.`
    );
  }

  const targetFullPath = path.join(targetRepoRoot, args.as);
  if (fs.existsSync(targetFullPath)) {
    throw new Error(
      `Target path already exists: ${args.to}/${args.as}. Remove it or choose a different --as path.`
    );
  }

  return {
    sourceRepoRoot,
    extractionPath,
    targetRepoRoot,
    sourceBranch: getCurrentBranch(sourceRepoRoot),
    sourceHead: getHeadHash(sourceRepoRoot),
    commitCount: sourceCommitCount,
    isDirectory,
  };
}

function assertGitVersion(): void {
  const version = getGitVersion();
  const [major, minor] = parseGitVersion(version);
  // git-filter-repo's documented minimum — older git versions lack the
  // fast-export options it relies on.
  if (major < 2 || (major === 2 && minor < 22)) {
    throw new Error(`git >= 2.22.0 is required (found ${version}).`);
  }
}

function assertFilterRepoInstalled(): void {
  if (!isFilterRepoInstalled()) {
    throw new Error(
      "git-filter-repo is required and could not be auto-installed (needs Python 3 + network). " +
        "Install manually: pip install git-filter-repo"
    );
  }
}

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}
