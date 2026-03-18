# monopoly

Move code between git repositories without losing history.

Monopoly is a thin CLI wrapper around [git-filter-repo](https://github.com/newren/git-filter-repo). All it does is provide a friendly interface for extracting code from one repo into another, including commit history. After the move, `git log`, `git blame`, and `git bisect` work across the boundary as if the code was always there.

Nothing is committed or pushed automatically. You review the staged changes and decide when to finalize.

## Prerequisites

- **git** 2.22+
- **Python 3** - needed by [git-filter-repo](https://github.com/newren/git-filter-repo)

## Install

```bash
npx monopoly move <source> --to <repo>
```

## Usage

```
monopoly move <source> --to <repo> [--as <path>] [--dry-run]
```

| Option | Description |
|---|---|
| `<source>` | File or directory to move (e.g. `packages/auth`) |
| `--to <repo>` | Path to the target repository |
| `--as <path>` | Where the code lands in the target (default: source basename) |
| `--dry-run` | Preview what would happen without making changes |

## Examples

Graduate a package out of a monorepo:

```bash
cd my-monorepo
npx monopoly move packages/auth --to ../auth-service --as auth
```

Bring a module back into a monorepo:

```bash
cd auth-service
npx monopoly move auth --to ../my-monorepo --as packages/auth
```

Move a single file:

```bash
npx monopoly move src/utils/logger.ts --to ../shared-lib --as logger.ts
```

Preview first:

```bash
npx monopoly move packages/auth --to ../auth-service --as auth --dry-run
```

## What happens after a move

Monopoly stages the changes in the target repo and stops:

```
✓ Move staged in ../auth-service

  Source:  packages/auth (14 commits extracted)
  Target:  ../auth-service/auth
  Seam:    staged (not yet committed)

  Review the staged changes:
    cd ../auth-service && git status

  When ready:
    git commit
    git push
```

From there:

1. Review with `git status` and `git diff`
2. Commit: `git commit`
3. Push: `git push`
4. Optionally remove from the source repo:
   ```bash
   git rm -r packages/auth
   git commit -m "chore: remove packages/auth (moved to auth-service)"
   ```

## Safety

If something is wrong, monopoly exits without making changes:

- Target path already exists in the target repo
- Target repo has uncommitted changes
- Source path has no git history
- Target is not a git repository
- Required tools are missing or too old

## Monopoly does not

- **Commit or push.** That's always your call.
- **Delete from the source repo.** It suggests the command but never runs it.
- **Resolve conflicts.** If the target path is occupied, it stops.
- **Touch remotes.** Everything is local.

## How it works

Under the hood, monopoly runs a well-known sequence of git operations:

1. Clone the source repo to a temp directory
2. Run `git-filter-repo` to extract the target path's history
3. Restructure files to match the desired target layout
4. Fetch the filtered history into the target repo
5. Merge with `--allow-unrelated-histories --no-commit`
6. Write metadata to `.git/MERGE_MSG` and `.monopoly.json`

The merge commit acts as a **seam** - a traceable link between the old and new life of the code. All commits from the source are reachable in the target's history.

## Related tools

- **[git-filter-repo](https://github.com/newren/git-filter-repo)** - The tool that does the actual work. Use it directly if you need more control.
- **[Copybara](https://github.com/google/copybara)** - Google's tool for ongoing code sync between repos. Use this if you need continuous mirroring.
- **[splitsh-lite](https://github.com/splitsh/lite)** - Fast one-way monorepo splits. Use this if you're splitting and never looking back.
- **[git subtree](https://git-scm.com/docs/git-subtree)** - Built into git. Merges repos into subdirectories, but history gets messy on round-trips.
- **[josh](https://github.com/josh-project/josh)** - A git proxy for bidirectional virtual repo views.

Monopoly does one thing: **move code from A to B with its full git history, once**. No config files, no ongoing sync, no CI integration. One command, review the result, commit when ready.

## License

MIT
