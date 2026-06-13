cd#!/usr/bin/env bash
#
# walkthrough.sh — A round-trip story for mono-poly.
#
# Builds three temporary git repos and walks one utility file through them:
#
#     app-monolith ──▶ shared-utils ──▶ date-fmt ──▶ app-monolith
#
# At every hop you'll see:
#   • why the move makes sense narratively
#   • the actual `monopoly move` command being run
#   • `git log --follow` on the moved file, showing accumulated history
#
# The point: a file's commit history survives every hop, including a round trip.
#
# Requirements:
#   • git ≥ 2.22
#   • monopoly on PATH  (npm i -g monopoly)
#       — override the binary by exporting MONOPOLY_BIN
#   • Python 3 the first time (mono-poly auto-fetches git-filter-repo into
#     ~/.cache/monopoly/ if it's not already on the system).
#
# Usage:
#   ./walkthrough.sh                 # build under a fresh mktemp dir
#   ./walkthrough.sh /tmp/some/dir   # build under your chosen dir
#   MONOPOLY_BIN=/path/to/monopoly ./walkthrough.sh   # use a non-PATH binary

set -euo pipefail

# --------------------------------------------------------------------------- #
# Config                                                                      #
# --------------------------------------------------------------------------- #

MONOPOLY="${MONOPOLY_BIN:-monopoly}"
WORKDIR="${1:-$(mktemp -d -t monopoly-walkthrough-XXXXXX)}"

# Each repo gets its own author identity so the final `git log` clearly
# shows commits travelling across team boundaries with their authorship intact.
A_ID=(-c user.email=alice@app-monolith.example -c user.name=Alice -c commit.gpgsign=false)
B_ID=(-c user.email=bob@shared-utils.example   -c user.name=Bob   -c commit.gpgsign=false)
C_ID=(-c user.email=carol@date-fmt.example     -c user.name=Carol -c commit.gpgsign=false)

# Auto-detect TTY for color so piping to a file gives clean output.
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BANNER=$'\033[1;36m'; C_DIM=$'\033[2m'; C_PROMPT=$'\033[1;33m'
else
  C_RESET=''; C_BANNER=''; C_DIM=''; C_PROMPT=''
fi

banner() { printf '\n%s═══ %s ═══%s\n\n' "$C_BANNER" "$1" "$C_RESET"; }
note()   { printf '%s# %s%s\n' "$C_DIM" "$1" "$C_RESET"; }
cmd()    { printf '%s$ %s%s\n' "$C_PROMPT" "$*" "$C_RESET"; "$@"; }

# --------------------------------------------------------------------------- #
# Sanity check                                                                #
# --------------------------------------------------------------------------- #

if ! command -v "$MONOPOLY" >/dev/null 2>&1 && [ ! -x "$MONOPOLY" ]; then
  echo "monopoly not found." >&2
  echo "  Install:  npm i -g monopoly" >&2
  echo "  Or set MONOPOLY_BIN to the path of a built binary." >&2
  exit 1
fi

mkdir -p "$WORKDIR"
echo "Workdir: $WORKDIR"

# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

# Run a git command in a repo with that repo's author identity.
# Resolves identity by matching the repo path against $A / $B / $C.
git_in() {
  local repo=$1; shift
  case "$repo" in
    "$A") git -C "$repo" "${A_ID[@]}" "$@" ;;
    "$B") git -C "$repo" "${B_ID[@]}" "$@" ;;
    "$C") git -C "$repo" "${C_ID[@]}" "$@" ;;
    *) echo "no identity registered for repo: $repo" >&2; exit 1 ;;
  esac
}

# Write a file and create a commit for it in the given repo, using that
# repo's author identity.
write_commit() {
  local repo=$1 file=$2 content=$3 msg=$4
  mkdir -p "$repo/$(dirname "$file")"
  printf '%s' "$content" > "$repo/$file"
  git_in "$repo" add "$file"
  git_in "$repo" commit -q -m "$msg"
}

init_repo() {
  local dir=$1
  git init -q -b main "$dir"
}

# --------------------------------------------------------------------------- #
banner "Setup: create three empty git repos"
# --------------------------------------------------------------------------- #

