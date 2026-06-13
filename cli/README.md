# monopoly-repo

> Move code between git repos without losing history.

A small CLI that extracts a file or directory from one git repo and stages it
into another, carrying its full commit history along with it. Built on
[`git-filter-repo`](https://github.com/newren/git-filter-repo).

## Install

```sh
npm install -g monopoly-repo
```

Or run it on demand without installing:

```sh
npx monopoly-repo move <source> --to <repo> [--as <path>] [--dry-run]
```

The installed command is `monopoly`.

## Usage

```sh
monopoly move <source> --to <repo> [--as <path>] [--dry-run]
```

### Examples

```sh
# Move a package from a monorepo to a dedicated repo
monopoly move packages/auth --to ../auth-service --as auth

# Move a dedicated repo back into a monorepo
monopoly move auth --to ../my-monorepo --as packages/auth

# Preview without making changes
monopoly move src/utils/logger.ts --to ../shared --as logger.ts --dry-run
```

All changes are staged locally. Nothing is committed or pushed — you review
`git status` in the target repo and commit when ready.

## Requirements

- Node.js >= 18
- `git` and [`git-filter-repo`](https://github.com/newren/git-filter-repo) on your PATH

## License

MIT — see [LICENSE](./LICENSE). Learn more at [monopoly-repo.dev](https://monopoly-repo.dev).
