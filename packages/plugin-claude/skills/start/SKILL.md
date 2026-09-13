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

## Reading the result

The **last line of `wr-launch`'s stdout is a JSON result**. Human-readable hints go to stderr; the JSON is the source of truth. Report it honestly:

- `ok:true` with `game`, `pane`, `session`, `window` — the game is running. Tell the user where to look, e.g. "snake is in pane %5 of session wr, window 0".
- `ok:false` with a `reason` — report the reason to the user verbatim (see below). Do NOT say "focus has switched" or "the snake is in a pane to your right" if `ok` is false — the game may have launched somewhere the user isn't looking (the failure mode this protocol exists to prevent).

Reasons and what to tell the user:

- `missing-arg` — no game name was passed.
- `no-tmux` — tmux isn't installed. Suggest `brew install tmux`.
- `not-in-tmux` — Claude isn't running inside tmux. Tell the user to exit and restart via the `wr` launcher (`npm install -g @waiting-room/cli` provides it), which starts Claude inside tmux; the hint in the script's stderr says the same.
- `no-clients` — the tmux session has zero attached clients; a new pane would be invisible. Tell the user to `tmux a -t <session>` from a terminal first.
- `unknown-pane` — a tmux server is an ancestor process but our own pane id is unknown (e.g. `$TMUX_PANE` wasn't propagated). The user should attach to the session first.
- `game-not-installed` — a sibling pane was opened showing the `npm install` hint. Tell the user the install command.
- `split-failed` / `launch-pending` — the split or the post-launch attach check failed; say so plainly, don't guess.

## Notes

- The plugin's daemon is launched automatically by the SessionStart hook. Do NOT start it yourself.
- The SessionStart hook also reports (via wr-detect) whether Claude is inside tmux. If it reported `not-in-tmux` and the user wants a side activity, suggest restarting via `wr` — a hook cannot move a running Claude into tmux.
- The skill should be **lazy** about user input: when given a game name, launch immediately. When given no name, ask which to start.
- If the user says something like "btw, start a side game" in regular chat, recognize the intent and route here by suggesting they type `/waiting-room:start <game>`.
- All hooks are async + fail-open; this skill is synchronous and runs only when the user explicitly invokes it.