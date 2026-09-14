// Browser entry — Snake. Mounts the React root, owns game state via
// React (so pause/manual-pause flags drive re-renders), and runs the
// canvas renderer on the same DOM tree.

import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { createActivity } from '@waiting-room/sdk';
import {
  createInitialState,
  step,
  turn,
  UP,
  DOWN,
  LEFT,
  RIGHT,
  type GameState,
  type Point,
} from './game.js';
import { SnakeRenderer } from './canvas.js';

function App() {
  const [game, setGame] = useState<GameState>(() => createInitialState());
  const [autoPaused, setAutoPaused] = useState(false);
  const [manualPaused, setManualPaused] = useState(false);
  const [offline, setOffline] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<SnakeRenderer | null>(null);
  const gameRef = useRef(game);
  const pausedRef = useRef(autoPaused || manualPaused);

  // Keep refs in sync with React state for the rAF loop.
  useEffect(() => {
    gameRef.current = game;
  }, [game]);
  useEffect(() => {
    pausedRef.current = autoPaused || manualPaused;
  }, [autoPaused, manualPaused]);

  // Wire up activity → pause flags.
  useEffect(() => {
    let cancelled = false;
    let dispose: () => void = () => {};

    void (async () => {
      const activity = await createActivity({ session: 'auto', title: 'Snake' });
      if (cancelled) {
        await activity.dispose();
        return;
      }
      setAutoPaused(activity.state === 'needs_attention');
      activity.onPause(() => setAutoPaused(true));
      activity.onResume(() => setAutoPaused(false));
      activity.onDisconnect(() => setOffline(true));
      // (No onReconnect — the snapshot on reconnect drives state.)
      dispose = () => {
        void activity.dispose();
      };
    })();

    return () => {
      cancelled = true;
      dispose();
    };
  }, []);

  // Set up the canvas renderer.
  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new SnakeRenderer({
      canvas: canvasRef.current,
      getState: () => gameRef.current,
      isPaused: () => pausedRef.current,
      getOverlay: () => {
        const g = gameRef.current;
        if (g.gameOver) return 'Game Over — Enter to restart';
        if (pausedRef.current) return 'Claude needs you';
        return null;
      },
    });
    r.onTick = () => {
      if (!pausedRef.current && !gameRef.current.gameOver) {
        setGame((g) => step(g));
      }
    };
    r.start();
    rendererRef.current = r;
    return () => r.stop();
  }, []);

  // Keyboard input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pausedRef.current) return;
      const g = gameRef.current;
      let next: Point | null = null;
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          next = UP;
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          next = DOWN;
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          next = LEFT;
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          next = RIGHT;
          break;
        case 'p':
        case 'P':
          setManualPaused((p) => !p);
          return;
        case 'Enter':
          if (g.gameOver) {
            setGame(createInitialState());
          }
          return;
        case 'q':
        case 'Q':
          // Quit: bring Claude back to front, then close the window.
          void (async () => {
            const a = await createActivity({ session: 'auto', title: 'Snake' });
            await a.focusClaude();
            await a.dispose();
            window.close();
          })();
          return;
      }
      if (next) {
        e.preventDefault();
        setGame((cur) => turn(cur, next!));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="snake-root">
      <header className="snake-header">
        <span className="snake-title">Snake</span>
        <span className="snake-meta">Arrows/WASD · P pause · Q quit</span>
      </header>
      <main className="snake-canvas-wrap">
        <canvas ref={canvasRef} className="snake-canvas" />
      </main>
      {offline && (
        <div className="snake-offline">
          Disconnected from Waiting Room. Auto-pause is disabled.
        </div>
      )}
      {manualPaused && !autoPaused && (
        <div className="snake-hint">Paused (press P to resume)</div>
      )}
    </div>
  );
}

// Mount.
declare global {
  interface Window {
    __WAITING_ROOM__?: { ws_url?: string; session_id?: string };
  }
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
