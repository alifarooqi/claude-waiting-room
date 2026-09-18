/**
 * Snake web UI — the same state machine as the old Ink TUI (agent pause /
 * manualPaused / offline), rendered with React DOM + canvas. Presentational:
 * main.web.tsx owns the browser client and passes connection state in,
 * which is also what tests drive.
 *
 * Pausing follows the shared policy: Claude needing attention pauses the
 * game, but only the player resumes it — "resume now" or "resume & remind
 * me in N minutes" (a snooze that re-pauses if Claude still waits).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPausePolicy,
  primeUserGesture,
  startAttention,
  stopAttention,
  type BrowserClient,
  type PausePolicy,
  type PauseSnapshot,
} from '@waiting-room/web-bridge/browser';
import type { AgentState } from '@waiting-room/sdk';
import {
  createInitialState,
  DOWN,
  HEIGHT,
  LEFT,
  RIGHT,
  step,
  turn,
  UP,
  WIDTH,
  type GameState,
  type Point,
} from '../game.js';

const TICK_MS = 120;
const CELL = 24; // logical px per board cell
const PAD = 12; // canvas padding around the board
const REMIND_CHOICES = [5, 10, 15, 30]; // minutes, on the pause banner

export interface AppProps {
  /** Browser client (quit/focus actions). */
  readonly client: BrowserClient;
  /** Live agent state from the bridge ('connecting' until first snapshot). */
  readonly agentState: AgentState | 'connecting';
  /** Whether the bridge currently sees the daemon. */
  readonly daemonOnline: boolean;
  /** The bridge exited (tab asked it to, or it crashed). */
  readonly serverLost: boolean;
  /** Starting state (tests/replays); defaults to a fresh game. */
  readonly initialGame?: GameState;
}

export function App({ client, agentState, daemonOnline, serverLost, initialGame }: AppProps): JSX.Element {
  const [game, setGame] = useState<GameState>(() => initialGame ?? createInitialState());
  const [manualPaused, setManualPaused] = useState(false);
  const [best, setBest] = useState(0);

  // --- pause policy (shared with every Waiting Room game) ------------------
  const policyRef = useRef<PausePolicy | null>(null);
  if (policyRef.current === null) policyRef.current = createPausePolicy();
  const policy = policyRef.current;
  const [snap, setSnap] = useState<PauseSnapshot>(policy.snapshot);

  useEffect(() => {
    const off = policy.onChange(setSnap);
    return () => {
      off();
      policy.dispose();
    };
  }, [policy]);

  // Feed agent-state observations in ('connecting' carries no news).
  useEffect(() => {
    if (agentState !== 'connecting') policy.onState(agentState);
  }, [agentState, policy]);

  const resume = useCallback((): void => policy.onResume(), [policy]);
  const remind = useCallback((ms: number): void => policy.onRemind(ms), [policy]);

  // Countdown ticker while a reminder is armed.
  const reminding = snap.reminderAt !== null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!reminding) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [reminding]);

  const offline = !daemonOnline;
  const paused = snap.paused || manualPaused;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Attention effects track the policy (on while Claude actively waits).
  useEffect(() => {
    if (snap.attention) startAttention();
    else stopAttention();
    return () => stopAttention();
  }, [snap.attention]);

  // Unlock notification permission + audio on the first user gesture.
  useEffect(() => {
    window.addEventListener('pointerdown', primeUserGesture, { once: true });
    window.addEventListener('keydown', primeUserGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', primeUserGesture);
      window.removeEventListener('keydown', primeUserGesture);
    };
  }, []);

  // Best score (localStorage may be unavailable — degrade silently).
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem('wr-snake-best'));
      if (Number.isFinite(v) && v > 0) setBest(v);
    } catch {
      // no storage
    }
  }, []);
  useEffect(() => {
    setBest((b) => {
      if (game.score <= b) return b;
      try {
        localStorage.setItem('wr-snake-best', String(game.score));
      } catch {
        // keep the in-memory best anyway
      }
      return game.score;
    });
  }, [game.score]);

  // --- game loop -----------------------------------------------------------
  useEffect(() => {
    if (paused || game.gameOver || serverLost) return;
    const id = setInterval(() => setGame((g) => step(g)), TICK_MS);
    return () => clearInterval(id);
  }, [paused, game.gameOver, serverLost]);

  // --- canvas --------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / headless: DOM state still renders
    drawBoard(ctx, game, getDpr());
  }, [game]);

  // --- input ---------------------------------------------------------------
  const steer = useCallback((dir: Point) => {
    setGame((g) => turn(g, dir));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (snap.paused && (e.key === 'Enter' || e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        resume();
        return;
      }
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          steer(UP);
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          steer(DOWN);
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          steer(LEFT);
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          steer(RIGHT);
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          setManualPaused((m) => !m);
          break;
        case 'Enter':
          if (game.gameOver) setGame(createInitialState());
          break;
        case 'q':
        case 'Q':
          e.preventDefault();
          void client.quit();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steer, snap.paused, resume, game.gameOver, client]);

  const restart = (): void => setGame(createInitialState());

  return (
    <main className="wrap">
      <header className="hud">
        <h1 className="title">
          snake <span className="accent">·</span> waiting room
        </h1>
        <div className="scores">
          <span className="score">
            score <strong>{game.score}</strong>
          </span>
          <span className="score dim">
            best <strong>{best}</strong>
          </span>
          {snap.reminderAt !== null && (
            <span className="score remind" title="This game re-pauses if Claude still needs you then">
              reminder in <strong>{fmtRemaining(snap.reminderAt)}</strong>
            </span>
          )}
        </div>
      </header>

      <div className="board-holder">
        <canvas
          ref={canvasRef}
          className="board"
          width={PAD * 2 + WIDTH * CELL}
          height={PAD * 2 + HEIGHT * CELL}
        />
        {game.gameOver && (
          <div className="overlay">
            <p className="overlay-title over">game over — score {game.score}</p>
            <button className="btn primary" onClick={restart}>
              play again <span className="key">↵</span>
            </button>
          </div>
        )}
        {manualPaused && !snap.paused && !game.gameOver && (
          <div className="overlay">
            <p className="overlay-title">paused</p>
            <button className="btn" onClick={() => setManualPaused(false)}>
              resume <span className="key">P</span>
            </button>
          </div>
        )}
        {snap.banner === 'waiting' && !serverLost && (
          <div className="banner paused-banner" role="status">
            <p className="banner-title">⏸ paused — Claude needs you</p>
            <p className="banner-note">
              Claude is waiting for your input in its terminal. The game stays paused
              until you resume.
            </p>
            <div className="banner-actions">
              <button className="btn primary" onClick={resume} autoFocus>
                resume now <span className="key">↵</span>
              </button>
              <button className="btn" onClick={() => void client.focusClaude()}>
                back to Claude
              </button>
            </div>
            <div className="remind-row">
              <span className="remind-label">resume &amp; remind me in</span>
              {REMIND_CHOICES.map((min) => (
                <button
                  key={min}
                  className="chip"
                  onClick={() => remind(min * 60_000)}
                  title={`Keep playing — re-pause after ${min} minutes if Claude still needs you`}
                >
                  {min}m
                </button>
              ))}
            </div>
          </div>
        )}
        {snap.banner === 'working-again' && !serverLost && (
          <div className="banner resumed-banner" role="status">
            <p className="banner-title">▶ paused — Claude is working again</p>
            <p className="banner-note">
              Claude got back to it. The game stays paused — resume whenever you like.
            </p>
            <div className="banner-actions">
              <button className="btn primary" onClick={resume} autoFocus>
                resume now <span className="key">↵</span>
              </button>
            </div>
          </div>
        )}
        {serverLost && (
          <div className="banner lost-banner" role="status">
            <p className="banner-title">bridge closed</p>
            <p className="banner-note">
              This game session has ended — ask Claude to start it again when you want
              another round.
            </p>
          </div>
        )}
      </div>

      {offline && !serverLost && (
        <p className="note offline-note">! daemon offline — auto-pause unavailable</p>
      )}

      <footer className="controls">
        <div className="dpad" aria-label="direction controls">
          <button className="dpad-btn up" onPointerDown={() => steer(UP)} aria-label="up">
            ↑
          </button>
          <button className="dpad-btn left" onPointerDown={() => steer(LEFT)} aria-label="left">
            ←
          </button>
          <button className="dpad-btn down" onPointerDown={() => steer(DOWN)} aria-label="down">
            ↓
          </button>
          <button className="dpad-btn right" onPointerDown={() => steer(RIGHT)} aria-label="right">
            →
          </button>
        </div>
        <div className="meta-btns">
          <button className="btn" onClick={() => setManualPaused((m) => !m)}>
            {manualPaused ? 'resume' : 'pause'} <span className="key">P</span>
          </button>
          <button className="btn danger" onClick={() => void client.quit()}>
            quit <span className="key">Q</span>
          </button>
        </div>
      </footer>

      <p className="hint">arrows / WASD steer · P pause · Q quit · food makes you grow</p>
    </main>
  );
}

