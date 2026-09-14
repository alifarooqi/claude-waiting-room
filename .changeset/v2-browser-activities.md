---
"@waiting-room/plugin-claude": minor
"@waiting-room/sdk": minor
"@waiting-room/cli": minor
"@waiting-room/cli-darwin-arm64": minor
"@waiting-room/cli-darwin-amd64": minor
"@waiting-room/cli-linux-arm64": minor
"@waiting-room/cli-linux-amd64": minor
"@waiting-room/game-snake": minor
"@waiting-room/exercise-math": minor
---

v2 — drop tmux entirely; side activities now run as browser games served by the daemon's localhost HTTP+WS listener (macOS only for OS-level focus recovery, via osascript).

- Daemon speaks two transports: UDS (existing) + HTTP+WS on 127.0.0.1:0 (new). Same wire envelope on both.
- `bin/wr-open <game>` opens a game bundle in the user's default browser; `bin/wr-launch`/`wr-detect`/`wr-attach` removed.
- SDK auto-picks UDS (Node) vs WebSocket (browser). `Activity.focusAgentTerminal()` renamed to `focusClaude()`.
- Reference activities ship browser bundles (HTML5 Canvas Snake + DOM math quiz) plus the existing Ink TUIs.
- Flicker suppression: daemon debounces Stop→UserPromptSubmit transitions within 1500ms so the pause overlay doesn't flash.
- macOS only for OS focus recovery. Linux/Windows run games but don't auto-focus the terminal.
