// Snake canvas renderer — runs at 60fps via requestAnimationFrame,
// ticks the game logic every TICK_MS, and paints via Canvas 2D.

import {
  WIDTH,
  HEIGHT,
  type GameState,
  type Point,
} from './game.js';

const TICK_MS = 120;

export interface SnakeCanvasOpts {
  canvas: HTMLCanvasElement;
  /** Latest game state from the React component (which owns state). */
  getState: () => GameState;
  /** Returns true while paused; renderer stops ticking. */
  isPaused: () => boolean;
  /** Renderer paints this overlay text when set. */
  getOverlay: () => string | null;
}

export class SnakeRenderer {
  private lastTickAt = 0;
  private rafHandle = 0;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly opts: SnakeCanvasOpts) {
    const ctx = opts.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  start(): void {
    this.lastTickAt = performance.now();
    const loop = () => {
      this.tick();
      this.draw();
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.rafHandle);
  }

  private resize(): void {
    const cell = Math.floor(
      Math.min(window.innerWidth / (WIDTH + 4), window.innerHeight / (HEIGHT + 4), 32),
    );
    const cw = cell * WIDTH;
    const ch = cell * HEIGHT;
    const dpr = window.devicePixelRatio || 1;
    this.opts.canvas.width = cw * dpr;
    this.opts.canvas.height = ch * dpr;
    this.opts.canvas.style.width = `${cw}px`;
    this.opts.canvas.style.height = `${ch}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private tick(): void {
    if (this.opts.isPaused()) {
      this.lastTickAt = performance.now();
      return;
    }
    const now = performance.now();
    if (now - this.lastTickAt < TICK_MS) return;
    this.lastTickAt = now;
    // The component is the source of truth for state — but we mutate
    // through a callback installed by the component. Rather than coupling,
    // we expose a tick callback below.
    this.onTick?.();
  }

  /** Component hooks this to advance state. Called from tick(). */
  onTick: (() => void) | null = null;

  private draw(): void {
    const ctx = this.ctx;
    const cw = this.opts.canvas.width / (window.devicePixelRatio || 1);
    const ch = this.opts.canvas.height / (window.devicePixelRatio || 1);
    const cell = Math.min(cw / WIDTH, ch / HEIGHT);

    // Background.
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, cw, ch);

    // Grid.
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WIDTH; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cell + 0.5, 0);
      ctx.lineTo(x * cell + 0.5, ch);
      ctx.stroke();
    }
    for (let y = 0; y <= HEIGHT; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cell + 0.5);
      ctx.lineTo(cw, y * cell + 0.5);
      ctx.stroke();
    }

    const state = this.opts.getState();

    // Snake.
    state.snake.forEach((p: Point, i: number) => {
      ctx.fillStyle = i === 0 ? '#10b981' : '#34d399';
      ctx.fillRect(p.x * cell + 1, p.y * cell + 1, cell - 2, cell - 2);
    });

    // Food.
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(state.food.x * cell + 1, state.food.y * cell + 1, cell - 2, cell - 2);

    // Score (top-right corner).
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `${Math.round(cell * 0.7)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`Score: ${state.score}`, cw - 8, 6);

    // Overlay (pause banner or game-over banner).
    const overlay = this.opts.getOverlay();
    if (overlay) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(cell * 1.4)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(overlay, cw / 2, ch / 2);
    }
  }
}
