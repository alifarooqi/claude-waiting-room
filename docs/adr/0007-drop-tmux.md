# ADR 0007: Drop tmux — use browser-based side activities and OS-level focus

Status: Accepted (2026-09)
Supersedes: ADR 0003 (window-topology binding), partial: ADR 0004 (focus controller)

## Context

v1 of Waiting Room focused Claude Code inside tmux and split a sibling pane to
run a TUI game. The UX required `wr` (a launcher that wraps Claude in tmux)
plus the user's terminal emulator (Terminal.app / iTerm2) plus the game
process — three interacting surfaces that frequently broke:

- `wr-launch` reported `{"ok":false,"reason":"not-in-tmux"}` whenever
  Claude wasn't already inside tmux. The SessionStart hook's
  `wr-detect` / `wr-attach` chain was unreliable — it could leave the
  user's terminal orphaned with no tmux status line and no Claude pane.
- `wr-launch`'s `tmux split-window -h` created a new pane in a
  session the user might not have been looking at, and focus-snapping
  (`tmux select-pane`) only worked while the terminal app was the
  foreground window. If the user alt-tabbed to a browser, focus would
  stay in tmux's last-known pane, not in the OS.
- TUI games require a real TTY, which means the `wr-launch` shell
  script had to handle `split-window` + `send-keys` + `select-pane` as
  one atomic operation, with no good way to recover from a partial
  failure.

The user reported this UX was bad and asked for an alternative. Three
locked decisions were captured before the redesign:

- **Direction:** browser-based, cross-platform (via the browser's own
  cross-platform-ness).
- **Focus:** just open the window, the user clicks it to focus.
- **OS:** macOS only for v2.

## Decision

Drop tmux entirely. v2 architecture:

1. **Daemon transport is dual:** keep the existing Unix Domain Socket
   for local CLI clients; add an HTTP + WebSocket listener on
   `127.0.0.1:0` (random free port) for browser activities. The wire
   envelope is identical on both — one text frame per JSON object.
2. **Side activities are browser games:** HTML5 Canvas (Snake) and
   DOM (math quiz). They subscribe to the daemon over WebSocket and
   auto-pause on `needs_attention` like v1. Pure-logic code from v1
   (`packages/game-snake/src/game.ts`,
   `packages/exercise-math/src/math.ts`) is reused without changes.
3. **Focus recovery via osascript** on macOS — AppleScript tells
   System Events to bring Terminal/iTerm to the front. Linux/Windows
   are no-ops for focus in v2 (the games still work everywhere, just
   without the auto-focus-back step).
4. **`bin/wr-open <game>`** replaces `wr-launch`. Reads
   `~/.waiting-room/daemon.info`, copies the game bundle to a
   tmpfile, injects the WS URL via a placeholder, and runs
   `open <tmpfile>`. No new process management, no pane math.
5. **SDK auto-picks transport** via `pickTransport()`: UDS in Node,
   WebSocket in browsers. The `Activity.focusAgentTerminal()` method
   is renamed `focusClaude()` (it now drives OS-level focus, not
   tmux pane selection).

## Consequences

Positive:

- **One npm install, zero configuration.** No tmux install, no `wr`
  wrapper, no manual daemon start. SessionStart auto-spawns the
  daemon.
- **Closing the browser tab is sufficient cleanup.** No zombie tmux
  panes, no orphan processes.
- **Pause/resume works regardless of which window has focus.** The
  browser game just shows "Claude needs you" overlay; the user clicks
  the terminal to switch.
- **Activities work on any OS** (Windows, Linux, etc.) — only the
  OS-focus step is macOS-only.

Negative:

- **macOS-only auto-focus.** Linux/Windows users have to alt-tab
  themselves. This is acceptable because the focus signal is "this is
  when you should look," not "this is when I take control."
- **Browser games need a browser installed.** Most users have one;
  headless servers won't (which were also never a target — they don't
  run Claude Code).
- **Bundle size for games is ~150KB** (mostly React-DOM). Acceptable
  for a one-time load on the local HTTP listener.

## Migration

v1 → v2 is a clean break:

- `bin/wr-launch`, `bin/wr-detect`, `bin/wr-attach` are deleted.
- `bin/wr-open` (new) replaces them with the same single-shot
  semantics: emit JSON result, exit 0.
- `bin/waiting-room` (the daemon shim) drops the `launch` subcommand;
  `list-games` now scans `~/.waiting-room/web/` instead of `$PATH`.
- SDK consumers update `focusAgentTerminal()` → `focusClaude()` (or
  just import the new method name).
- Wire-format changes: `tmux_pane`, `tmux_session`, `tmux_socket`
  fields on `EmitMessage`/`SubscribeMessage`/`SessionStatus` are
  dropped. They were optional before, so existing clients that sent
  them keep working; new clients simply don't include them.

## Future

- **Linux/Windows focus.** xdotool / `powershell` controllers slot
  into the same `focus.Controller` interface. A v3 may add a tiny
  preference UI.
- **Native games.** Anything that can produce a JSON envelope over
  WebSocket counts as a "Waiting Room activity." Native iOS / Android
  apps could subscribe and react to Claude's state.
