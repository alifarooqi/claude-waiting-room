import { describe, it, expect } from 'vitest';
import { evaluate, generateQuestion } from '../src/math.js';

describe('math questions', () => {
  it('evaluates all operators', () => {
    expect(evaluate(3, '+', 4)).toBe(7);
    expect(evaluate(9, '-', 4)).toBe(5);
    expect(evaluate(3, '*', 4)).toBe(12);
  });

  it('generates 4 unique non-negative options including the answer', () => {
    // Deterministic-ish: run many generations with the default RNG.
    for (let i = 0; i < 200; i++) {
      const q = generateQuestion();
      expect(q.options.length).toBe(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.options).toContain(q.answer);
      for (const opt of q.options) expect(opt).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBe(evaluate(q.a, q.op, q.b));
      if (q.op === '-') expect(q.a).toBeGreaterThanOrEqual(q.b); // non-negative subtraction
    }
  });

  it('is deterministic with an injected rng', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const a = generateQuestion(rand);
    seed = 42;
    const b = generateQuestion(rand);
    expect(a).toEqual(b);
  });
});
