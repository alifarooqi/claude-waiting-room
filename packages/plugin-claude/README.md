# @waiting-room/plugin-claude

A [Claude Code](https://code.claude.com) plugin that emits Claude's lifecycle state — **working** vs **needs attention** — to the [Waiting Room](../../README.md) daemon.

## How it works

The plugin registers three fire-and-forget (`"async": true`) hooks in [`hooks/hooks.json`](./hooks/hooks.json):

| Claude Code hook | Emitted event | Meaning |
| --- | --- | --- |
| `UserPromptSubmit` | `agent_working` | User submitted a prompt → Claude is working. |
| `Stop` | `agent_needs_attention` | Main agent finished → idle, waiting for the human. |
| `Notification` | `agent_needs_attention` | Permission request pending or idle prompt. |

Each hook invokes `${CLAUDE_PLUGIN_ROOT}/bin/waiting-room emit …`, a one-shot client that:

1. reads `session_id` from the hook's stdin JSON payload,
2. reads `$TMUX` / `$TMUX_PANE` from the inherited environment to learn which tmux pane Claude lives in,
3. sends the event to the daemon over its Unix Domain Socket,
4. **always exits 0** — if the daemon is unreachable it fails open and never blocks Claude.

> The `bin/waiting-room` binary is populated by [`@waiting-room/cli`](../cli) at install time (milestone M5). For now it is absent; build the daemon from source with `make build-daemon` and place it at `daemon/bin/waiting-room`.

## Install

**Quick test (this repo, one session):** run Claude inside tmux with

```
claude --plugin-dir /path/to/claude-waiting-room/packages/plugin-claude
```

**Persistent (zero-install):** copy the plugin folder to `~/.claude/skills/claude-waiting-room/` — it loads in every session.

**Marketplace/npm (forthcoming):** `claude plugin install @waiting-room/plugin-claude`, which brings `@waiting-room/cli` and its platform binary as a dependency.

### Binary resolution

`bin/waiting-room` is a resolver, in order: `$WAITING_ROOM_BIN` → vendored platform binaries (`make plugin-pack` fills `bin/waiting-room-<os>-<arch>`) → a monorepo dev checkout's `daemon/bin/waiting-room` → `waiting-room` on PATH → **exit 0 fail-open** so a missing binary can never break Claude. Release packaging (`make plugin-pack`) makes the plugin fully self-contained.

Start the daemon once (`waiting-room daemon`, or let an SDK activity auto-start it) and run Claude inside a tmux session — that's the whole setup.

## Safety

These hooks **merge** with your own hooks — they never replace them. They print nothing to stdout (stdout from `UserPromptSubmit` would be injected into Claude's context) and never exit non-zero, so they cannot suppress or loop Claude.
