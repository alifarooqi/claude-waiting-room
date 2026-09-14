---
name: start
description: Launch a Waiting Room side activity (Snake, math quiz, etc.) in your default browser. The activity auto-pauses when Claude needs your input and resumes when Claude gets back to work. Use when the user asks to start a game, play while they wait, or open a side activity alongside Claude.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/wr-open snake), Bash(${CLAUDE_PLUGIN_ROOT}/bin/wr-open math), Bash(${CLAUDE_PLUGIN_ROOT}/bin/wr-open chess), Bash(${CLAUDE_PLUGIN_ROOT}/bin/waiting-room list-games)
---

# Waiting Room — start a side activity

When the user runs `/waiting-room:start <game>`, open that game in the user's default browser. macOS only for v2.

## What to do

1. **If the user passed a game name** (`/waiting-room:start snake`):
   - Run `Bash("${CLAUDE_PLUGIN_ROOT}/bin/wr-open" snake)`.
   - The script reads `~/.waiting-room/daemon.info`, copies the game bundle's `index.html` to a tmpfile, injects the daemon's `ws_url`, and runs `open <tmpfile>` to launch the user's default browser.
   - The game subscribes to the daemon over WebSocket and starts running.
   - Do NOT exec the game binary directly — browser games run in the user's browser via `wr-open`, not in a TTY.

2. **If the user just typed `/waiting-room:start` with no game name**:
   - Run `Bash("${CLAUDE_PLUGIN_ROOT}/bin/waiting-room" list-games)` to enumerate installed game bundles (scans `~/.waiting-room/web/<name>/index.html`).
   - If empty: tell the user no games are installed; suggest `npm install -g @waiting-room/game-snake` or `@waiting-room/exercise-math`.
   - If non-empty: present the list, ask which one to start, then run `wr-open <name>`.

## Reading the result

The **last line of `wr-open`'s stdout is a JSON result**. Human-readable hints go to stderr; the JSON is the source of truth. Report it honestly:

- `ok:true` with `url`, `game` — the game is opened. Tell the user it's in their browser and to click the tab when they're ready to play (e.g. "snake is open in your browser. Click the tab to start playing; it auto-pauses when Claude needs you.").
- `ok:false` with a `reason` — report the reason to the user verbatim (see below). Do NOT say "the snake is running" or "the game has opened" if `ok` is false — the user will see nothing.

Reasons and what to tell the user:

- `missing-arg` — no game name was passed.
- `no-daemon` — Waiting Room daemon isn't running. Suggest restarting Claude (SessionStart should auto-spawn the daemon); or run `waiting-room daemon` manually to see the error.
- `no-web-url` — the daemon is up but didn't bind an HTTP listener. Re-run with `--no-web` removed (it's on by default).
- `game-not-installed` — the named game bundle isn't in `~/.waiting-room/web/`. Suggest `npm install -g @waiting-room/game-<name>` then re-run.
- `no-session` — neither `$CLAUDE_SESSION_ID` nor `$WR_SESSION` is set; daemon will fall back to "any" mode (follow the most recent Claude session).
- `open-failed` — `open` (the macOS command) returned non-zero. The user may have cancelled or no browser is configured.
- `write-failed` — could not create the tmpfile (rare; usually permissions).

## Notes

- The plugin's daemon is launched automatically by the SessionStart hook. Do NOT start it yourself.
- All hooks are async + fail-open; this skill is synchronous and runs only when the user explicitly invokes it.
- The skill should be **lazy** about user input: when given a game name, launch immediately. When given no name, ask which to start.
- If the user says something like "btw, start a side game" in regular chat, recognize the intent and route here by suggesting they type `/waiting-room:start <game>`.
- Closing the browser tab is enough to unsubscribe the game — no explicit `/waiting-room:stop` skill required. (We ship `wr-close` for power users who want to script it.)
