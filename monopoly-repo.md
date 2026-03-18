# Mono-Poly History Preservation — Validation Plan

## Goal

Prove that code can be **graduated** out of a monorepo (and moved between repos) without losing git history. Validate three flows:

1. **Graduation** — monorepo → external repo (with history)
2. **Return** — external repo → monorepo (with history)
3. **Relay** — repo A → repo B → repo C (with history at every stop)
4. **Full Circle** — repo A → repo B → repo C → repo A (with history at every stop)

---

## Prerequisites

- **Git** ≥ 2.22.0 (required by `git filter-repo`)
- **git-filter-repo** — install via `pip install git-filter-repo` or `brew install git-filter-repo`
- A throwaway working directory — the plan creates and destroys repos freely, don't run this inside anything you care about
- ~30–60 minutes of uninterrupted time
- No other tools, languages, or runtimes required — everything is bash + git

---

## Approach: Graft-Chain Strategy

Rather than trying to keep original commit hashes intact (impossible once you rewrite paths), we **chain histories together** using `git merge --allow-unrelated-histories`. Each move creates a merge commit that acts as a **seam** — a traceable link between the old life and the new life of the code.

The result: `git log --follow` may not work across repo boundaries, but the full history is present in the repo and reachable. A merge commit message documents where the code came from and links to the source repo/commit.

For the initial extraction we use `git filter-repo` to cleanly isolate the subdirectory's history. For re-integration (return or relay), we use `git merge --allow-unrelated-histories` to graft the incoming history into the target repo.

---

## Phase 0: Setup — Create a Test Monorepo with Real-ish History

```bash
mkdir mono && cd mono && git init

# Simulate a monorepo with two modules: "auth" (will graduate) and "api" (stays)
mkdir -p packages/auth packages/api

# Commit 1 — initial auth module
echo 'export function login() { return "v1"; }' > packages/auth/index.ts
echo '{ "name": "@mono/auth", "version": "1.0.0" }' > packages/auth/package.json
git add . && git commit -m "feat(auth): initial login function"

# Commit 2 — initial api module
echo 'import { login } from "@mono/auth";' > packages/api/index.ts
echo '{ "name": "@mono/api", "version": "1.0.0" }' > packages/api/package.json
git add . && git commit -m "feat(api): initial api module"

# Commit 3–6 — build up auth history (the thing we'll graduate)
echo 'export function login() { return "v2"; }' > packages/auth/index.ts
git add . && git commit -m "fix(auth): patch login return value"

echo 'export function logout() { return true; }' >> packages/auth/index.ts
git add . && git commit -m "feat(auth): add logout function"

echo 'export function refresh() { return "token"; }' >> packages/auth/index.ts
git add . && git commit -m "feat(auth): add token refresh"

echo '# Auth Module' > packages/auth/README.md
git add . && git commit -m "docs(auth): add readme"

# Commit 7 — an api change (unrelated, should NOT appear in graduated repo)
echo 'console.log("api v2");' >> packages/api/index.ts
git add . && git commit -m "feat(api): api v2 logging"
```

**Checkpoint:** `git log --oneline` should show 7 commits. 5 touch `packages/auth/`.

---

## Phase 1: Graduation — Monorepo → External Repo

Extract `packages/auth` into its own repo, carrying only its history.

```bash
# Work on a fresh clone (git filter-repo requires this)
cd ..
git clone mono mono-auth-extract
cd mono-auth-extract

# Extract only packages/auth, rewrite it to be the repo root
git filter-repo \
  --subdirectory-filter packages/auth

# Tag the seam for traceability
git tag graduation-from-mono \
  -m "Graduated from mono repo. Original repo: ../mono"
```

### Verify

```bash
# Should show only auth-related commits (5 of them), no api commits
git log --oneline

# Files should be at root level: index.ts, package.json, README.md
ls

# Content should be intact
cat index.ts
```

**Expected:** 5 commits, all auth-related. Files at root. No packages/ prefix.

---

## Phase 2: Life in the External Repo

Simulate independent development in the graduated repo.

```bash
# Commit 8 — new work done outside the monorepo
echo 'export function mfa() { return "totp"; }' >> index.ts
git add . && git commit -m "feat(auth): add MFA support (post-graduation)"

echo 'export function sso() { return "saml"; }' >> index.ts
git add . && git commit -m "feat(auth): add SSO support (post-graduation)"
```

**Checkpoint:** `git log --oneline` should show 7 commits (5 original + 2 new).

---

## Phase 3: Return — External Repo → Monorepo

