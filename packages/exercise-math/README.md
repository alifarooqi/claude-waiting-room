# @waiting-room/exercise-math

A multiple-choice math quiz as a Waiting Room **web activity** — plays in
your browser window, pauses when Claude Code needs you — and stays
paused until you resume it (plus an optional "remind me in N minutes"
snooze).

```sh
npm install -g @waiting-room/exercise-math
waiting-room-math            # opens your browser
waiting-room-math --no-open  # prints the URL instead
waiting-room-math --port 4322
```

With the Waiting Room plugin installed, just ask Claude to *start the
math quiz* — it launches this binary bound to your session and hands you
the URL. Or run it standalone: plain arithmetic practice, no auto-pause.

Behavior:

- **Claude needs you** → the quiz locks with a banner, the tab title
  flashes, the favicon turns red, you get a notification + beep (after
  your first click unlocks them), and Claude's terminal is brought to
  the front when the bridge can identify it.
- **Claude resumes** → the banner switches to "Claude is working again";
  the quiz stays paused until you hit **resume now** (`↵`), or
  **resume & remind me in 5/10/15/30 min** to keep playing and get
  re-paused if Claude still waits when the timer fires.
- Wrong answers reveal the right one; best streak is kept in
  `localStorage`. Quit with the in-page button or `Q`; closing the tab
  shuts the bridge down after ~30 s.

Controls: `1–4` or click to answer · `↑↓` choose · `↵` submit · `Q` quit.

Built with `@waiting-room/web-bridge` — see the repo root for
architecture.
