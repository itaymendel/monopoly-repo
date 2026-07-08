import fs from "fs";
import path from "path";
import os from "os";
import {
  git,
  getCurrentBranch,
  hasAnyCommits,
  hasUnmergedEntries,
  countCommits,
  requireSuccess,
  toGitPath,
} from "./git";
import { filterRepo } from "./filter-repo";
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
  requireSuccess(
    git(["clone", "--single-branch", ctx.sourceRepoRoot, "extract"], tmpDir),
    "Failed to clone source repo"
  );

  const extractDir = path.join(tmpDir, "extract");

  // Set a local identity so the restructure commit below doesn't fail when
  // the user has no global git identity configured.
  requireSuccess(
    git(["config", "user.email", "monopoly@local"], extractDir),
    "Failed to configure git identity"
  );
  requireSuccess(
    git(["config", "user.name", "monopoly"], extractDir),
    "Failed to configure git identity"
  );

  const filterFlag = ctx.isDirectory ? "--subdirectory-filter" : "--path";
  requireSuccess(
    filterRepo(
      [filterFlag, ctx.extractionPath, "--force", "--quiet"],
      extractDir
    ),
    "git-filter-repo failed"
  );

  return extractDir;
}

/**
 * After --subdirectory-filter, files land at the repo root.
 * Move them into the target subdirectory so they end up at the right path
 * when merged into the target repo.
 */
function restructureDirectory(extractDir: string, targetPath: string): void {
  // Read entries BEFORE creating the target dir. An extracted entry can share a
  // name with the target path's top level (e.g. moving a package that contains
  // its own `auth/` while --as is `auth`); excluding that name to avoid moving
  // the target dir into itself would silently drop the entry at the wrong path.
  // Instead we stage everything through a uniquely-named temp dir that cannot
  // collide with any extracted entry, then rename it onto the target path.
  const entries = fs.readdirSync(extractDir).filter((e) => e !== ".git");

  // Nothing was extracted: committing an empty index would fail, and there is
  // nothing to restructure or merge.
  if (entries.length === 0) return;

  // mkdtemp's random suffix guarantees the staging dir cannot collide with
  // any extracted entry.
  const tmpDir = path.basename(
    fs.mkdtempSync(path.join(extractDir, ".monopoly-restructure-"))
  );
  requireSuccess(
    git(["mv", ...entries, tmpDir], extractDir),
    "Failed to restructure files"
  );

  // Nested target paths (e.g. "libs/auth") need their parent to exist so the
  // temp dir is renamed ONTO the leaf rather than into an existing directory.
  const parent = path.dirname(targetPath);
  if (parent !== ".") {
    fs.mkdirSync(path.join(extractDir, parent), { recursive: true });
  }
  requireSuccess(
    git(["mv", tmpDir, targetPath], extractDir),
    "Failed to restructure files"
  );

  requireSuccess(
    git(
      ["commit", "-m", "chore(monopoly): restructure for target path"],
      extractDir
    ),
    "Failed to commit restructured files"
  );
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

  requireSuccess(
    git(["mv", originalPath, targetName], extractDir),
    "Failed to restructure file"
  );

  requireSuccess(
    git(
      ["commit", "-m", "chore(monopoly): restructure for target path"],
      extractDir
    ),
    "Failed to commit restructured file"
  );
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
  requireSuccess(
    git(["remote", "add", remoteName, extractDir], ctx.targetRepoRoot),
    "Failed to add temp remote"
  );

  try {
    requireSuccess(
      git(["fetch", remoteName], ctx.targetRepoRoot),
      "Failed to fetch from temp clone"
    );

    const extractBranch = getCurrentBranch(extractDir);
    // --allow-unrelated-histories is the load-bearing flag: by default git
    // refuses to merge histories with no common ancestor (a footgun in normal
    // use), but here it's exactly what we want — grafting a sub-history from
    // the source repo onto the target's unrelated history.
    const mergeResult = git(
      [
        "merge",
        `${remoteName}/${extractBranch}`,
        "--allow-unrelated-histories",
        "--no-commit",
      ],
      ctx.targetRepoRoot
    );

    // With --no-commit, a fully successful merge exits 0; anything else (a
    // conflict, or a hard failure) exits non-zero. We must NOT string-match
    // git's output to tell those apart: conflict notices are localized on
    // non-English systems and much of the text goes to stdout, not stderr —
    // both would make a text match miss real conflicts and print "success"
    // over a half-merged tree. Instead we check the index structurally, then
    // always abort to leave the target pristine before throwing.
    if (!mergeResult.success) {
      // Must probe before aborting — the abort clears the unmerged entries.
      const conflicted = hasUnmergedEntries(ctx.targetRepoRoot);
      const mergeOutput = [mergeResult.stdout, mergeResult.stderr]
        .filter(Boolean)
        .join("\n");

      git(["merge", "--abort"], ctx.targetRepoRoot);

      if (conflicted) {
        throw new Error(
          `Merge conflict: ${mergeOutput}. Resolve manually or choose a different --as path.`
        );
      }
      // Merge failed for a non-conflict reason (bad refs, etc.).
      throw new Error(`Merge failed: ${mergeOutput}`);
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
