# Architecture

Waiting Room observes Claude Code's lifecycle and coordinates side activities + tmux focus around it.

## Components

- **Daemon** (`daemon/`, Go) — a long-lived process exposing a Unix Domain Socket. It owns:
  - the **session registry** (per Claude `session_id` state machine),
  - the **event bus** (in-memory pub/sub to activity clients),
  - the **tmux controller** (focus switching),
  - auth, discovery, and lifecycle.
- **`waiting-room emit`** — a one-shot client mode of the same binary, invoked by Claude Code hooks. Reads `session_id` from the hook's stdin payload and `$TMUX`/`$TMUX_PANE` from the inherited environment, sends one event to the daemon, and **always exits 0** (fails open).
- **SDK** (`@waiting-room/sdk`, TS) — activity authors subscribe and react via `onPause()` / `onResume()` / `onStateChange()`. Owns `ensureDaemon()` and degraded-mode behavior.
- **plugin-claude** — ships `hooks/hooks.json` mapping `UserPromptSubmit` → working, `Stop`/`Notification` → needs attention.
- **Reference activities** — Snake + math quiz, consuming the SDK.

## State machine (per session)

```
        UserPromptSubmit              Stop / Notification
UNKNOWN ─────────────────▶ WORKING ─────────────────▶ NEEDS_ATTENTION
   ▲                         ▲                              │
   │                         └──────── UserPromptSubmit ────┘
   └──────── GC (stale >5min + pane gone) ──────────┘
```

States are **absolute declarations**: `Stop` fully defines NEEDS_ATTENTION, `UserPromptSubmit` fully defines WORKING. A missed event is therefore self-healing — the next event restores correct state. No durable queue is required.

## Separation of concerns

- **Focus-switching** (`tmux select-pane`) is the **daemon's** job.
- **Pause/resume** of the activity loop is the **activity's** job (via SDK callbacks).

This keeps each side independently testable.

## Binding an activity to a session (multi-instance)

When several Claude instances run at once, each has a unique `session_id` and its own `$TMUX_PANE`. An activity that subscribes with `mode: 'auto'` is bound to the session whose Claude pane shares its tmux window (window-topology auto-binding). Pause is per-session; focus is global within tmux — focusing whichever Claude needs you is intentional.

## Transport

JSON-lines over a Unix Domain Socket today; each message is a self-contained versioned envelope `{ "v": 1, "type": "…", … }`. A future WebSocket gateway can carry each message as one text frame with no body changes, enabling browser activities later. See [ADR-0002](adr/0002-json-lines-wire-format.md).

## v1 limitations

- **Focus only reaches within tmux.** `tmux select-pane` does not bring the terminal app to the OS foreground if the user alt-tabbed away. OS window-raise (osascript / xdotool) is a config-gated fast-follow.
- **Activities are TUI-only.** Browser activities are a later add.
