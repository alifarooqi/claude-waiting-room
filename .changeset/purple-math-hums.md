---
"@waiting-room/exercise-math": major
---

The math quiz is now a web activity: `waiting-room-math` serves the quiz in your browser (ephemeral local URL, opened automatically) instead of an Ink terminal UI, locking with a banner + notification when Claude needs you and resuming when Claude continues. The tmux/terminal-ui path is removed. Pure question logic is unchanged. New debug flags: `--no-open`, `--port=<n>`.
