---
name: start
description: Launch a Waiting Room side activity (Snake, math quiz, etc.) in a tmux pane next to Claude. The activity auto-pauses when Claude needs your input and resumes when Claude gets back to work. Use when the user asks to start a game, play while they wait, or open a side activity alongside Claude.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/waiting-room list-games), Bash(${CLAUDE_PLUGIN_ROOT}/bin/waiting-room launch snake), Bash(${CLAUDE_PLUGIN_ROOT}/bin/waiting-room launch math), Bash(${CLAUDE_PLUGIN_ROOT}/bin/waiting-room launch chess)
---

# Waiting Room — start a side activity

When the user runs `/waiting-room:start <game>`, launch that game as a side activity.

## What to do

1. If the user passed a game name (`/waiting-room:start snake`):
   - Run `Bash("${CLAUDE_PLUGIN_ROOT}/bin/waiting-room" launch snake)`.
   - The plugin's `bin/waiting-room` script execs the matching `waiting-room-<name>` binary from PATH. The user will see the game open in their tmux pane (they must run it inside tmux for focus-switching to work — Claude is in another pane of the same window).
   - If the game isn't installed (the script exits 0 with stderr suggesting `npm install -g @waiting-room/game-<name>`), relay that suggestion to the user.

2. If the user just typed `/waiting-room:start` with no game name:
   - Run `Bash("${CLAUDE_PLUGIN_ROOT}/bin/waiting-room" list-games)` to enumerate installed games.
   - If empty: tell the user no games are installed; suggest `npm install -g @waiting-room/game-snake` or `@waiting-room/exercise-math`.
   - If non-empty: present the list, ask which one to start, then run `launch <name>`.

## Notes

- The plugin's daemon is launched automatically by the SessionStart hook. Do NOT start it yourself.
- The user must be running Claude inside a tmux session for focus switching to work; the game opens in the pane Claude was launched in (the bin/ directory is added to the Bash tool's PATH while the plugin is enabled).
- Do NOT add a `bin/` directory inside this plugin if you intend to distribute it through claude.ai organization marketplaces — see plugin-marketplaces#keep-executables-out-of-the-top-level-bin-directory.
- If the user says something like "btw, start a side game" or "let me play while you think" in regular chat, recognize the intent and route here by suggesting they type `/waiting-room:start <game>`.