/** "4:32" — seconds rounded up so the countdown starts at the full minute. */
function fmtRemaining(at: number): string {
  const s = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Draw one frame of the board. */
function drawBoard(ctx: CanvasRenderingContext2D, game: GameState, dpr: number): void {
  const w = PAD * 2 + WIDTH * CELL;
  const h = PAD * 2 + HEIGHT * CELL;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // checker background
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#0d1522' : '#0b111c';
      ctx.fillRect(PAD + x * CELL, PAD + y * CELL, CELL, CELL);
    }
  }

  // food — glowing apple
  const fx = PAD + game.food.x * CELL + CELL / 2;
  const fy = PAD + game.food.y * CELL + CELL / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(248, 113, 113, 0.8)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#f87171';
  ctx.beginPath();
  ctx.arc(fx, fy, CELL * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // snake — rounded segments, subtle tail fade
  const r = CELL * 0.3;
  game.snake.forEach((seg, i) => {
    const x = PAD + seg.x * CELL + 2;
    const y = PAD + seg.y * CELL + 2;
    const size = CELL - 4;
    ctx.fillStyle = i === 0 ? '#6ee7b7' : '#34d399';
    roundRect(ctx, x, y, size, size, r);
    ctx.fill();
    if (i > 0) {
      const t = i / Math.max(game.snake.length, 8);
      ctx.fillStyle = `rgba(13, 21, 34, ${0.28 * t})`;
      roundRect(ctx, x, y, size, size, r);
      ctx.fill();
    }
  });

  // eyes on the head, facing the travel direction
  const head = game.snake[0];
  if (head) {
    const hx = PAD + head.x * CELL + CELL / 2;
    const hy = PAD + head.y * CELL + CELL / 2;
    const d = game.dir;
    const perp: Point = { x: -d.y, y: d.x };
    for (const side of [-1, 1]) {
      const ex = hx + d.x * CELL * 0.16 + perp.x * side * CELL * 0.18;
      const ey = hy + d.y * CELL * 0.16 + perp.y * side * CELL * 0.18;
      ctx.fillStyle = '#052e22';
      ctx.beginPath();
      ctx.arc(ex, ey, CELL * 0.075, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function getDpr(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return dpr && Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}
