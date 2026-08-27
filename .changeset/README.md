# Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) for
per-package independent versioning and automated npm publishing. Every PR
that ships a user-visible change must add **one or more `.changeset/*.md`
files** under this directory that name the affected packages and pick the
bump type (`patch`, `minor`, `major`).

## Authoring a changeset

Run `pnpm changeset` (or write the file by hand). The format:

```md
---
"@waiting-room/sdk": patch
"@waiting-room/game-snake": patch
---

Short summary of the change.
```

The `frontmatter` (between the two `---` lines) names which packages this PR
bumps and to what level. With `linked: []` and `fixed: []` in `config.json`,
each package version is bumped independently — adding a changeset for one
package does not affect the others. `updateInternalDependencies: "patch"`
means a minor SDK release will also bump dependent packages' declared
ranges on the SDK (`game-snake`, `exercise-math`).

## The release flow

1. PR merges to `main`.
2. `.github/workflows/release-npm.yml` runs:
 - Builds TS packages.
 - Cross-compiles the 4 platform binaries (`make cli-pack`) so the
   `cli-darwin-*` / `cli-linux-*` packages have a real binary in their
   `bin/` (these are gitignored; without `cli-pack`, those packages
   would publish empty).
 - `changesets/action@v1` runs `pnpm changeset version` (deletes the
   consumed changesets, bumps `package.json` versions, writes per-package
   `CHANGELOG.md`, commits `chore(release): version packages` back to
   `main`).
 - Then runs `pnpm changeset publish` (publishes only packages whose
   version differs from what's already on npm, with provenance).
3. If the daemon binary changed (rare), separately bump and push a
   `v*` tag — `release.yml` runs goreleaser to publish the binary
   tarballs + `checksums.txt` to the GitHub release.

## Conventions

- One changeset file per logical concern; the filename is ignored.
- Use `patch` for bug fixes, `minor` for new features, `major` for breaking
  changes. Match the conventional-commits prefix in your commit subject
  (`feat:` → minor, `fix:` → patch, `feat!:` or `BREAKING CHANGE:` footer
  → major) when relevant.
- Don't add a changeset for purely-internal refactors or CI changes; those
  don't ship to users.

## Verifying locally

```bash
pnpm changeset status       # lists pending changesets
pnpm changeset version      # bumps versions locally; doesn't push or publish
git diff                    # inspect the bump
git checkout -- packages/   # undo
rm -rf .changeset/*.md      # clean up
```

The release workflow handles publish; you only need `pnpm changeset status`
locally to double-check before pushing.