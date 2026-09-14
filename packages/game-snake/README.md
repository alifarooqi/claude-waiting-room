# @waiting-room/game-snake

Snake as a Waiting Room **web activity** — plays in your browser window,
pauses when Claude Code needs you, resumes when Claude gets back to work.

```sh
npm install -g @waiting-room/game-snake
waiting-room-snake            # opens your browser
waiting-room-snake --no-open  # prints the URL instead
waiting-room-snake --port 4321
```

With the Waiting Room plugin installed, just ask Claude to *start the
snake game* — it launches this binary bound to your session and hands you
the URL. Or run it standalone: plain Snake, no auto-pause.

Behavior:

- **Claude needs you** → the game pauses with a banner, the tab title
  flashes, the favicon turns red, you get a notification + beep (after
  your first click unlocks them), and Claude's terminal is brought to
  the front when the bridge can identify it.
- **Claude resumes** → the banner clears and the game continues.
- Quit with the in-page button or `Q`; closing the tab shuts the bridge
  down after ~30 s. Best score is kept in `localStorage`.

Controls: arrows / WASD steer · `P` pause · `Q` quit · on-screen d-pad on
touch devices.

Built with `@waiting-room/web-bridge` — see the repo root for
architecture.
