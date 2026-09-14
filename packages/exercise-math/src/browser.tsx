// Browser entry — Math quiz. Owns a small QuizState machine; no canvas
// (the math UI is text + 2x2 buttons).

import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { createActivity } from '@waiting-room/sdk';
import {
  generateQuestion,
  type Question,
} from './math.js';

type Feedback = '' | 'correct' | 'wrong';
interface QuizState {
  q: Question;
  selected: number | null;
  score: number;
  streak: number;
  answered: number;
  feedback: Feedback;
}

const ADVANCE_MS = 800;

function fresh(): QuizState {
  return {
    q: generateQuestion(),
    selected: null,
    score: 0,
    streak: 0,
    answered: 0,
    feedback: '',
  };
}

function App() {
  const [s, setS] = useState<QuizState>(() => fresh());
  const [paused, setPaused] = useState(false);
  const [offline, setOffline] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wire up activity → pause.
  useEffect(() => {
    let dispose: () => void = () => {};
    void (async () => {
      const activity = await createActivity({ session: 'auto', title: 'Math' });
      setPaused(activity.state === 'needs_attention');
      activity.onPause(() => setPaused(true));
      activity.onResume(() => setPaused(false));
      activity.onDisconnect(() => setOffline(true));
      dispose = () => {
        void activity.dispose();
      };
    })();
    return () => dispose();
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const answer = (option: number, idx: number) => {
    if (paused) return;
    if (s.selected !== null) return;
    const correct = option === s.q.answer;
    setS((cur) => ({
      ...cur,
      selected: idx,
      feedback: correct ? 'correct' : 'wrong',
      score: cur.score + (correct ? 1 : 0),
      streak: correct ? cur.streak + 1 : 0,
      answered: cur.answered + 1,
    }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setS((cur) => ({ ...cur, q: generateQuestion(), selected: null, feedback: '' }));
    }, ADVANCE_MS);
  };

  const onKey = (e: KeyboardEvent) => {
    if (paused) return;
    const key = e.key.toLowerCase();
    const map: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3,
                                            'a': 0, 'b': 1, 'c': 2, 'd': 3 };
    if (key in map) {
      const idx = map[key]!;
      const opt = s.q.options[idx];
      if (typeof opt === 'number') answer(opt, idx);
    } else if (key === 'q') {
      void (async () => {
        const a = await createActivity({ session: 'auto', title: 'Math' });
        await a.focusClaude();
        await a.dispose();
        window.close();
      })();
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, paused]);

  return (
    <div className="math-root">
      <header className="math-header">
        <span className="math-title">Math Quiz</span>
        <span className="math-stats">
          Score <strong>{s.score}</strong> · Streak <strong>{s.streak}</strong>
        </span>
      </header>
      <main className="math-main">
        {paused ? (
          <div className="math-paused">Claude needs you</div>
        ) : (
          <>
            <div className="math-question">
              <span>{s.q.a}</span>
              <span className="math-op">{s.q.op}</span>
              <span>{s.q.b}</span>
              <span className="math-eq">=</span>
              <span className="math-qmark">?</span>
            </div>
            <div className="math-options">
              {s.q.options.map((opt, i) => {
                const cls =
                  s.selected === i
                    ? s.feedback === 'correct'
                      ? 'opt opt-correct'
                      : 'opt opt-wrong'
                    : 'opt';
                return (
                  <button
                    key={`${i}-${opt}`}
                    className={cls}
                    onClick={() => answer(opt, i)}
                    disabled={s.selected !== null}
                  >
                    <span className="opt-key">{['A', 'B', 'C', 'D'][i]}</span>
                    <span className="opt-val">{opt}</span>
                  </button>
                );
              })}
            </div>
            <div className="math-hint">Press A B C D or 1 2 3 4 · Q to quit</div>
          </>
        )}
      </main>
      {offline && (
        <div className="math-offline">Disconnected from Waiting Room.</div>
      )}
    </div>
  );
}

declare global {
  interface Window {
    __WAITING_ROOM__?: { ws_url?: string; session_id?: string };
  }
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
