---
"@waiting-room/web-bridge": minor
"@waiting-room/game-snake": minor
"@waiting-room/exercise-math": minor
"@waiting-room/plugin-claude": minor
---

Resume is now always the player's call. When Claude needs attention the game pauses (attention effects unchanged); when Claude gets back to work the banner switches to "Claude is working again" but the game stays paused until the player hits "resume now" (`↵`) or "resume & remind me in 5/10/15/30 min" — a snooze that re-pauses the game if Claude still needs attention when the timer fires. New shared `createPausePolicy()` in `@waiting-room/web-bridge` drives both games. The plugin now also emits `agent_working` on `PreToolUse`/`PostToolUse`, so approving a permission prompt (which fires no hook of its own) no longer leaves the daemon claiming Claude needs attention while it works.
