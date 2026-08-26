# @waiting-room/plugin-claude

A [Claude Code](https://code.claude.com) plugin that pauses side activities and snaps tmux focus back when Claude needs you.

## What it does

The plugin ships four hook events (in [`hooks/hooks.json`](./hooks/hooks.json)) and one slash command:

| Hook | Action | Why |
| --- | --- | --- |
| `SessionStart` | Boots the daemon (downloads it on first call, cached thereafter) | One ownership point for the daemon lifecycle |
| `UserPromptSubmit` | Emits `agent_working` | Claude has work to do |
| `Stop` | Emits `agent_needs_attention --reason stop` | Claude is idle, waiting for input |
| `Notification` | Emits `agent_needs_attention --reason notification` | Permission prompt or idle notification |

The slash command (in [`skills/start/SKILL.md`](./skills/start/SKILL.md)) is `/waiting-room:start <game>`. It enumerates installed games (`waiting-room-snake`, `waiting-room-math`, …) and execs the one you pick. The plugin's `bin/waiting-room` script lives in the Bash tool's PATH while the plugin is enabled (Claude Code auto-adds `bin/` directories).

All hook commands are `"async": true` and the `bin/waiting-room` script fails open (exit 0 silently on any failure). Hooks never block or error Claude.

## Install

### Recommended (one command per step)

```
# 1. Add our marketplace (one-time, in any Claude session)
/plugin marketplace add alifarooqi/waiting-room-marketplace

# 2. Install the plugin (gets you the daemon + /waiting-room:start skill)
/plugin install waiting-room

# 3. Install one or more games
npm install -g @waiting-room/game-snake
npm install -g @waiting-room/exercise-math

# 4. In a tmux pane:
tmux new -s demo -d
tmux split-window -h -t demo
# left pane:
claude
# inside Claude:
/waiting-room:start                  # lists games, asks which to start
/waiting-room:start snake            # launches snake directly
```

### Quick test (this repo)

```
claude --plugin-dir ./packages/plugin-claude
```

`SessionStart` will fetch and cache the daemon on first call. `make build-daemon` to populate the dev-fallback binary.

### Without a marketplace

Copy `packages/plugin-claude/` to `~/.claude/skills/waiting-room/` — Claude loads it in every session.

### First-launch behavior

On the first `SessionStart`, the plugin's `bin/waiting-room` script downloads the matching `waiting-room_<os>_<arch>.tar.gz` from the v1.0.0 GitHub release into `bin/.wr-cache/`, verifies SHA-256 against the release's `checksums.txt`, and extracts the single binary. Subsequent launches reuse the cached binary. The script always exits 0 — if the network is unavailable, the install is skipped and a `.install.failed` marker is written; clear it to retry.

## How the resolver works

`bin/waiting-room` is a single POSIX sh script (~280 lines) that doubles as the resolver and the first-run installer. Every invocation goes through:

1. **Resolver-owned commands** (`version`, `help`, `list-games`, `launch <name>`) are handled here, never passed to the daemon.
2. **Cached binary fast path**: if `bin/.wr-cache/waiting-room` exists and matches `WAITING_ROOM_VERSION`, exec it directly. No network, no install.
3. **Install pipeline** (only on cache miss): detect platform → mkdir 0700 cache → curl tarball + checksums → verify SHA-256 → tar extract → chmod 0755 → stamp version. Any failure writes a `.install.failed` marker and exits 0.
4. **Daemon subcommand** (special-cased after install): `nohup` the cached binary detached with all stdio redirected, so the daemon outlives Claude's session lifecycle.
5. **Fallback chain**: `$WAITING_ROOM_BIN` env override → monorepo dev checkout → `waiting-room` on PATH → exit 0 fail-open.

## Troubleshooting

- **Daemon not running** after install: check `bin/.wr-cache/daemon.log` in the plugin folder.
- **Install failed**: `rm bin/.wr-cache/.install.failed` and try again.
- **Force a fresh install** (new daemon version): `rm bin/.wr-cache/waiting-room` and restart Claude.
- **Network unavailable on first launch**: the script fails open; activities will degrade silently (auto-pause unavailable) until you have network.
- **Override the binary path**: set `WAITING_ROOM_BIN=/path/to/waiting-room` in your shell env.

## Safety

- All hooks are async + fail-open. They cannot block Claude, suppress output, or break the session.
- Peer-credential UID check on the daemon's Unix Domain Socket (Linux `SO_PEERCRED`, macOS `LOCAL_PEERCRED`) prevents cross-user access on shared hosts.
- The plugin ships zero binaries (only the resolver script). The daemon binary is downloaded on first use and verified against a SHA-256 sum published by the maintainer.

See [`docs/security-uds.md`](../../docs/security-uds.md) for the full threat model.