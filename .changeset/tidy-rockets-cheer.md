---
"@waiting-room/plugin-claude": minor
---

wr-launch now reports its outcome as a JSON line (ok/reason/pane/session/window) so the skill narrates results truthfully, detects tmux by pane self-membership instead of server liveness (no more splitting panes in unrelated sessions), and targets the exact new pane via `split-window -P` (previously it could pick a pre-existing pane in sessions with 3+ panes). The SessionStart hook no longer attempts to auto-attach Claude into tmux (impossible from a hook: it has captured pipes and can't take over the terminal, and it spawned a second detached Claude); it now runs wr-detect, which reports in/out of tmux to Claude's context. Start Claude via the new `wr` launcher (@waiting-room/cli) to get the tmux session automatically.
