# Waiting Room

> Pause side activities and snap focus back to the terminal the moment Claude Code needs you.

**Waiting Room** detects when a Claude Code agentic-coding session is **busy** vs. when it **needs human attention**. While Claude works, you run a side activity (terminal mini-game, math quiz, …) in a sibling tmux pane; the instant Claude halts or needs input, the activity auto-pauses and **tmux focus snaps back to the Claude pane**.

🚧 **Status:** pre-alpha, under active development. See the [roadmap](#roadmap).

---

## How it works

```
Claude Code hooks ──(async)──> waiting-room emit ──UDS──> [ Go daemon ]
                                                              │
                                  ┌───────────────────────────┼───────────────────┐
                                  ▼                           ▼                   ▼
                          session registry            event bus (pub/sub)    tmux controller
                          (keyed by session_id)       (snapshot + stream)    (select-pane/…)
                                                              │
                                                              ▼
                                            activity clients (SDK) ──> pause/resume
```

- **Claude Code hooks** (shipped as a plugin) call a one-shot `waiting-room emit` client.
- The **Go daemon** (Unix Domain Socket) keeps per-session state, broadcasts to activity clients, and drives **tmux focus**.
- The **SDK** lets activity authors subscribe and react with `onPause()` / `onResume()`.
- **Focus-switching is the daemon's job (tmux); pause/resume is the activity's job (SDK).**

Read the full design: [`docs/architecture.md`](docs/architecture.md).

## Packages

| Package | Lang | Description |
| --- | --- | --- |
| [`daemon`](daemon) | Go | The background IPC daemon + `emit`/`focus`/`status` CLI. |
| [`@waiting-room/sdk`](packages/sdk) | TS | Activity developer SDK (`onPause`, `onResume`, `focusAgentTerminal`). |
| [`@waiting-room/plugin-claude`](packages/plugin-claude) | TS | Claude Code plugin (`hooks/hooks.json`). |
| [`@waiting-room/cli`](packages/cli) | TS | Binary distribution wrapper. |
| [`@waiting-room/game-snake`](packages/game-snake) | TS | Reference activity: terminal Snake. |
| [`@waiting-room/exercise-math`](packages/exercise-math) | TS | Reference activity: math quiz. |

## Develop

**Prerequisites:** Go ≥ 1.23, Node ≥ 20, pnpm ≥ 10, tmux. (macOS: `brew install go node pnpm tmux`.)

```bash
make build      # build the Go binary (daemon/bin/waiting-room) + all TS packages
make test       # Go + TS unit tests
make lint       # go vet + TS typecheck
make integration# real-tmux integration tests (requires tmux)
```

## Roadmap

- [x] **M0** — Repo bootstrap
- [x] **M1** — Wire + UDS server
- [x] **M2** — Registry + bus + `emit`
- [x] **M3** — Tmux controller + focus
- [ ] **M4** — SDK (TS)
- [ ] **M5** — plugin-claude + CLI packaging
- [ ] **M6** — Reference activities (Snake, math)
- [ ] **M7** — Hardening + v1 release

## License

[MIT](LICENSE) © The Waiting Room Contributors
