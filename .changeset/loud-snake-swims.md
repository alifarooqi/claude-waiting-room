---
"@waiting-room/game-snake": major
---

Snake is now a web activity: `waiting-room-snake` serves the game in your browser (ephemeral local URL, opened automatically) instead of an Ink terminal UI, pausing with a banner + notification when Claude needs you and resuming when Claude continues. The tmux/terminal-ui path is removed — plain `claude`, no launcher, no panes. Pure game logic is unchanged. New debug flags: `--no-open`, `--port=<n>`.