The auth module needs to come back (maybe it's getting active development again).

```bash
cd ../mono

# Prepare the incoming repo: move files into the target subdirectory
# We do this in a temp branch in the external repo
cd ../mono-auth-extract
git checkout -b prep-for-mono-return
mkdir -p packages/auth
git mv index.ts package.json README.md packages/auth/
git commit -m "chore: restructure for monorepo return"

# Now merge into monorepo
cd ../mono
git remote add auth-return ../mono-auth-extract
git fetch auth-return

git merge auth-return/prep-for-mono-return \
  --allow-unrelated-histories \
  --no-commit

# Resolve: packages/auth/ now has the latest version from the external repo.
# The monorepo's old packages/auth/ files will conflict — accept incoming.
git checkout --theirs packages/auth/
git add .
git commit -m "merge(auth): return auth module from external repo

Graduated auth module is returning to monorepo.
External repo had 2 additional commits (MFA, SSO).
Full external history is preserved in this merge."

# Clean up
git remote remove auth-return
```

### Verify

```bash
# Full history should be reachable
git log --oneline --all --graph

# Auth files should contain MFA and SSO additions
cat packages/auth/index.ts

# The graduated repo's commits should appear in the graph
git log --oneline -- packages/auth/
```

**Expected:** The merge commit stitches both histories. `git log --all --graph` shows two root commits converging at the merge. All 7 auth commits + 2 new ones are present.

---

## Phase 4: Relay — Repo A → Repo B → Repo C

Prove that code can hop between external repos without losing accumulated history.

### Step 4a: Create Repo B, move auth from external repo (A) into it

```bash
cd ..

# Repo A is mono-auth-extract (go back to main branch)
cd mono-auth-extract
git checkout main

# Create Repo B
cd ..
mkdir repo-b && cd repo-b && git init

# Bring in auth code from Repo A with full history
git remote add repo-a ../mono-auth-extract
git fetch repo-a

git merge repo-a/main \
  --allow-unrelated-histories \
  -m "merge: import auth module from repo-a (origin: monorepo)

Relay hop 1: monorepo → repo-a → repo-b
Full history chain preserved."

git remote remove repo-a

# Do some work in Repo B
echo 'export function oauth() { return "pkce"; }' >> index.ts
git add . && git commit -m "feat(auth): add OAuth PKCE (in repo-b)"
```

### Step 4b: Move from Repo B → Repo C

```bash
cd ..
mkdir repo-c && cd repo-c && git init

git remote add repo-b ../repo-b
git fetch repo-b

git merge repo-b/main \
  --allow-unrelated-histories \
  -m "merge: import auth module from repo-b (origin: monorepo → repo-a → repo-b)

Relay hop 2: monorepo → repo-a → repo-b → repo-c
Full history chain preserved."

git remote remove repo-b

# Do some work in Repo C
echo 'export function passkey() { return "webauthn"; }' >> index.ts
git add . && git commit -m "feat(auth): add passkey support (in repo-c)"
```

### Verify the Full Chain

```bash
# In repo-c, the entire history should be present
git log --oneline

# Expected commits (newest first):
# - feat(auth): add passkey support (in repo-c)      ← repo-c work
# - merge: import auth module from repo-b             ← seam B→C
# - feat(auth): add OAuth PKCE (in repo-b)            ← repo-b work
# - merge: import auth module from repo-a             ← seam A→B
# - feat(auth): add MFA support (post-graduation)     ← repo-a work
# - feat(auth): add SSO support (post-graduation)     ← repo-a work
# - docs(auth): add readme                            ← original monorepo
# - feat(auth): add token refresh                     ← original monorepo
# - feat(auth): add logout function                   ← original monorepo
# - fix(auth): patch login return value               ← original monorepo
# - feat(auth): initial login function                ← original monorepo

# The graph should show the merge seams clearly
git log --oneline --graph --all
```

**Expected:** 11 entries in log. Merge commits act as seams documenting each hop. Full history from the original monorepo through every relay is intact and reachable.

---

## Phase 5: Full Circle — Repo C → Back to Repo A (the original monorepo)

This is the ultimate test. Code that was born in the monorepo, graduated out, bounced through two external repos accumulating commits at each stop, and now returns home. The monorepo should end up with **every commit from the entire journey**.

### Step 5a: Prepare Repo C for re-entry into the monorepo

```bash
cd ../repo-c

# Create a branch that restructures files for the monorepo layout
git checkout -b prep-for-mono-return
mkdir -p packages/auth
git mv index.ts package.json README.md packages/auth/
git commit -m "chore: restructure for monorepo return (from repo-c)"
```

### Step 5b: Merge back into the original monorepo

```bash
cd ../mono

# The monorepo still has the old packages/auth/ from Phase 0
# (or the Phase 3 return if that was run — either way, we're merging over it)

git remote add auth-fullcircle ../repo-c
git fetch auth-fullcircle

git merge auth-fullcircle/prep-for-mono-return \
  --allow-unrelated-histories \
  --no-commit

# Accept the incoming (traveled) version of auth
git checkout --theirs packages/auth/
git add .
git commit -m "merge(auth): full circle return from repo-c

Complete journey: monorepo → repo-a → repo-b → repo-c → monorepo
All intermediate history from every hop is preserved in this merge.
Auth module now includes: MFA, SSO (repo-a), OAuth PKCE (repo-b), Passkey (repo-c)."

git remote remove auth-fullcircle
```

### Verify the Full Circle

```bash
# The monorepo should now contain BOTH its original history AND the full relay chain
git log --oneline --all --graph

# Check the auth file has everything from the journey
cat packages/auth/index.ts
# Expected contents:
# - login (v2), logout, refresh  ← original monorepo
# - mfa, sso                     ← repo-a
# - oauth                        ← repo-b
# - passkey                      ← repo-c

# Check that the ORIGINAL monorepo commits are still there too
# (api module commits, the original auth commits, etc.)
git log --oneline -- packages/api/
# Should still show the api commits untouched

# Most importantly: the full auth journey is reachable
git log --oneline -- packages/auth/
# Should show:
# - merge(auth): full circle return from repo-c          ← seam C→mono
# - chore: restructure for monorepo return (from repo-c) ← prep commit
# - feat(auth): add passkey support (in repo-c)          ← repo-c work
# - merge: import auth module from repo-b                ← seam B→C
# - feat(auth): add OAuth PKCE (in repo-b)               ← repo-b work
# - merge: import auth module from repo-a                ← seam A→B
# - feat(auth): add MFA support (post-graduation)        ← repo-a work
# - feat(auth): add SSO support (post-graduation)        ← repo-a work
# - docs(auth): add readme                               ← original mono
# - feat(auth): add token refresh                        ← original mono
# - feat(auth): add logout function                      ← original mono
# - fix(auth): patch login return value                  ← original mono
# - feat(auth): initial login function                   ← original mono
# PLUS the monorepo's own original auth commits (pre-graduation)

# Count the merge seams — there should be 3 visible in the graph:
# 1. repo-a → repo-b
# 2. repo-b → repo-c
# 3. repo-c → monorepo (the full circle)
```

**Expected:** The monorepo now has two convergent histories in its graph — its own original linear history, and the full relay chain from A→B→C. They merge at the full-circle seam commit. All commits from every repo are reachable. The auth module files reflect every feature added along the journey.

### The Interesting Edge Case

The monorepo will now have **duplicate auth commits** — the original ones from Phase 0 (before graduation) AND the ones that were carried through the relay chain (which are technically different commit hashes, since `git filter-repo` rewrote them in Phase 1). This is actually fine:

- The **pre-graduation** commits live on the monorepo's original branch of the graph
- The **traveled** commits (same content, different hashes) live on the relay chain branch
- They converge at the full-circle merge commit
- `git log --all --graph` makes this visually clear

This is a feature, not a bug — it shows the complete story: "this code was born here, left, traveled, and came home."

---

## Phase 6: Bridging the Seams — `git replace --graft`

Phases 1–5 prove the history is *preserved* — all commits are reachable. But there's a UX problem: `git log --follow`, `git blame`, and other commands that follow a single linear path will stop at seam boundaries. Developers have to know to use `--all` to get the full picture.

`git replace --graft` can fix this. It creates a lightweight ref that tells git "pretend this commit descends from that one" — effectively making the seam invisible to all standard git commands without rewriting any history.

The goal of this phase: validate that replace refs make `git log --follow` and `git blame` work seamlessly across seams, and understand the operational cost of maintaining them.

### Step 6a: Bridge a single seam (Phase 3 return merge)

Run this in the monorepo after Phase 5 is complete.

```bash
cd mono

# Identify the full-circle merge commit (Phase 5)
MERGE_COMMIT=$(git log --merges -1 --format="%H")

# Find both parents of the merge
# Parent 1 = monorepo's own history
# Parent 2 = the incoming relay chain
MONO_PARENT=$(git log --merges -1 --format="%P" | awk '{print $1}')
RELAY_PARENT=$(git log --merges -1 --format="%P" | awk '{print $2}')

# Find the root commit of the relay chain (the oldest commit with no parent)
RELAY_ROOT=$(git rev-list --max-parents=0 $RELAY_PARENT)

# Graft: make the relay chain's root appear to descend from the monorepo parent
git replace --graft $RELAY_ROOT $MONO_PARENT
```

### Verify single seam bridge

```bash
# BEFORE the graft, this would stop at the seam:
git log --follow --oneline -- packages/auth/index.ts

# AFTER the graft, it should now show the FULL history —
# original monorepo commits + relay chain — as one continuous line.

# Same for blame:
git blame packages/auth/index.ts
# Should trace through the seam into the relay chain's history
# and show the original monorepo commits as authors
```

**Expected:** `--follow` and `blame` now see a continuous history. No `--all` needed.

### Step 6b: Bridge all seams in the relay chain

The relay chain (A→B→C) has its own internal seams from Phase 4. If the evaluator has time, bridge those too:

```bash
# List all merge commits in the repo
git log --merges --oneline --all

# For each merge commit that is a seam (identifiable by the seam message convention),
# repeat the graft pattern:
# 1. Find the merge's two parents
# 2. Find the root of the "incoming" parent
# 3. Graft that root onto the "existing" parent
```

This is intentionally left as manual exploration — the goal is to understand whether bridging *nested* seams (seams within seams from the relay) works cleanly or has edge cases.

### Step 6c: Validate replace ref portability

Replace refs live in `refs/replace/` and aren't shared by default. Test whether they survive clone and push:

```bash
# Push replace refs to a remote (use a bare repo to simulate)
cd ..
git clone --bare mono mono-remote.git
cd mono
git remote add test-remote ../mono-remote.git
git push test-remote 'refs/replace/*'

# Clone from the remote and check if grafts are present
cd ..
git clone mono-remote.git mono-clone

# Configure the clone to fetch replace refs
cd mono-clone
git config --add remote.origin.fetch '+refs/replace/*:refs/replace/*'
git fetch origin

# Verify: does --follow work in the clone?
git log --follow --oneline -- packages/auth/index.ts
```

**Expected:** The grafts survive the round-trip through push/clone/fetch. `--follow` works in the fresh clone.

### Step 6d: Test what happens when replace refs are missing

```bash
# In the clone, remove replace refs to simulate a "naive" clone
git replace -l | xargs -I {} git replace -d {}

# Now try --follow again
git log --follow --oneline -- packages/auth/index.ts

# It should degrade gracefully back to the Phase 5 behavior:
# stops at the seam, but history is still reachable via --all
git log --all --oneline -- packages/auth/index.ts
```

**Expected:** Graceful degradation. Without replace refs, behavior is identical to Phase 5. The grafts are an enhancement, not a dependency. The underlying history is never altered.

### Questions for the evaluator

These are open questions — not pass/fail criteria, but things to explore and report back on:

1. **Nested seams:** When bridging the full-circle seam, does `--follow` also cross the relay seams (A→B, B→C) automatically, or does each seam need its own graft?
2. **Blame accuracy:** After grafting, does `git blame` attribute lines to the correct original author and timestamp, or does the seam merge commit "steal" attribution?
3. **Performance:** With multiple replace refs, is there any noticeable slowdown on `git log` or `git blame`?
4. **IDE support:** Do common tools (VS Code GitLens, JetBrains Git integration) respect replace refs? Or do they only work in the terminal?
5. **CI/CD:** Do GitHub/GitLab web UIs display grafted history correctly? (This one may require pushing to a real remote to test.)

---

## Verification Checklist

For each phase, confirm:

| Check | Phase 1 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |
|---|---|---|---|---|---|
| All original auth commits present | ✅ | ✅ | ✅ | ✅ | ✅ |
| No unrelated commits leaked in | ✅ | n/a | n/a | n/a | n/a |
| Post-graduation commits present | n/a | ✅ | ✅ | ✅ | ✅ |
| Relay hop commits present | n/a | n/a | ✅ | ✅ | ✅ |
| Merge seam commit documents origin | n/a | ✅ | ✅ | ✅ | ✅ |
| `git log --graph` shows chain | n/a | ✅ | ✅ | ✅ | ✅ |
| File contents are correct | ✅ | ✅ | ✅ | ✅ | ✅ |
| Monorepo's own history untouched | n/a | ✅ | n/a | ✅ | ✅ |
| Duplicate commits visible (expected) | n/a | n/a | n/a | ✅ | ✅ |
| `git log --follow` crosses seams | n/a | n/a | n/a | n/a | ✅ |
| `git blame` crosses seams | n/a | n/a | n/a | n/a | ✅ |
| Replace refs survive push/clone | n/a | n/a | n/a | n/a | ✅ |
| Graceful degradation without refs | n/a | n/a | n/a | n/a | ✅ |

---

## Known Limitations

- **Commit hashes change** after `git filter-repo`. The seam merge commit message should record the original repo URL and the last commit hash before extraction for manual traceability.
- **Conflicts on return.** If the monorepo's copy of the module was modified after graduation (it shouldn't be in the mono-poly pattern, but mistakes happen), the merge will produce conflicts that need manual resolution.
- **Replace refs require explicit sharing.** `refs/replace/*` must be pushed and fetched explicitly — they don't travel with a normal `git clone`. This is a configuration requirement that would need to be documented per-repo or baked into a CLI tool.