A="$WORKDIR/app-monolith"
B="$WORKDIR/shared-utils"
C="$WORKDIR/date-fmt"

init_repo "$A"
init_repo "$B"
init_repo "$C"

note "Repo A — app-monolith. The big in-house app where dateFormat() was born."
write_commit "$A" "README.md"           "# app-monolith"$'\n'                                              "chore: init monolith"
write_commit "$A" "src/billing.ts"      "export const charge = () => {}"$'\n'                              "feat(billing): scaffold module"
write_commit "$A" "src/dateFormat.ts" \
  "export function dateFormat(d: Date) {"$'\n'"  return d.toISOString();"$'\n'"}"$'\n' \
  "feat(util): add dateFormat()"
write_commit "$A" "src/dateFormat.ts" \
  "export function dateFormat(d: Date | number) {"$'\n'"  const date = typeof d === 'number' ? new Date(d * 1000) : d;"$'\n'"  return date.toISOString();"$'\n'"}"$'\n' \
  "feat(util): dateFormat handles unix timestamps"
write_commit "$A" "src/billing.test.ts" "test('charge', () => {})"$'\n'                                    "test(billing): basic test"
write_commit "$A" "src/dateFormat.ts" \
  "export function dateFormat(d: Date | number, opts?: { relative?: boolean }) {"$'\n'"  const date = typeof d === 'number' ? new Date(d * 1000) : d;"$'\n'"  if (opts?.relative) return relative(date);"$'\n'"  return date.toISOString();"$'\n'"}"$'\n'"function relative(d: Date) { return '...'; }"$'\n' \
  "feat(util): dateFormat supports relative time strings"

note "Repo B — shared-utils. A small library repo with a couple of utilities already in it."
write_commit "$B" "README.md"        "# shared-utils"$'\n'                          "chore: init shared-utils"
write_commit "$B" "src/cache.ts"     "export const cache = new Map()"$'\n'          "feat: add cache util"
write_commit "$B" "src/throttle.ts"  "export const throttle = () => {}"$'\n'        "feat: add throttle util"

note "Repo C — date-fmt. Brand-new, intended as a public OSS package."
git_in "$C" commit -q --allow-empty -m "chore: init date-fmt"

note "All three repos initialised under $WORKDIR"

# --------------------------------------------------------------------------- #
banner "Hop 1 of 3 — A (app-monolith) → B (shared-utils)"
# --------------------------------------------------------------------------- #
note "Three services started copy-pasting dateFormat. Time to graduate it"
note "into shared-utils so everyone depends on one canonical version."

cd "$A"
cmd "$MONOPOLY" move src/dateFormat.ts --to "$B" --as src/dateFormat.ts

note "mono-poly leaves the merge un-committed. Finalise it (Bob, in shared-utils):"
cmd git_in "$B" commit -q --no-edit

note "Mono-poly never deletes from the source. Do that ourselves (Alice, in app-monolith):"
cmd git_in "$A" rm -q src/dateFormat.ts
cmd git_in "$A" commit -q -m "chore: dateFormat moved to shared-utils"

note "Now make the file evolve a bit more inside shared-utils:"
write_commit "$B" "src/dateFormat.ts" \
  "// timezone-aware"$'\n'"export function dateFormat(d: Date | number, opts?: { relative?: boolean }) {"$'\n'"  const date = typeof d === 'number' ? new Date(d * 1000) : d;"$'\n'"  if (opts?.relative) return relative(date);"$'\n'"  return date.toISOString();"$'\n'"}"$'\n'"function relative(d: Date) { return '...'; }"$'\n' \
  "fix(dateFormat): tighten DST/timezone edges"
write_commit "$B" "src/dateFormat.ts" \
  "// timezone-aware, strict-mode safe"$'\n'"export function dateFormat(d: Date | number, opts?: { relative?: boolean }): string {"$'\n'"  const date = typeof d === 'number' ? new Date(d * 1000) : d;"$'\n'"  if (opts?.relative) return relative(date);"$'\n'"  return date.toISOString();"$'\n'"}"$'\n'"function relative(_d: Date): string { return '...'; }"$'\n' \
  "chore(dateFormat): strict-mode types"

