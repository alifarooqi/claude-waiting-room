---
"@waiting-room/cli": minor
---

New `wr` command: starts Claude inside an attached tmux session (`tmux new-session -A -s claude-waiting-room`), enabling Waiting Room side-activity panes. Passes all arguments through to `claude` with safe quoting, reattaches to an existing session when present, and falls back to plain `claude` when tmux is missing. `WR_TMUX_SESSION` overrides the session name.