---

## Potential Automation

If this pattern proves sound, the graduation and return flows could be wrapped in a small CLI tool:

```
mono-poly graduate <path> --to <repo-url>    # filter-repo + push
mono-poly return <repo-url> --into <path>    # fetch + merge (works for full circle too)
mono-poly relay <from-repo> --to <to-repo>   # fetch + merge chain
mono-poly history <path>                     # show full journey with seams highlighted
```

Each command would automatically:
- Create the seam merge commit with structured metadata
- Tag the source repo with the graduation point
- Update a `.mono-poly.json` manifest tracking where things live

---

## Success Criteria

The validation **passes** if all of the following are true after completing Phase 6:

1. **No history loss.** Every auth-related commit from the original monorepo is reachable via `git log --all` in every repo it passed through — including back in the monorepo after full circle.
2. **No history contamination.** The graduated repo (Phase 1) contains zero commits that only touched `packages/api/` or other unrelated code.
3. **Seams are traceable.** Each merge commit clearly documents the source repo and the journey so far. A developer reading the log can reconstruct the full path the code took without external documentation.
4. **Content integrity.** At every phase, the auth module's files are byte-correct — no lost lines, no mangled content, no missing files.
5. **Monorepo integrity.** After the full circle return (Phase 5), the monorepo's own non-auth history (api module, etc.) is completely untouched. No rewritten hashes, no missing commits.
6. **Graph is readable.** `git log --oneline --graph --all` in the final monorepo state shows two clear branches of history converging at the return merge — the monorepo's original linear history and the relay chain. A human can visually trace the journey.
7. **Seams are transparent (Phase 6).** After applying `git replace --graft`, `git log --follow` and `git blame` cross seam boundaries without requiring `--all`. Standard developer workflows (blame a line, trace a file) work as if the code never moved.
8. **Graceful degradation (Phase 6).** Removing the replace refs returns behavior to Phase 5 baseline. The grafts are an enhancement layer — nothing breaks without them.

