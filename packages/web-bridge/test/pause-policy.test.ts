import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPausePolicy, type PauseSnapshot } from '../src/pause-policy.js';

afterEach(() => {
  vi.useRealTimers();
});

function snapOf(policy: ReturnType<typeof createPausePolicy>): PauseSnapshot {
  return policy.snapshot;
}

describe('pause policy — pause on needs_attention', () => {
  it('starts free of pauses', () => {
    const p = createPausePolicy();
    expect(snapOf(p)).toEqual({ paused: false, attention: false, banner: 'none', reminderAt: null });
    p.dispose();
  });

  it('pauses with attention and a waiting banner when Claude needs attention', () => {
    const p = createPausePolicy();
    p.onState('needs_attention');
    expect(snapOf(p)).toEqual({ paused: true, attention: true, banner: 'waiting', reminderAt: null });
    p.dispose();
  });

  it('does not flap on repeated needs_attention (permission chains)', () => {
    const p = createPausePolicy();
    const seen: PauseSnapshot[] = [];
    p.onChange((s) => seen.push(s));
    p.onState('needs_attention');
    p.onState('needs_attention');
    expect(seen).toHaveLength(1); // identical snapshot — no rerender fodder
    p.dispose();
  });

  it('pauses even when needs_attention is the very first observation', () => {
    const p = createPausePolicy();
    p.onState('needs_attention');
    expect(snapOf(p).paused).toBe(true);
    p.dispose();
  });
});

describe('pause policy — working again while paused', () => {
  it('stays paused but switches to the working-again banner and stops attention', () => {
    const p = createPausePolicy();
    p.onState('needs_attention');
    p.onState('working');
    expect(snapOf(p)).toEqual({ paused: true, attention: false, banner: 'working-again', reminderAt: null });
    p.dispose();
  });

  it('re-arms the waiting banner if Claude needs attention again after working', () => {
    const p = createPausePolicy();
    p.onState('needs_attention');
    p.onState('working');
    p.onState('needs_attention');
    expect(snapOf(p)).toEqual({ paused: true, attention: true, banner: 'waiting', reminderAt: null });
    p.dispose();
  });

  it('ignores working while the game is running (no phantom banner)', () => {
    const p = createPausePolicy();
    p.onState('working');
    expect(snapOf(p).banner).toBe('none');
    p.dispose();
  });
});

describe('pause policy — manual resume', () => {
  it('resumes immediately and drops the banner', () => {
    const p = createPausePolicy();
    p.onState('needs_attention');
    p.onResume();
    expect(snapOf(p)).toEqual({ paused: false, attention: false, banner: 'none', reminderAt: null });
    p.dispose();
  });

  it('stays resumed when working arrives afterwards', () => {
    const p = createPausePolicy();
    p.onState('needs_attention');
    p.onResume();
    p.onState('working');
    expect(snapOf(p).paused).toBe(false);
    p.dispose();
  });

  it('pauses again on the next needs_attention after a resume', () => {
    const p = createPausePolicy();
    p.onState('needs_attention');
    p.onResume();
    p.onState('needs_attention');
    expect(snapOf(p)).toEqual({ paused: true, attention: true, banner: 'waiting', reminderAt: null });
    p.dispose();
  });

  it('is idempotent', () => {
    const p = createPausePolicy();
    p.onResume(); // never paused — no-op
    expect(snapOf(p).paused).toBe(false);
    p.dispose();
  });
});

describe('pause policy — resume & remind (snooze)', () => {
  it('resumes and re-pauses with attention when Claude still waits at fire time', () => {
    vi.useFakeTimers();
    const p = createPausePolicy();
    p.onState('needs_attention');
    p.onRemind(5 * 60_000);
    expect(snapOf(p)).toEqual({ paused: false, attention: false, banner: 'none', reminderAt: Date.now() + 5 * 60_000 });

    vi.advanceTimersByTime(5 * 60_000);
    expect(snapOf(p)).toEqual({ paused: true, attention: true, banner: 'waiting', reminderAt: null });
    p.dispose();
  });

  it('stays quiet when Claude is working again by the time the reminder fires', () => {
    vi.useFakeTimers();
    const p = createPausePolicy();
    p.onState('needs_attention');
    p.onRemind(10 * 60_000);
    // Someone answered Claude elsewhere: working arrives mid-snooze.
    p.onState('working');
    expect(snapOf(p).reminderAt).toBeNull(); // cancelled immediately

    vi.advanceTimersByTime(10 * 60_000);
    expect(snapOf(p)).toEqual({ paused: false, attention: false, banner: 'none', reminderAt: null });
    p.dispose();
  });

  it('cancels the reminder when Claude needs attention again mid-snooze', () => {
    vi.useFakeTimers();
    const p = createPausePolicy();
    p.onState('needs_attention');
    p.onRemind(10 * 60_000);
    p.onState('needs_attention'); // the real wait supersedes the scheduled one
    expect(snapOf(p)).toEqual({ paused: true, attention: true, banner: 'waiting', reminderAt: null });

    vi.advanceTimersByTime(10 * 60_000);
    expect(snapOf(p).paused).toBe(true); // no double-fire, no state change
    p.dispose();
  });

  it('a manual resume cancels an armed reminder', () => {
    vi.useFakeTimers();
    const p = createPausePolicy();
    p.onState('needs_attention');
    p.onRemind(5 * 60_000);
    p.onState('needs_attention'); // re-paused (real wait) — banner up again
    p.onResume();
    expect(snapOf(p).reminderAt).toBeNull();
    vi.advanceTimersByTime(5 * 60_000);
    expect(snapOf(p).paused).toBe(false);
    p.dispose();
  });

  it('is a no-op when nothing is paused', () => {
    vi.useFakeTimers();
    const p = createPausePolicy();
    p.onRemind(60_000);
    vi.advanceTimersByTime(60_000);
    expect(snapOf(p).banner).toBe('none');
    p.dispose();
  });

  it('dispose() cancels a pending reminder', () => {
    vi.useFakeTimers();
    const p = createPausePolicy();
    p.onState('needs_attention');
    p.onRemind(5 * 60_000);
    p.dispose();
    vi.advanceTimersByTime(5 * 60_000);
    // The page is gone; nothing may fire. (advanceTimersByTime runs the
    // queue — success is simply not crashing or mutating a disposed policy.)
    expect(p.snapshot.paused).toBe(false);
  });
});

describe('pause policy — change notification', () => {
  it('notifies subscribers on every real change and supports unsubscribe', () => {
    const p = createPausePolicy();
    const seen: string[] = [];
    const off = p.onChange((s) => seen.push(s.banner));
    p.onState('needs_attention');
    p.onState('working'); // still paused — banner switch must still notify
    p.onResume();
    off();
    p.onState('needs_attention');
    expect(seen).toEqual(['waiting', 'working-again', 'none']);
    p.dispose();
  });

  it('multiple subscribers all hear changes', () => {
    const p = createPausePolicy();
    let a = 0;
    let b = 0;
    p.onChange(() => a++);
    p.onChange(() => b++);
    p.onState('needs_attention');
    expect(a).toBe(1);
    expect(b).toBe(1);
    p.dispose();
  });
});
