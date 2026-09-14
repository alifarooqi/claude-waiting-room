# Architecture

Waiting Room observes Claude Code's lifecycle and coordinates side activities and your attention around it. Since M8 ([ADR-0004](adr/0004-web-activities.md)), activities are **web pages** and the tmux-free path is the product.

## Components

- **Daemon** (`daemon/`, Go) — a long-lived process exposing a Unix Domain Socket. It owns:
  - the **session registry** (per Claude `session_id` state machine),
  - the **event bus** (in-memory pub/sub to activity clients),
  - the **tmux controller** — inert unless a session actually reports tmux panes (legacy path; retirement is a planned fast-follow),
  - auth, discovery, and lifecycle.
- **`waiting-room emit`** — a one-shot client mode of the same binary, invoked by Claude Code hooks. Reads `session_id` from the hook's stdin payload, sends one event to the daemon, and **always exits 0** (fails open).
- **SDK** (`@waiting-room/sdk`, TS) — activity authors subscribe and react via `onPause()` / `onResume()` / `onStateChange()` / `onDisconnect()` / `onReconnect()`. Owns `ensureDaemon()` and degraded-mode behavior. `activityPane: null` subscribes without a tmux binding — the mark of a web activity.
- **web-bridge** (`@waiting-room/web-bridge`, TS) — the web-activity server: subscribes pane-less via the SDK, serves the activity's static bundle plus an SSE state stream on an **ephemeral `127.0.0.1` port behind a random URL token**, opens the OS browser, and exits when the tab closes (quit POST / idle / first-connect timeout). Its browser client (`@waiting-room/web-bridge/browser`) gives pages live state, focus/quit POSTs, and the attention effects (title flash, favicon, notification, beep).
- **plugin-claude** — ships `hooks/hooks.json` mapping `UserPromptSubmit` → working, `Stop`/`Notification` → needs attention; `wr-session` (SessionStart) reports the session id into Claude's context; `wr-open` launches a game's bridge detached, bound to that session.
- **Reference activities** — Snake + math quiz: React DOM UIs bundled with esbuild, served by the bridge.

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

- **Getting your attention** when Claude halts is the **bridge's** job: page banner + title flash + favicon + notification + beep (each degrading independently), plus foregrounding Claude's terminal app on macOS (`open -a`, name discovered by `wr-open` from the session's process ancestry; `WAITING_ROOM_NO_FOCUS_RECOVER=1` opts out).
- **Pause/resume** of the activity loop is the **activity's** job (via the SDK / browser client).
- The daemon's tmux focus path still works for sessions that report panes (Claude inside tmux) — both mechanisms coexist; at most one applies in practice.

This keeps each side independently testable.

## Binding an activity to a session (multi-instance)

When several Claude instances run at once, each has a unique `session_id`. The SessionStart hook (`wr-session`) puts the id into Claude's context; the skill passes it to `wr-open`, which exports `WAITING_ROOM_SESSION` for the bridge — an exact, explicit binding. Without an id, the daemon binds a pane-less subscriber to the **most recently active** session (and rebinds unbound subscribers when sessions appear).

## Transport

JSON-lines over a Unix Domain Socket between daemon and SDK/bridge; each message is a self-contained versioned envelope `{ "v": 1, "type": "…", … }`. The bridge↔page contract is plain HTTP: one SSE stream (`state`/`offline`/`online` + 15 s resync pings) and two POSTs (`focus`, `quit`) — a private, re-implementable surface (see ADR-0004's option B for daemon-side consolidation). See [ADR-0002](adr/0002-json-lines-wire-format.md).

## v1 limitations

- **macOS is the only verified platform.** The browser-open code carries an untested fallback chain (Linux/WSL); Windows native needs named-pipe + token auth (reserved v2 in the security doc).
- **A web page cannot steal keyboard focus.** Attention = notification + effects + terminal bring-forward (best effort); nothing can force the OS foreground like tmux's in-terminal focus snap could.
- **Remote/SSH use is degraded-honest:** the URL is printed for manual opening (`--no-open`), port-forward with `ssh -L`.
