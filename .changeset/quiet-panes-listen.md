---
"@waiting-room/plugin-claude": minor
---

Side activities are now web pages — no tmux. SessionStart reports the session id into Claude's context (new `wr-session` hook, replacing the auto-attacher) so games bind to the right session, and the skill launches them with the new `wr-open <game> [session_id]` (detached bridge, ready-line polling, JSON outcome, macOS terminal-app discovery for focus recovery). `wr-attach`/`wr-launch` are removed; `daemon.log` is truncated on each daemon start so it never grows unbounded.
