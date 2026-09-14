---
name: start
description: Launch a Waiting Room side activity (Snake, math quiz, …) as a web page in the user's browser. The game auto-pauses when Claude needs input and resumes when Claude gets back to work. Use when the user asks to start a game, play while they wait, or open a side activity alongside Claude.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/wr-open snake), Bash(${CLAUDE_PLUGIN_ROOT}/bin/wr-open math), Bash(${CLAUDE_PLUGIN_ROOT}/bin/waiting-room list-games)
---

# Waiting Room — start a side activity

When the user runs `/waiting-room:start <game>`, open the game as a web
page in their browser.

## What to do

1. **Find the session id.** The SessionStart hook put a line like
   `waiting-room session_id: <id>` into your context. Use that id — it
   binds the game to THIS Claude session so pause/resume fires at the
   right moments. If you cannot find it, run `wr-open` without one and
   say that the game bound to the most recently active session instead.

2. **If the user passed a game name** (`/waiting-room:start snake`):
   - Run `Bash("${CLAUDE_PLUGIN_ROOT}/bin/wr-open" snake <session_id>)`.
   - The script launches the game's bridge process detached, waits for
     it to be ready, and prints a JSON line. Read `ok`, `url`, `opened`.

3. **If the user just typed `/waiting-room:start` with no game name**:
   - Run `Bash("${CLAUDE_PLUGIN_ROOT}/bin/waiting-room" list-games)` to
     enumerate installed games (PATH scan for `waiting-room-*` binaries).
   - If empty: tell the user no games are installed; suggest
     `npm install -g @waiting-room/game-snake` or
     `@waiting-room/exercise-math`.
   - If non-empty: present the list, ask which one to start, then run
     `wr-open <name> <session_id>`.

## How to narrate the result (be honest about what happens)

- On `ok: true` with `opened: true`: the browser window opened by itself
  on the game. Tell the user the page is up. The URL is local and
  ephemeral — it dies with the game session, so there is nothing to
  bookmark.
- On `ok: true` with `opened: false` (e.g. over SSH): give the user the
  URL to open by hand, e.g.
  `Open http://127.0.0.1:<port>/t/<token>/ in your browser`.
- On `reason: "game-not-installed"`: relay the stderr install hint
  (`npm install -g <package>`) and offer to wait until they've installed
  it.
- On `reason: "launch-pending"`: the game is still starting; its window
  will appear when ready. Mention the log path from stderr.

Tell the user what "pause" means here, truthfully:

- When Claude stops and needs input, the game pauses with a banner, the
  tab title flashes, a notification + beep fire (after their first click
  in the page unlocks them), and Claude's terminal window is brought to
  the front (macOS, best effort).
- A web page cannot steal keyboard focus from the game by itself — the
  notification and terminal bring-forward are the attention mechanism.
- When Claude resumes, the banner clears and the game continues.

## Notes

- The daemon is launched automatically by the SessionStart hook. Do NOT
  start it yourself.
- Closing the game tab shuts the game down (after ~30 s). The user can
  also quit from inside the page.
- No tmux, panes, or TTY juggling is involved — never suggest restarting
  Claude inside tmux.
- Be **lazy** about user input: given a game name, launch immediately;
  given none, ask which to start.
- If the user says something like "btw, start a side game" in regular
  chat, recognize the intent and route here (or just run `wr-open`).
