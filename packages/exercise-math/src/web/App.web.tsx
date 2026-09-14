/**
 * Math quiz web UI — same state machine as the old Ink TUI (question →
 * pick → feedback flash → next; paused when Claude needs you).
 * Presentational: main.web.tsx owns the browser client and passes
 * connection state in, which is also what tests drive.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  primeUserGesture,
  startAttention,
  stopAttention,
  type BrowserClient,
} from '@waiting-room/web-bridge/browser';
import type { AgentState } from '@waiting-room/sdk';
import { generateQuestion, type Question } from '../math.js';

const FEEDBACK_MS = 800;

interface QuizState {
  readonly q: Question;
  readonly selected: number;
  readonly score: number;
  readonly streak: number;
  readonly answered: number;
  readonly feedback: '' | 'correct' | 'wrong';
}

function initialState(): QuizState {
  return { q: generateQuestion(), selected: 0, score: 0, streak: 0, answered: 0, feedback: '' };
}

export interface AppProps {
  /** Browser client (quit/focus actions). */
  readonly client: BrowserClient;
  /** Live agent state from the bridge ('connecting' until first snapshot). */
  readonly agentState: AgentState | 'connecting';
  /** Whether the bridge currently sees the daemon. */
  readonly daemonOnline: boolean;
  /** The bridge exited (tab asked it to, or it crashed). */
  readonly serverLost: boolean;
  /** Starting state (tests); defaults to a fresh question. */
  readonly initialQuiz?: QuizState;
}

export function App({
  client,
  agentState,
  daemonOnline,
  serverLost,
  initialQuiz,
}: AppProps): JSX.Element {
  const [state, setState] = useState<QuizState>(() => initialQuiz ?? initialState());
  const [best, setBest] = useState(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const autoPaused = agentState === 'needs_attention';
  const offline = !daemonOnline;
  const locked = autoPaused || serverLost;

  // Attention effects track the auto-pause.
  useEffect(() => {
    if (autoPaused) startAttention();
    else stopAttention();
    return () => stopAttention();
  }, [autoPaused]);

  // Unlock notification permission + audio on the first user gesture.
  useEffect(() => {
    window.addEventListener('pointerdown', primeUserGesture, { once: true });
    window.addEventListener('keydown', primeUserGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', primeUserGesture);
      window.removeEventListener('keydown', primeUserGesture);
    };
  }, []);

  // Never advance to the next question while a timer is pending on unmount.
  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  // Best streak (localStorage may be unavailable — degrade silently).
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem('wr-math-best'));
      if (Number.isFinite(v) && v > 0) setBest(v);
    } catch {
      // no storage
    }
  }, []);
  useEffect(() => {
    setBest((b) => {
      if (state.streak <= b) return b;
      try {
        localStorage.setItem('wr-math-best', String(state.streak));
      } catch {
        // keep the in-memory best anyway
      }
      return state.streak;
    });
  }, [state.streak]);

  const submit = useCallback(
    (idx: number): void => {
      if (state.feedback !== '' || locked) return;
      const correct = state.q.options[idx] === state.q.answer;
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => setState(initialState()), FEEDBACK_MS);
      setState((s) => ({
        ...s,
        score: s.score + (correct ? 1 : 0),
        streak: correct ? s.streak + 1 : 0,
        answered: s.answered + 1,
        feedback: correct ? 'correct' : 'wrong',
      }));
    },
    [state, locked],
  );

  // --- input ---------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = state.q.options.length;
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setState((s) => ({ ...s, selected: (s.selected - 1 + n) % n }));
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setState((s) => ({ ...s, selected: (s.selected + 1) % n }));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit(state.selected);
      } else if (e.key >= '1' && e.key <= String(n)) {
        e.preventDefault();
        submit(Number(e.key) - 1);
      } else if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        void client.quit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.q.options.length, state.selected, submit, client]);

  const op = state.q.op === '*' ? '×' : state.q.op === '-' ? '−' : '+';

  return (
    <main className="wrap">
      <header className="hud">
        <h1 className="title">
          math <span className="accent">·</span> waiting room
        </h1>
        <div className="scores">
          <span className="score">
            score <strong>{state.score}</strong>
          </span>
          <span className="score">
            streak <strong>{state.streak}</strong>
          </span>
          <span className="score dim">
            best <strong>{best}</strong>
          </span>
        </div>
      </header>

      <div className="card-holder">
        <section className="card" aria-live="polite">
          <p className="question">
            {state.q.a} <span className="op">{op}</span> {state.q.b} = ?
          </p>
          <div className="options">
            {state.q.options.map((opt, i) => (
              <button
                key={opt}
                className={
                  'option' + (i === state.selected ? ' selected' : '') + (state.feedback === 'wrong' && opt === state.q.answer ? ' reveal' : '')
                }
                onClick={() => {
                  setState((s) => ({ ...s, selected: i }));
                  submit(i);
                }}
                disabled={state.feedback !== '' || locked}
              >
                <span className="num">{i + 1}</span>
                {opt}
              </button>
            ))}
          </div>
          <p className={'feedback ' + state.feedback} aria-live="polite">
            {state.feedback === 'correct' && '✓ correct!'}
            {state.feedback === 'wrong' && `✗ it was ${state.q.answer}`}
          </p>
          <p className="progress">answered {state.answered}</p>
        </section>

        {autoPaused && !serverLost && (
          <div className="banner paused-banner" role="status">
            <p className="banner-title">⏸ paused — Claude needs you</p>
            <p className="banner-note">
              Claude stopped and is waiting for your input in its terminal. The quiz
              resumes automatically when Claude gets back to work.
            </p>
            <button className="btn primary" onClick={() => void client.focusClaude()}>
              back to Claude
            </button>
          </div>
        )}
        {serverLost && (
          <div className="banner lost-banner" role="status">
            <p className="banner-title">bridge closed</p>
            <p className="banner-note">
              This quiz session has ended — ask Claude to start it again when you want
              another round.
            </p>
          </div>
        )}
      </div>

      {offline && !serverLost && (
        <p className="note offline-note">! daemon offline — auto-pause unavailable</p>
      )}

      <footer className="meta-btns">
        <button className="btn danger" onClick={() => void client.quit()}>
          quit <span className="key">Q</span>
        </button>
      </footer>

      <p className="hint">1–4 or click to answer · ↑↓ choose · ↵ submit · Q quit</p>
    </main>
  );
}