note "git log on the file in shared-utils — every original A commit is here,"
note "alongside the new B commits and the chore restructure that mono-poly added:"
cd "$B"
cmd git log --full-history --oneline -- src/dateFormat.ts

# --------------------------------------------------------------------------- #
banner "Hop 2 of 3 — B (shared-utils) → C (date-fmt)"
# --------------------------------------------------------------------------- #
note "It's good enough that other companies want it. Spin it out as an"
note "open-source npm package living in its own repo."

cd "$B"
cmd "$MONOPOLY" move src/dateFormat.ts --to "$C" --as src/dateFormat.ts

note "Finalise the merge (Carol, in date-fmt):"
cmd git_in "$C" commit -q --no-edit

note "And remove the source from shared-utils (Bob):"
cmd git_in "$B" rm -q src/dateFormat.ts
cmd git_in "$B" commit -q -m "chore: dateFormat moved to date-fmt OSS"

note "OSS-flavoured edits in date-fmt:"
write_commit "$C" "src/dateFormat.ts" \
  "export function dateFormat(d: Date | number, opts?: { relative?: boolean; locale?: string }): string {"$'\n'"  const date = typeof d === 'number' ? new Date(d * 1000) : d;"$'\n'"  if (opts?.relative) return relative(date, opts?.locale);"$'\n'"  return date.toLocaleString(opts?.locale);"$'\n'"}"$'\n'"function relative(_d: Date, _l?: string): string { return '...'; }"$'\n' \
  "feat: i18n locale support"
write_commit "$C" "src/dateFormat.ts" \
  "export function dateFormat(d: Date | number, opts?: { relative?: boolean; locale?: string }): string {"$'\n'"  if (d == null) throw new TypeError('dateFormat: missing input');"$'\n'"  const date = typeof d === 'number' ? new Date(d * 1000) : d;"$'\n'"  if (opts?.relative) return relative(date, opts?.locale);"$'\n'"  return date.toLocaleString(opts?.locale);"$'\n'"}"$'\n'"function relative(_d: Date, _l?: string): string { return '...'; }"$'\n' \
  "fix: throw on null/undefined input"

note "git log in date-fmt — A's commits, B's commits, plus C's new ones:"
cd "$C"
cmd git log --full-history --oneline -- src/dateFormat.ts

# --------------------------------------------------------------------------- #
banner "Hop 3 of 3 — C (date-fmt) → A (app-monolith)    /// round trip"
# --------------------------------------------------------------------------- #
note "The monolith needs an emergency fix gated behind a feature flag the OSS"
note "release doesn't have yet. Vendor the file back into app-monolith and"
note "carry on; the OSS version is still upstream."

cd "$C"
cmd "$MONOPOLY" move src/dateFormat.ts --to "$A" --as src/dateFormat.ts

note "Finalise the merge (Alice, back in app-monolith):"
cmd git_in "$A" commit -q --no-edit

note "git log in the now-final app-monolith — the file's whole journey,"
note "with each commit attributed to the engineer who wrote it. Note that"
note "the early commits appear twice: the round trip re-imports the file's"
note "lineage on top of the original A-side ancestry, leaving two parallel"
note "chains in the graph. Both preserve the original authorship and dates."
cmd git log --full-history --pretty="format:%h  %<(7)%an  %s" -- src/dateFormat.ts
echo

note "git blame on the file — note line 3 still attributes to Alice, who wrote"
note "that line originally in app-monolith. The line survived three filter-repo"
note "rewrites and came home with its authorship intact:"
cmd git blame --date=short -- src/dateFormat.ts

# --------------------------------------------------------------------------- #
banner "Done."
# --------------------------------------------------------------------------- #
echo "Three repos are sitting in $WORKDIR — explore them:"
echo
echo "  $A"
echo "  $B"
echo "  $C"
echo
echo "A few useful commands to try:"
echo "  cd $A && git log --full-history --stat -- src/dateFormat.ts"
echo "  cd $A && git blame -- src/dateFormat.ts"
echo "  cd $A && git log --full-history --pretty=fuller -- src/dateFormat.ts | head -60"
echo
echo "(The original commits' authors and timestamps are preserved verbatim;"
echo " only the merge commits at each hop carry the walkthrough's identity.)"
