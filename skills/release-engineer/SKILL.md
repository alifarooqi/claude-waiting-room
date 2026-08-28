---
name: release-engineer
description: Use when preparing a release for the Waiting Room monorepo. Knows the per-package changesets flow, the two release axes (npm via changesets vs goreleaser binary tarballs), and the most common failure modes. Invoke when authoring a `.changeset/*.md`, bumping the daemon binary, cutting a release, or debugging a failed release-npm run.
allowed-tools: Bash(pnpm *), Bash(gh workflow *), Bash(gh run *), Bash(git *), Bash(make *), Bash(scripts/*), Bash(curl *), Bash(node *), Bash(npm view *), Bash(grep *), Read, Edit
---

# Waiting Room — release engineering

The full rules of the road live in `CLAUDE.md` at the repo root. **Read it first.** This skill is a pointer; it does not duplicate the content.

## First stop

Read `/CLAUDE.md` — it has the changeset rules, the two release axes, the common failure-mode table, and the code conventions.

## Then read on for context

- **`docs/releasing.md`** — cookbook for the human release flow (when to run `make bump-waiting-room-version`, when to add a changeset, when to push a goreleaser tag).
- **`.changeset/config.json`** — confirms `linked: []` (per-package independent), `updateInternalDependencies: "patch"` (auto-widens `^1.x.0` for declared dependents on bump).
- **`.github/workflows/release-npm.yml`** — the actual publish pipeline; has the load-bearing `~/.npmrc` step and the sequential publish loop. Read it before debugging CI failures.
- **`scripts/bump-waiting-room-version.sh`** — when the **daemon binary** changes (not the plugin), this script keeps the resolver's hardcoded `WAITING_ROOM_VERSION` and the plugin manifest's `version` in lock-step with the goreleaser tag axis.

## What this skill is good for

Use it when the user asks any of:

- "Cut a release for <package>."
- "I just merged a change to <package>; should I release?"
- "The release-npm workflow failed — what went wrong?"
- "Bump the daemon binary" (use `make bump-waiting-room-version`).
- "Why isn't <package> on npm yet?"

## What this skill is NOT for

- Writing new activity code (see `examples/writing-an-activity.md`).
- General Claude Code plugin authoring (see `.claude-plugin/plugin.json` + `hooks/hooks.json`).
- Daemon binary hacking (see `daemon/` + `docs/architecture.md`).

## When in doubt

- `pnpm changeset status` — read-only, safe to run anywhere.
- `gh run list --workflow=release-npm --limit=5` — see recent publish outcomes.
- `npm view @waiting-room/<name> version` — what's actually on npm right now.
