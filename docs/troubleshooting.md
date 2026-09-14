# Troubleshooting

Common Waiting Room v2 issues and fixes.

## Focus didn't switch to Claude

When Claude needs your attention, the daemon runs `osascript` to bring
your terminal to the foreground. On macOS this requires **Accessibility
permission**, granted once per app.

1. Open **System Settings** → **Privacy & Security** → **Accessibility**.
2. Click the **+** button.
3. Add your terminal emulator: **Terminal**, **iTerm2**, **Ghostty**,
   **WezTerm**, or whichever you use.
4. Restart Claude (so the daemon re-spawns with the new permission).

If focus still doesn't switch after granting permission, check
`~/.wr-cache/daemon.log` (or wherever your plugin cache lives — see
`bin/waiting-room` for the path) for `focus: osascript failed` lines.

## The browser game didn't open

`bin/wr-open` prints a JSON result. The `reason` field tells you why:

| Reason | Cause | Fix |
| --- | --- | --- |
| `no-daemon` | Waiting Room daemon isn't running | Restart Claude (SessionStart auto-spawns the daemon) |
| `no-web-url` | Daemon is up but no HTTP listener | Check `bin/.wr-cache/daemon.log` for binding errors |
| `game-not-installed` | Named game isn't in `~/.waiting-room/web/` | `npm install -g @waiting-room/game-<name>` |
| `open-failed` | macOS `open` command returned non-zero | Try `open` manually to see the error |
| `write-failed` | tmpfile creation failed | Check `TMPDIR` permissions |

## Daemon won't start

- **Port already in use:** `WAITING_ROOM_WEB_LISTEN=127.0.0.1:0` picks
  a random free port — this shouldn't happen. Check the daemon log
  for the actual error.
- **Stale socket:** if a previous daemon crashed, delete
  `~/.waiting-room/run/waiting-room/daemon.sock`.
- **Install failed:** delete `bin/.wr-cache/.install.failed` (in the
  plugin folder) and try again.

## Activity doesn't auto-pause

- Check that the daemon is alive: `waiting-room status` lists active
  sessions.
- Check that the game is bound to a session: `waiting-room watch`
  streams live state changes.
- Browser games show an offline banner if the WS drops — look for
  it. If you see it, the daemon was unreachable. Restart it.

## Game feels jittery

The browser game uses a 60fps `requestAnimationFrame` render loop
with a 120ms tick for Snake. If your machine can't keep up, the canvas
just paints at the speed it can — no game logic is skipped, the
render is.

## Multiple Claude instances

`mode: 'auto'` binds to the most recently active session. If you have
two Claude processes running and the wrong one pauses/resumes your
game, use `mode: 'session'` and pass an explicit `session_id` (or set
`WAITING_ROOM_SESSION=<id>` in the environment).
