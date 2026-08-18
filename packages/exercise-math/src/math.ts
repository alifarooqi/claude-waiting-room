/** Pure math-question generation — no React, no I/O: fully unit-testable. */

export type Op = '+' | '-' | '*';

export interface Question {
  readonly a: number;
  readonly op: Op;
  readonly b: number;
  readonly answer: number;
  /** Four options in display order; exactly one is the answer. */
  readonly options: readonly number[];
}

export function evaluate(a: number, op: Op, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    default:
      return a * b;
  }
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Generate a question with 4 unique non-negative options. `rand` is
 *  injectable for deterministic tests. */
export function generateQuestion(rand: () => number = Math.random): Question {
  const ops: readonly Op[] = ['+', '-', '*'];
  const op = ops[Math.floor(rand() * ops.length)]!;
  let a = 2 + Math.floor(rand() * 18); // 2..19
  let b = 2 + Math.floor(rand() * 12); // 2..13
  if (op === '-' && b > a) [a, b] = [b, a]; // keep subtraction non-negative
  const answer = evaluate(a, op, b);

  const options = new Set<number>([answer]);
  let guard = 0;
  while (options.size < 4 && guard++ < 100) {
    const delta = (1 + Math.floor(rand() * 9)) * (rand() < 0.5 ? -1 : 1);
    const candidate = answer + delta;
    if (candidate >= 0) options.add(candidate);
  }
  return { a, op, b, answer, options: shuffle([...options], rand) };
}
