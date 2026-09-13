# @waiting-room/cli

Binary distribution wrapper for the Waiting Room daemon, plus the `wr`
launcher.

## `wr` — start Claude inside tmux

```sh
npm install -g @waiting-room/cli
wr              # or: wr --continue, wr --model opus, …
```

`wr` execs `tmux new-session -A -s claude-waiting-room claude …`, so the
terminal is handed to tmux **before** Claude starts. Side activities
(Snake, math quiz, …) can then split sibling panes around Claude via the
Waiting Room plugin. All arguments are passed through to `claude`,
safely quoted.

Behavior:

- Already inside tmux → runs `claude` in place (no nesting).
- tmux not installed → runs `claude` anyway, with a one-line note.
- A `claude-waiting-room` session already exists (e.g. your terminal
  crashed) → attaches to it instead of creating a duplicate.

Options:

- `WR_TMUX_SESSION` — override the tmux session name
  (default `claude-waiting-room`).

For fully automatic nesting, alias it:

```sh
# ~/.zshrc
alias claude='wr'
```

Known wart: when claude exits, the exit code `wr` returns to the shell
is tmux's own, not claude's.

A Claude Code plugin hook cannot do this instead of you: hooks are child
processes with captured pipes — they can't take over the terminal
Claude's TUI is already rendering on, and a running process can't be
moved into a tmux pane after the fact.

## `waiting-room` — the daemon

`bin/cli.js` resolves the platform binary (installed via
`optionalDependencies` by `make cli-pack`) and execs it. See the repo
root README for daemon usage.