The validation **fails** if any of the following occur:

- A commit that existed in the previous phase is unreachable in the next phase
- File contents differ unexpectedly between phases
- A merge requires conflict resolution that isn't documented in the plan (unexpected conflicts indicate the approach has a gap)
- The monorepo's non-auth commits are altered in any way
- Replace refs corrupt or alter the underlying commit graph (they should only add virtual parent pointers, never modify real objects)

---

## Deliverables

Capture and return the following artifacts for each phase:

| # | Artifact | How to capture |
|---|---|---|
| 1 | `git log --oneline --graph --all` output at end of each phase (0–6) | Copy terminal output to a text file |
| 2 | `git log --oneline -- packages/auth/` (or `-- .` in external repos) at end of each phase | Confirms auth-specific history |
| 3 | `cat` of `index.ts` at end of each phase | Confirms content integrity |
| 4 | `git log --oneline -- packages/api/` in the monorepo at end of Phase 5 | Confirms non-auth history is untouched |
| 5 | Screenshot or text capture of the Phase 5 full graph | The visual proof of the full circle |
| 6 | `git log --follow --oneline -- packages/auth/index.ts` **before** and **after** grafting (Phase 6) | The hero artifact — proves seams become invisible |
| 7 | `git blame packages/auth/index.ts` **after** grafting (Phase 6) | Proves blame crosses seams |
| 8 | `git log --follow --oneline -- packages/auth/index.ts` after removing replace refs (Phase 6d) | Proves graceful degradation |
| 9 | A brief pass/fail note against each success criterion | Written assessment |
| 10 | Answers to the Phase 6 open questions (nested seams, IDE support, etc.) | Notes — not pass/fail, just observations |

Optional but nice:
- If anything failed or required improvisation, document what went wrong and how it was resolved
- If the evaluator has opinions on the approach (e.g. "this would break with binary files" or "the merge conflicts were worse than expected"), capture those as notes