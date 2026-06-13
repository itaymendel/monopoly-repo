# monopoly

Move code between git repositories including history, keeping `git log`, `git blame`, and `git bisect` work.

Supports moving from A->B->C, and even back to A.

## Motivation

Born from a similar bash script I used when files needed to move across repos, to calm some of my peers who cared deeply about preserving git history. Recently I decided to bundle this up in this simple CLI alongside the [monopoly-repo.dev](monopoly-repo.dev) pragmatic approach for repo setups.

## Prerequisites

- **git** 2.22+
- **Python 3**

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
# and manually delete files
```

If you alreday comitted moved file, do a normal `reset` flow:

```
git reset --soft HEAD~1   # undo the commit, keep files staged
git reset HEAD            # unstage everything                                                                                                                                                                                                                                   
git checkout .            # discard the files  
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

## License

MIT
