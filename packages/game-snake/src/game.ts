/** Pure Snake logic — no React, no I/O: fully unit-testable. */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const WIDTH = 24;
export const HEIGHT = 12;

export const UP: Point = { x: 0, y: -1 };
export const DOWN: Point = { x: 0, y: 1 };
export const LEFT: Point = { x: -1, y: 0 };
export const RIGHT: Point = { x: 1, y: 0 };

export interface GameState {
  /** Snake segments, head first. */
  readonly snake: readonly Point[];
  readonly dir: Point;
  readonly food: Point;
  readonly score: number;
  readonly gameOver: boolean;
}

const key = (p: Point): string => `${p.x},${p.y}`;

function spawnFood(state: GameState): Point {
  const occupied = new Set(state.snake.map(key));
  for (let tries = 0; tries < 500; tries++) {
    const p = {
      x: Math.floor(Math.random() * WIDTH),
      y: Math.floor(Math.random() * HEIGHT),
    };
    if (!occupied.has(key(p))) return p;
  }
  // Board nearly full: linear scan for any free cell.
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const p = { x, y };
      if (!occupied.has(key(p))) return p;
    }
  }
  return { x: 0, y: 0 };
}

export function createInitialState(): GameState {
  const cy = Math.floor(HEIGHT / 2);
  const snake = [
    { x: 8, y: cy },
    { x: 7, y: cy },
    { x: 6, y: cy },
  ];
  const state: GameState = {
    snake,
    dir: RIGHT,
    food: { x: 0, y: 0 },
    score: 0,
    gameOver: false,
  };
  return { ...state, food: spawnFood(state) };
}

/** Steer. Reversing straight into the neck is ignored. */
export function turn(state: GameState, dir: Point): GameState {
  if (state.gameOver) return state;
  const head = state.snake[0]!;
  const neck = state.snake[1];
  if (neck && head.x + dir.x === neck.x && head.y + dir.y === neck.y) {
    return state;
  }
  return { ...state, dir };
}

/** Advance one tick: move, eat or pop the tail, collide or survive. */
export function step(state: GameState): GameState {
  if (state.gameOver) return state;
  const head = state.snake[0]!;
  const next: Point = { x: head.x + state.dir.x, y: head.y + state.dir.y };

  if (next.x < 0 || next.x >= WIDTH || next.y < 0 || next.y >= HEIGHT) {
    return { ...state, gameOver: true };
  }

  const ate = next.x === state.food.x && next.y === state.food.y;
  const body = ate ? state.snake : state.snake.slice(0, -1); // tail moves away unless growing
  if (body.some((p) => p.x === next.x && p.y === next.y)) {
    return { ...state, gameOver: true };
  }

  const snake = [next, ...body];
  const grown: GameState = { ...state, snake, score: state.score + (ate ? 1 : 0) };
  return ate ? { ...grown, food: spawnFood(grown) } : grown;
}
