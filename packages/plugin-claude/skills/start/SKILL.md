---
name: start
description: Launch a Waiting Room side activity (Snake, math quiz, etc.) in a sibling tmux pane. The activity auto-pauses when Claude needs your input and resumes when Claude gets back to work. Use when the user asks to start a game, play while they wait, or open a side activity alongside Claude.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/wr-launch snake), Bash(${CLAUDE_PLUGIN_ROOT}/bin/wr-launch math), Bash(${CLAUDE_PLUGIN_ROOT}/bin/wr-launch chess), Bash(${CLAUDE_PLUGIN_ROOT}/bin/waiting-room list-games)
---

# Waiting Room — start a side activity

When the user runs `/waiting-room:start <game>`, open a sibling tmux pane and launch the game there.

## What to do

1. **If the user passed a game name** (`/waiting-room:start snake`):
   - Run `Bash("${CLAUDE_PLUGIN_ROOT}/bin/wr-launch" snake)`.
   - The script splits a new tmux pane to the right of Claude's, sends `waiting-room-<name>` into it, and switches focus to the new pane.
   - Do NOT exec the game binary directly — Ink (the TUI library) requires a real TTY, and exec'ing from Claude's process inherits Claude's piped stdin. The wr-launch script handles this correctly.

2. **If the user just typed `/waiting-room:start` with no game name**:
   - Run `Bash("${CLAUDE_PLUGIN_ROOT}/bin/waiting-room" list-games)` to enumerate installed games (PATH scan for `waiting-room-*` binaries).
   - If empty: tell the user no games are installed; suggest `npm install -g @waiting-room/game-snake` or `@waiting-room/exercise-math`.
   - If non-empty: present the list, ask which one to start, then run `wr-launch <name>`.

## Notes

- The plugin's daemon is launched automatically by the SessionStart hook. Do NOT start it yourself.
- The user must be running Claude inside a tmux session for the pane-split to work. If they aren't, the wr-launch script returns `{"ok":false,"reason":"not-in-tmux"}` and the user sees a hint.
- **The script tells the truth — don't lie about it.** The result JSON has `ok:true` only when a client is actually attached to the new pane. If you get `ok:false` with any reason, report that reason to the user verbatim. Specifically, do NOT say "focus has switched" or "the snake is in a pane to your right" if `ok` is false — the game may have launched into a foreign session the user isn't looking at (the bug this skill is designed to avoid).
- If the result has `reason:"no-clients"`, the session has zero attached clients — tell the user to `tmux a -t <session>` from another terminal first.
- If `reason:"unknown-pane"`, tmux is reachable but the script's own pane id is unknown (typically because the SessionStart hook exec'd into a new tmux server and the pty didn't propagate $TMUX_PANE). The user should attach to the session first.
- The skill should be **lazy** about user input: when given a game name, launch immediately. When given no name, ask which to start.
- If the user says something like "btw, start a side game" in regular chat, recognize the intent and route here by suggesting they type `/waiting-room:start <game>`.
- All hooks are async + fail-open; this skill is synchronous and runs only when the user explicitly invokes it.