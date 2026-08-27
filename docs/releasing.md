# Releasing

This repo has **two release axes** that are independent and must both be
managed when shipping:

1. **npm packages** under the `@waiting-room/*` scope (9 packages).
 Managed by [Changesets](https://github.com/changesets/changesets),
 published by `.github/workflows/release-npm.yml` on merge to `main`.
2. **Daemon binary tarballs** downloaded by the install-on-first-hook
 resolver inside `packages/plugin-claude/bin/waiting-room`. Managed by
 `daemon/.goreleaser.yaml`, published by `.github/workflows/release.yml`
 on `v*` tag push.

This doc covers the human-run steps. CI does the rest.

## When the plugin code changes (no daemon change)

1. Add a `.changeset/<name>.md` to your PR:

   ```md
   ---
   "@waiting-room/plugin-claude": patch
   ---

   Short summary of the change.
   ```

2. Merge to `main`. The `release-npm.yml` workflow fires; it bumps
   `plugin-claude` to the new version and publishes it. **You don't
   need to do anything for the daemon binary** — `WAITING_ROOM_VERSION`
   stays at its current value.

## When the daemon binary changes

The daemon binary lives in `daemon/cmd/waiting-room/` and is published as
4 platform-specific tarballs by goreleaser. The install-on-first-hook
resolver's hardcoded `WAITING_ROOM_VERSION` points at the GitHub release
tag (e.g. `v1.0.3`) where those tarballs live.

1. Make the change in `daemon/`. Test locally.
2. **Bump the resolver + manifest** in lock-step with the goreleaser tag
   you're about to push:

   ```bash
   make bump-waiting-room-version NEW_VERSION=v1.0.3
   # updates WAITING_ROOM_VERSION=v1.0.3 in bin/waiting-room
   # updates "version": "1.0.3" in .claude-plugin/plugin.json
   ```

3. Commit + push those changes:

   ```bash
   git add packages/plugin-claude
   git commit -m "chore(daemon): bump to v1.0.3"
   git push origin main
   ```

4. **Tag the goreleaser release** (triggers the binary tarball publish):

   ```bash
   git tag v1.0.3 main
   git push origin v1.0.3
   ```

5. Wait for goreleaser to publish the 4 tarballs + `checksums.txt` under
   the v1.0.3 release. (CI: `.github/workflows/release.yml`.)

6. **Then** add a Changeset and let `release-npm.yml` ship the npm-side
   bump. (If you skip this step, the npm package stays at its old version
   while the daemon tarball is already on the new one — that's fine for
   a daemon-only release, but you still need a Changeset PR to bump
   `plugin-claude` so the marketplace's version range picks it up.)

## When the SDK changes (breaks downstream games)

A minor or major SDK bump should also bump `game-snake` and
`exercise-math` (they declare `"@waiting-room/sdk": "^1.0.0"` in their
`package.json`). With `updateInternalDependencies: "patch"` in
`.changeset/config.json`, this happens automatically: a Changeset that
bumps `@waiting-room/sdk` to minor will also bump the games' declared
range to `^1.X.0`. **However, that only updates the range, not the
package's own version.** If you want the games to be re-published
(visible to users as a fresh release), the games' own changesets need
to be added too.

## First-time setup (one-time per developer)

- Clone the repo with `pnpm install` (Corepack-pinned `pnpm@10.29.1`).
- Run `pnpm changeset status` to confirm everything is wired up.

## First-time setup (one-time per repo, on GitHub)

- Generate an npm **Automation** token at https://www.npmjs.com/settings/~/tokens
 (type: Automation; scopes: publish).
- Add it as `NPM_TOKEN` in this repo's Settings → Secrets and variables
 → Actions → New repository secret.
- `GITHUB_TOKEN` is auto-provisioned; no setup needed.
- The `alifarooqi/waiting-room-marketplace` repo has its own scheduled
 workflow (option B from the plan) that widens its `version` range to
 `^MAJOR.MINOR.0` within 6h of any new plugin-claude publish.

## Verifying a release locally

```bash
# dry-run the version bump (no commit, no publish)
pnpm changeset status
pnpm changeset version
git diff   # inspect
git checkout -- packages/
rm -rf .changeset/*.md
```

The release workflow is best exercised by opening a small changeset PR
and watching CI; once you've seen one clean run, you can trust the
process.

## When things go wrong

- **Publish fails with 401/403:** your `NPM_TOKEN` is wrong or expired.
 Rotate and re-add.
- **No changesets publish:** you merged a PR without adding a `.changeset/*.md`.
 Hotfix: open a new PR with a changeset, merge.
- **Plugin versions out of sync with the daemon binary:** bump the
 goreleaser tag first (`v1.0.3`), then publish the new resolver via a
 normal `.changeset/*.md` PR. The marketplace range widens within 6h.
- **The marketplace still pins `^1.0.0` after 6h:** the marketplace
 workflow needs debugging; check its run logs.