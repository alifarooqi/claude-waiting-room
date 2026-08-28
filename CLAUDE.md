# Waiting Room — Claude Notes

pnpm monorepo with **9 npm packages** under `@waiting-room/*` plus a Go daemon (`daemon/`).

## ⛔⛔⛔ HARD RULE: NO DIRECT PUSHES TO MAIN ⛔⛔⛔

**EVERY change — no matter how small — must go through a branch + pull request.**

Direct pushes to `main` are FORBIDDEN. No exceptions for "just a docs tweak", "just a typo", "just bumping a number", or "just the smoke test". The user reviews every PR before merge.

**The reason:** `release-npm.yml` fires on every push to `main` and ships whatever changesets are present. A stray direct push can publish unintended npm versions with no human in the loop. The user explicitly added this rule after a debugging session, and the cost of bypassing it is higher than the cost of opening a PR.

**The right pattern for every task:**

```bash
# 1. create a feature branch (off main, freshly pulled)
git checkout main
git pull --rebase
git checkout -b <short-descriptive-name>

# 2. do the work
# ... edits ...

# 3. commit
git add -A
git commit -m "..."

# 4. push the branch (NOT main)
git push origin HEAD

# 5. open a PR with `gh pr create` (or via the GitHub web UI)
gh pr create --fill --base main

# 6. WAIT for user review. Do NOT merge on the user's behalf.
# 7. after user approves, the user (or their reviewer) merges.
#    the release-npm workflow fires automatically on the merge commit.
```

**If you (the AI assistant) accidentally stage a commit on `main`, STOP. Do not push it. Move the work to a branch first, then push the branch.**

**If the user explicitly asks you to bypass this rule, confirm twice before doing it. The default is always: branch + PR.**

---

## The two release axes (read first)

1. **npm packages** — managed by Changesets. Auto-published by `.github/workflows/release-npm.yml` on push to main. Authored by `.changeset/*.md` files in PRs.
2. **Daemon binary tarballs** — managed by goreleaser (`daemon/.goreleaser.yaml`). Auto-published by `.github/workflows/release.yml` on `v*` tag push.

Full cookbook: **`docs/releasing.md`**.

## When to add a `.changeset/*.md`

Add one if your change ships **user-visible behavior** to any `@waiting-room/*` package.

| You changed | Changeset names |
| --- | --- |
| `packages/<name>/src/...` | `@waiting-room/<name>` |
| `packages/<name>/hooks/...` or `bin/...` (plugin-claude) | `@waiting-room/plugin-claude` |
| `packages/<name>/bin/waiting-room` (new binary) | `@waiting-room/<cli-platform-pkg>` + optionally `@waiting-room/cli` |
| Multiple packages in one PR | list each on its own line in the frontmatter |
| `daemon/**` Go code (e.g. new protocol field) | `@waiting-room/sdk` |
| `docs/**`, `Makefile`, `scripts/**`, `.github/**`, `CLAUDE.md`, `README.md`, `examples/**` | **no changeset** (CI/infra/docs don't ship to npm) |

Format:

```md
---
"@waiting-room/sdk": patch
---

One-sentence summary.
```

Bump types: `patch` (fix), `minor` (feature), `major` (breaking). Multiple changesets naming the same package **sum** their bump types (`patch` + `minor` → `minor`; `major` always wins).

## Local verification

```bash
pnpm changeset status       # lists pending changesets
pnpm changeset version      # bumps versions, deletes consumed changesets
git diff packages/         # inspect the bumps
git checkout -- packages/  # undo
rm -rf .changeset/*.md     # clean up
```

## Common failure modes (and the one-line fix)

| Symptom | Fix |
| --- | --- |
| `pnpm changeset version` fans out 10× → OOM | Don't add `"changeset": "pnpm changeset"` to per-package `package.json` scripts. Workflow invokes it directly. |
| `repository.url is ""` (provenance 422) | All 9 shipping `package.json`s need `"repository": { "type": "git", "url": "https://github.com/alifarooqi/claude-waiting-room" }` (no `.git` suffix, no `directory` subpath). |
| `Unexpected input(s) 'npm-token'` from `changesets/action@v1` | v1 of the action has no `npm-token` input. Pass via the step's `env:` block; write `~/.npmrc` from `secrets.NPM_TOKEN`. |
| `pnpm publish` 401/403 | `secrets.NPM_TOKEN` wrong/expired; rotate at npmjs.com → Access Tokens. |
| `Cannot find module 'packages/sdk//package.json'` | Trailing slash from glob; `//` reads as UNC. Strip: `dir=${dir%/}`. |

## First-time setup

- **Per developer:** `npm login --scope=@waiting-room` (must own the npm org).
- **Per repo (CI):** add `NPM_TOKEN` (npm **Automation** token, publish scope) at Settings → Secrets and variables → Actions → New repository secret.

## Code conventions worth knowing

- The plugin's `bin/waiting-room` is a single POSIX sh file. **No bashisms** (no `[[`, no arrays, no `local`, no `${var,,}`).
- `make cli-pack` populates the 4 gitignored `cli-*` binaries before any publish. Always run it in the workflow before `pnpm changeset publish`.
- TS packages use `workspace:*` for in-repo deps. On publish, pnpm rewrites these to the published range (`^1.0.0` etc.).
- `WAITING_ROOM_VERSION` in `bin/waiting-room` + the plugin manifest's `version` are coupled to the **goreleaser tag axis** (not the npm version axis). See `scripts/bump-waiting-room-version.sh` + `docs/releasing.md`.
