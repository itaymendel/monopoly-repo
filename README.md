# monopoly

Move code between git repositories with its full commit history. Once you commit the move, `git log --follow` and `git blame` walk straight back to the original commits.

Supports moving from A->B->C, and even back to A.

## Motivation

Born from a similar bash script I used when files needed to move across repos, to calm some of my peers who cared deeply about preserving git history. Recently I decided to bundle this up in this simple CLI alongside the [monopoly-repo.dev](https://monopoly-repo.dev) pragmatic approach for repo setups.

## Prerequisites

- **git** 2.22+
- **Python 3**
- **git-filter-repo** — if it isn't already installed (env var, `PATH`, or a known location), monopoly downloads a pinned, checksum-verified copy of `git-filter-repo` `v2.47.0` into `~/.cache/monopoly/` and runs it with Python 3. To avoid the download, install it yourself with `pip install git-filter-repo` or `brew install git-filter-repo`.

## Usage

```
npx monopoly-repo move <source> --to <repo> [--as <path>] [--dry-run]
```

Examples

```bash
cd my-monorepo
npx monopoly-repo move packages/auth --to ../auth-service --as auth # Move a package from a monorepo to a dedicated repo

cd auth-service
npx monopoly-repo move auth --to ../my-monorepo --as packages/auth  # Move a dedicated repo back to the monorepo

npx monopoly-repo move src/logger.ts --to ../shared                 # Move a file from a repo to shared-utils repo
```

> Installing globally (`npm i -g monopoly-repo`) gives you a shorter `monopoly` command.

**After moving, you review and modify code to ensure things work.**

Monopoly does not:

- **Commit or push.** That's always your call.
- **Delete from the source repo.** It suggests the command but never runs it.
- **Resolve conflicts.** If the target path is occupied, it stops.
- **Touch remotes.** Everything is local.

## Undo a Move

If you haven't committed:

```
cd target-repo
git merge --abort
```

`git merge --abort` restores the pre-merge state — no manual deletion needed.

If you already committed the moved files and the merge commit hasn't been pushed, roll it back:

```
git reset --hard HEAD~1   # drops the merge commit and its files
```

> `git reset --hard` discards *all* uncommitted changes in the working tree. Only run it if you have no other unrelated work in progress.

If the merge was already pushed, don't rewrite history — revert it instead:

```
git revert -m 1 <merge-commit>
```

## How it works

Monopoly runs a sequence of git operations:

1. Clone the source repo to a temp directory
2. Run `git-filter-repo` to extract the target path's history
3. Restructure files to match the desired target layout
4. Fetch the filtered history into the target repo
5. Merge with `--allow-unrelated-histories --no-commit`
6. Write seam metadata to `.git/MERGE_MSG`

The merge commit acts as a traceable link between the old and new life of the code so all commits from the source are reachable in the target's history.

## Optional: one continuous history

After you commit, `git log --follow` and `git blame` already trace across the move. If you also want plain `git log` and `git bisect` to see one unbroken line — worth it when you chain moves across several repos — monopoly prints a ready-to-run `git replace --graft` command after each move. It re-parents the imported history onto the target's tip without rewriting a single commit, and you can share it with your team by pushing `refs/replace/*`. Delete the graft and you're back to the plain (still fully reachable) history — it's an overlay, never a rewrite.

## License

MIT
