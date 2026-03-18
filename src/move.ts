import fs from "fs";
import path from "path";
import os from "os";
import { git, filterRepo, getCurrentBranch, hasAnyCommits, countCommits, toGitPath } from "./git";
import type { ValidatedContext } from "./validate";
import type { MoveArgs } from "./args";

export interface MoveResult {
  sourcePath: string;
  targetRepo: string;
  targetFullPath: string;
  commitCount: number;
}

export function executeMove(args: MoveArgs, ctx: ValidatedContext): MoveResult {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "monopoly-"));
  // Normalize to forward slashes for git commands (Windows compat).
  const targetAs = toGitPath(args.as);

  try {
    const extractDir = cloneAndFilter(tmpDir, ctx);
    const commitCount = countCommits(extractDir);

    if (ctx.isDirectory) {
      restructureDirectory(extractDir, targetAs);
    } else {
      restructureFile(extractDir, ctx.extractionPath, targetAs);
    }

    mergeIntoTarget(extractDir, targetAs, ctx, commitCount);

    return {
      sourcePath: args.source,
      targetRepo: args.to,
      targetFullPath: `${args.to}/${targetAs}`,
      commitCount,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function cloneAndFilter(tmpDir: string, ctx: ValidatedContext): string {
  const cloneResult = git(
    ["clone", "--single-branch", ctx.sourceRepoRoot, "extract"],
    tmpDir
  );
  if (!cloneResult.success) {
    throw new Error(`Failed to clone source repo: ${cloneResult.stderr}`);
  }

  const extractDir = path.join(tmpDir, "extract");

  const emailResult = git(["config", "user.email", "monopoly@local"], extractDir);
  if (!emailResult.success) {
    throw new Error(`Failed to configure git identity: ${emailResult.stderr}`);
  }
  const nameResult = git(["config", "user.name", "monopoly"], extractDir);
  if (!nameResult.success) {
    throw new Error(`Failed to configure git identity: ${nameResult.stderr}`);
  }

  const filterFlag = ctx.isDirectory ? "--subdirectory-filter" : "--path";
  const filterResult = filterRepo(
    [filterFlag, ctx.extractionPath, "--force", "--quiet"],
    extractDir
  );
  if (!filterResult.success) {
    throw new Error(`git-filter-repo failed: ${filterResult.stderr}`);
  }

  return extractDir;
}

/**
 * After --subdirectory-filter, files land at the repo root.
 * Move them into the target subdirectory so they end up at the right path
 * when merged into the target repo.
 */
function restructureDirectory(extractDir: string, targetPath: string): void {
  fs.mkdirSync(path.join(extractDir, targetPath), { recursive: true });

  const topLevel = targetPath.split("/")[0];
  const entries = fs.readdirSync(extractDir).filter(
    (e) => e !== ".git" && e !== topLevel
  );

  if (entries.length > 0) {
    const mvResult = git(["mv", ...entries, targetPath], extractDir);
    if (!mvResult.success) {
      throw new Error(`Failed to restructure files: ${mvResult.stderr}`);
    }
  }

  const commitResult = git(
    ["commit", "-m", "chore(monopoly): restructure for target path"],
    extractDir
  );
  if (!commitResult.success) {
    throw new Error(`Failed to commit restructured files: ${commitResult.stderr}`);
  }
}

/**
 * After --path filter, the file sits at its original relative path.
 * Move it to the desired target name if they differ.
 */
function restructureFile(
  extractDir: string,
  originalPath: string,
  targetName: string
): void {
  if (originalPath === targetName) return;

  const targetDir = path.dirname(targetName);
  if (targetDir !== ".") {
    fs.mkdirSync(path.join(extractDir, targetDir), { recursive: true });
  }

  const mvResult = git(["mv", originalPath, targetName], extractDir);
  if (!mvResult.success) {
    throw new Error(`Failed to restructure file: ${mvResult.stderr}`);
  }

  const commitResult = git(
    ["commit", "-m", "chore(monopoly): restructure for target path"],
    extractDir
  );
  if (!commitResult.success) {
    throw new Error(`Failed to commit restructured file: ${commitResult.stderr}`);
  }
}

function mergeIntoTarget(
  extractDir: string,
  targetAs: string,
  ctx: ValidatedContext,
  commitCount: number
): void {
  if (!hasAnyCommits(ctx.targetRepoRoot)) {
    git(
      ["commit", "--allow-empty", "-m", "chore: initialize repository"],
      ctx.targetRepoRoot
    );
  }

  const remoteName = "monopoly-temp";
  const addResult = git(
    ["remote", "add", remoteName, extractDir],
    ctx.targetRepoRoot
  );
  if (!addResult.success) {
    throw new Error(`Failed to add temp remote: ${addResult.stderr}`);
  }

  try {
    const fetchResult = git(["fetch", remoteName], ctx.targetRepoRoot);
    if (!fetchResult.success) {
      throw new Error(
        `Failed to fetch from temp clone: ${fetchResult.stderr}`
      );
    }

    const extractBranch = getCurrentBranch(extractDir);
    const mergeResult = git(
      [
        "merge",
        `${remoteName}/${extractBranch}`,
        "--allow-unrelated-histories",
        "--no-commit",
      ],
      ctx.targetRepoRoot
    );

    if (mergeResult.stderr.includes("CONFLICT")) {
      git(["merge", "--abort"], ctx.targetRepoRoot);
      throw new Error(
        `Merge conflict: ${mergeResult.stderr}. Resolve manually or choose a different --as path.`
      );
    }
  } finally {
    git(["remote", "remove", remoteName], ctx.targetRepoRoot);
  }

  writeMergeMessage(targetAs, ctx, commitCount);
}

function writeMergeMessage(
  targetAs: string,
  ctx: ValidatedContext,
  commitCount: number
): void {
  const sourceRepoName = path.basename(ctx.sourceRepoRoot);
  const msg = `monopoly: move ${sourceRepoName}:${ctx.extractionPath} → ${targetAs}

Source repo:   ${ctx.sourceRepoRoot}
Source path:   ${ctx.extractionPath}
Source HEAD:   ${ctx.sourceHead}
Extracted:     ${commitCount} commits
`;

  const gitDirResult = git(["rev-parse", "--git-dir"], ctx.targetRepoRoot);
  const gitDir = gitDirResult.success
    ? path.resolve(ctx.targetRepoRoot, gitDirResult.stdout)
    : path.join(ctx.targetRepoRoot, ".git");
  fs.writeFileSync(path.join(gitDir, "MERGE_MSG"), msg, "utf-8");
}
