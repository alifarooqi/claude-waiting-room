# ADR-0004: Web-based side activities (per-game Node bridge)

- **Status:** Accepted
- **Date:** 2026-09-14

## Context

The original UX chained the product to tmux: Claude had to run inside a
tmux session for games to get sibling panes (`wr-launch` split panes, the
daemon snapped focus between them, games were Ink TUIs needing a TTY).
That chain made setup heavy (launcher wrappers, terminal-only games, no
scrolling/native windows) and the UX poor. We are replacing it with
**web pages in browser windows** and deleting the TUI/tmux path; the
daemon's tmux code becomes inert.

Constraints that shaped the decision:

- The daemon ships on a slow axis (goreleaser `v*` tags, tarballs,
  plugin-resolver `WAITING_ROOM_VERSION`) — changes there cost a release
  cycle. npm packages ship on the fast Changesets axis.
- The wire protocol is transport-agnostic (ADR-0002) and the SDK already
  supports explicit session binding (`$WAITING_ROOM_SESSION`).
- Game logic is pure TS with zero imports; UI is an injected `Activity`.

## Decision

**Architecture A — a per-game Node bridge package
(`@waiting-room/web-bridge`).** Each game's existing
`waiting-room-<game>` npm bin becomes a small Node process that:

1. subscribes to the daemon over the existing UDS SDK with
   `activityPane: null` (a web page is not a tmux pane; inheriting
   Claude's `$TMUX_PANE` from the hook environment would make the daemon
   focus the wrong pane on resume),
2. serves the game's static web bundle plus an SSE state stream on an
   **ephemeral `127.0.0.1:0` port behind a 128-bit random URL token**,
3. opens the OS browser (`open` on macOS),
4. exits when the page asks it to (`POST quit`), when the tab closes
   (idle exit after 30 s), or when no page ever connects (60 s).

The daemon is **unchanged in v1**. Its tmux internals stay but are inert:
pane-less sessions bind to the most-recent session, are never GC-reaped,
and focus ops skip gracefully when a session has no panes.

### Why not B — daemon-served HTTP

The daemon could own the HTTP/SSE surface, register games, and hand out
tokens. That centralizes browser handling and would let activities be
pure static bundles. We deferred it (sketch below) because it requires
new daemon surface (HTTP server, token auth, game registry) on the slow
release axis, plus a security review of a Go HTTP stack — while the
per-game bridge ships entirely on npm, needs zero protocol changes, and
fails independently per game. If consolidation pays off later, the
bridge's private page contract (SSE + two POSTs) is small enough to
re-implement server-side.

**B sketch (fast-follow candidate):** daemon serves `127.0.0.1` HTTP +
SSE with per-session tokens; activities register as static dirs via the
SDK; games become pure static bundles with no Node process; the plugin
asks the daemon for URLs. Requires a tagged daemon release.

### Focus recovery without tmux

A browser page cannot steal OS focus. The replacements:

- **In page** (`@waiting-room/web-bridge/browser`): title flash, red
  favicon, `Notification` (permission requested on first user gesture),
  optional beep — each degrading independently.
- **In bridge**: on the `needs_attention` transition (and on explicit
  focus/quit requests) the bridge foregrounds Claude's terminal app via
  macOS `open -a <app>` when the name is known. `wr-open` discovers it
  by walking the Claude session's process ancestry to the enclosing
  `.app` bundle and exports `$WAITING_ROOM_TERMINAL_APP`.
  `$WAITING_ROOM_NO_FOCUS_RECOVER=1` opts out.
- The daemon's own `focus_request` still works for sessions that do have
  tmux panes — both paths are attempted, harmlessly.

## Consequences

- Games ship as web UIs (React DOM) with their pure logic unchanged;
  TUI/Ink code is deleted (major version bumps).
- Setup friction drops to zero: plain `claude` anywhere, then
  `/waiting-room:start snake` opens a browser window.
- A localhost HTTP surface is added; mitigations and threat model are
  documented in `docs/security-uds.md` (loopback-only, URL token, Host
  check, no-store, single-user trust boundary unchanged).
- OS support in v1 is macOS-only (verified); `open.ts` carries an
  untested fallback chain for other platforms.
- Deferred follow-ups: daemon tmux-code stripping (separate tagged
  release, invisible to users), architecture B, Windows-native (needs
  named pipes + token auth — reserved v2 in the security doc).
