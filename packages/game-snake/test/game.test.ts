import { describe, it, expect } from 'vitest';
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
} from '../src/game.js';

describe('snake logic', () => {
  it('starts with a 3-segment snake moving right and reachable food', () => {
    const s = createInitialState();
    expect(s.snake.length).toBe(3);
    expect(s.dir).toEqual(RIGHT);
    expect(s.food.x).toBeGreaterThanOrEqual(0);
    expect(s.food.x).toBeLessThan(WIDTH);
    expect(s.food.y).toBeGreaterThanOrEqual(0);
    expect(s.food.y).toBeLessThan(HEIGHT);
    expect(s.gameOver).toBe(false);
  });

  it('moves the head and pops the tail each step', () => {
    const s = createInitialState();
    const next = step(s);
    expect(next.snake.length).toBe(3);
    expect(next.snake[0]!.x).toBe(s.snake[0]!.x + 1);
    expect(next.score).toBe(0);
  });

  it('grows and scores when eating food', () => {
    const s = createInitialState();
    // Teleport food directly in front of the head.
    const fed = { ...s, food: { x: s.snake[0]!.x + 1, y: s.snake[0]!.y } };
    const next = step(fed);
    expect(next.snake.length).toBe(4);
    expect(next.score).toBe(1);
  });

  it('dies on wall collision', () => {
    let s = createInitialState(); // heading RIGHT from x=8
    for (let i = 0; i < 30 && !s.gameOver; i++) s = step(s); // wall at x=24
    expect(s.gameOver).toBe(true);
    expect(step(s)).toEqual(s); // dead stays dead
  });

  it('dies on self collision (head into own body, not the tail)', () => {
    // Deterministic layout: head moving DOWN into its own second segment.
    // The tail ((4,5)) pops away, but (5,6) stays — collision.
    const s = {
      snake: [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 5, y: 7 },
        { x: 4, y: 7 },
        { x: 4, y: 6 },
        { x: 4, y: 5 },
      ],
      dir: DOWN,
      food: { x: 0, y: 0 },
      score: 0,
      gameOver: false,
    };
    const next = step(s);
    expect(next.gameOver).toBe(true);
  });

  it('lets the snake step onto its vacating tail cell', () => {
    // Tail follows the head: moving into the cell the tail just left is legal.
    const s = {
      snake: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 3, y: 6 },
        { x: 4, y: 6 },
        { x: 5, y: 6 },
      ],
      dir: DOWN,
      food: { x: 0, y: 0 },
      score: 0,
      gameOver: false,
    };
    // Head (5,5) moves DOWN onto (5,6) — the tail cell, which vacates.
    const next = step(s);
    expect(next.gameOver).toBe(false);
  });

  it('ignores reversing straight into the neck', () => {
    const s = createInitialState(); // heading RIGHT
    const t = turn(s, LEFT);
    expect(t.dir).toEqual(RIGHT); // reverse rejected
    const u = turn(s, UP);
    expect(u.dir).toEqual(UP); // perpendicular turn accepted
  });
});
