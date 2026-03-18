import { VERSION } from "./version";
import type { MoveResult } from "./move";
import type { MoveArgs } from "./args";
import type { ValidatedContext } from "./validate";

const tty = process.stdout.isTTY;

const style = {
  green: (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
  bold: (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
};

export function printHelp(): void {
  console.log(`monopoly - Move code between git repos without losing history.

Usage:
  monopoly move <source> --to <repo> [--as <path>] [--dry-run]

Commands:
  move    Extract a file or directory from one repo and stage it
          into another, carrying its full git history.

Arguments:
  <source>              File or directory to move (e.g. packages/auth)

Options:
  --to <repo>           Path to locally cloned target repository
  --as <path>           Target path inside the repo (default: source basename)
  --dry-run             Show what would happen without making changes
  -h, --help            Show this help message
  -v, --version         Show version

Examples:
  monopoly move packages/auth --to ../stable --as auth
  monopoly move ../stable/auth --to . --as packages/auth
  monopoly move src/utils/logger.ts --to ../shared --as logger.ts

All changes are staged locally. Nothing is committed or pushed.`);
}

export function printVersion(): void {
  console.log(`monopoly ${VERSION}`);
}

export function printSuccess(result: MoveResult): void {
  console.log(`${style.green("✓")} Move staged in ${result.targetRepo}

  Source:  ${result.sourcePath} (${result.commitCount} commits extracted)
  Target:  ${result.targetFullPath}
  Seam:    staged (not yet committed)

  Review the staged changes:
    cd ${result.targetRepo} && git status

  When ready:
    git commit
    git push

  To remove the source from this repo:
    git rm -r ${result.sourcePath}
    git commit -m "chore: remove ${result.sourcePath} (graduated to ${result.targetRepo})"

  Don't forget to replace direct usage of ${result.sourcePath} with
  an external dependency (package, subtree, runtime import, etc).`);
}

export function printDryRun(args: MoveArgs, ctx: ValidatedContext): void {
  console.log(`${style.cyan("[dry-run]")} Would perform the following:

  1. Clone source repo to temp directory
  2. Run git-filter-repo to extract ${args.source}
  3. Restructure extracted files for target path: ${args.as}
  4. Fetch into ${args.to} and merge with --allow-unrelated-histories
  5. Write seam metadata to .git/MERGE_MSG
  6. Update .monopoly.json manifest
  7. Stage all changes (no commit)

  Source repo:     ${ctx.sourceRepoRoot}
  Source path:     ${ctx.extractionPath}
  Target repo:     ${ctx.targetRepoRoot}
  Target path:     ${args.as}
  Source branch:   ${ctx.sourceBranch}
  Source HEAD:     ${ctx.sourceHead}
  Commits:         ~${ctx.commitCount} (estimate from source history)
  Is directory:    ${ctx.isDirectory}

  ${style.bold("No changes were made.")}`);
}

export function printError(msg: string): void {
  console.error(`${style.red("Error:")} ${msg}`);
}
