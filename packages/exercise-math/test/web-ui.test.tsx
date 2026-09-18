// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../src/web/App.web.js';
import type { BrowserClient } from '@waiting-room/web-bridge/browser';
import type { Question } from '../src/math.js';

/** Fake bridge client — records actions, controllable state. */
function fakeClient(): BrowserClient & { _quitCalls: number; _focusCalls: number } {
  return {
    state: 'working',
    daemonOnline: true,
    quit() {
      this._quitCalls += 1;
    },
    focusClaude() {
      this._focusCalls += 1;
      return Promise.resolve();
    },
    destroy() {},
    _quitCalls: 0,
    _focusCalls: 0,
  };
}

/** A known question: 7 × 5, options in a known order. */
function knownQuestion(): Question {
  return {
    a: 7,
    op: '*',
    b: 5,
    answer: 35,
    options: [10, 35, 40, 12],
  };
}

interface Props {
  client?: BrowserClient & { _quitCalls: number; _focusCalls: number };
  agentState?: 'working' | 'needs_attention' | 'connecting' | 'unknown';
  daemonOnline?: boolean;
  serverLost?: boolean;
}

let root: Root | undefined;
let container: HTMLElement | undefined;

function renderui(props: Props = {}): void {
  const { client = fakeClient(), ...rest } = props;
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root!.render(
      <App
        client={client}
        agentState={rest.agentState ?? 'working'}
        daemonOnline={rest.daemonOnline ?? true}
        serverLost={rest.serverLost ?? false}
        initialQuiz={{
          q: knownQuestion(),
          selected: 0,
          score: 0,
          streak: 0,
          answered: 0,
          feedback: '',
        }}
      />,
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.useRealTimers();
});

function optionButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button.option')] as HTMLButtonElement[];
}

describe('math web UI', () => {
  it('renders the question and four options', () => {
    renderui({});
    const q = document.querySelector('.question')?.textContent ?? '';
    expect(q).toContain('7');
    expect(q).toContain('×');
    expect(q).toContain('=');
    expect(q).toContain('?');
    expect(optionButtons()).toHaveLength(4);
    expect(optionButtons()[1]!.textContent).toContain('35');
  });

  it('correct answer scores, wrong answer reveals the right one', () => {
    renderui({});
    act(() => {
      optionButtons()[1]!.click(); // 35 — correct
    });
    expect(document.querySelector('.feedback.correct')?.textContent).toContain('correct');
    expect(document.querySelector('.score strong')?.textContent).toBe('1');

    // Advance past the feedback flash: next question renders.
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(optionButtons()).toHaveLength(4);

    // Wrong answer on the fresh question: reveal style + feedback.
    const wrong = optionButtons().find(
      (b) => b.className.includes('reveal'),
    );
    expect(wrong).toBeUndefined(); // nothing revealed before answering
    act(() => {
      optionButtons()[0]!.click();
    });
    const feedback = document.querySelector('.feedback')?.textContent ?? '';
    expect(['✓ correct!', /✗ it was/].some((m) =>
      typeof m === 'string' ? feedback.includes(m) : m.test(feedback),
    )).toBe(true);
    if (feedback.includes('✗')) {
      expect(optionButtons().some((b) => b.className.includes('reveal'))).toBe(true);
    }
  });

  it('pauses when Claude needs attention; resume is manual, not automatic', () => {
    const client = fakeClient();
    renderui({ client });
    expect(document.querySelector('.paused-banner')).toBeNull();

    renderui({ client, agentState: 'needs_attention' });
    const banner = document.querySelector('.paused-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Claude needs you');
    expect(optionButtons().every((b) => b.disabled)).toBe(true);

    // Claude back at work: the quiz stays paused, but the banner says so.
    renderui({ client, agentState: 'working' });
    expect(document.querySelector('.paused-banner')).toBeNull();
    const calm = document.querySelector('.resumed-banner');
    expect(calm?.textContent).toContain('working again');
    expect(optionButtons().every((b) => b.disabled)).toBe(true); // still paused

    // And back to waiting when Claude stops again.
    renderui({ client, agentState: 'needs_attention' });
    expect(document.querySelector('.paused-banner')).not.toBeNull();
  });

  it('"resume now" unpauses immediately; "back to Claude" focuses the terminal', () => {
    const client = fakeClient();
    renderui({ client, agentState: 'needs_attention' });
    const banner = document.querySelector('.paused-banner')!;
    const byText = (needle: string): HTMLButtonElement =>
      [...banner.querySelectorAll('button')].find((b) =>
        b.textContent?.includes(needle),
      ) as HTMLButtonElement;

    act(() => {
      byText('back to Claude').click();
    });
    expect(client._focusCalls).toBe(1);
    expect(optionButtons().every((b) => b.disabled)).toBe(true); // still paused

    act(() => {
      byText('resume now').click();
    });
    expect(document.querySelector('.paused-banner')).toBeNull();
    expect(document.querySelector('.resumed-banner')).toBeNull();
    expect(optionButtons().every((b) => !b.disabled)).toBe(true);
  });

  it('Enter resumes from the pause banner', () => {
    renderui({ agentState: 'needs_attention' });
    expect(document.querySelector('.paused-banner')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    });
    expect(document.querySelector('.paused-banner')).toBeNull();
    expect(optionButtons().every((b) => !b.disabled)).toBe(true);
  });

  it('"resume & remind" snoozes: countdown runs, then re-pauses if Claude still waits', () => {
    renderui({ agentState: 'needs_attention' });
    const chip = [...document.querySelectorAll('button.chip')].find((b) =>
      b.textContent === '5m',
    )!;
    expect(chip).toBeDefined();

    act(() => {
      chip.click();
    });
    // Playing again, with a visible countdown.
    expect(document.querySelector('.paused-banner')).toBeNull();
    expect(optionButtons().every((b) => !b.disabled)).toBe(true);
    expect(document.querySelector('.score.remind')?.textContent).toContain('5:00');

    // Five minutes later (fake clock): Claude never got answered — re-pause.
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(document.querySelector('.paused-banner')).not.toBeNull();
    expect(document.querySelector('.score.remind')).toBeNull();
    expect(optionButtons().every((b) => b.disabled)).toBe(true);
  });

  it('a working signal cancels an armed reminder', () => {
    renderui({ agentState: 'needs_attention' });
    act(() => {
      ([...document.querySelectorAll('button.chip')].find((b) => b.textContent === '10m')!).click();
    });
    expect(document.querySelector('.score.remind')).not.toBeNull();

    renderui({ agentState: 'working' });
    expect(document.querySelector('.score.remind')).toBeNull(); // cancelled

    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(document.querySelector('.paused-banner')).toBeNull(); // stayed quiet
    expect(optionButtons().every((b) => !b.disabled)).toBe(true);
  });

  it('shows the offline note and bridge-lost farewell', () => {
    renderui({ daemonOnline: false });
    expect(document.querySelector('.offline-note')?.textContent).toContain('daemon offline');
    renderui({ serverLost: true });
    expect(document.querySelector('.lost-banner')?.textContent).toContain('bridge closed');
  });

  it('number keys submit answers; Q quits', () => {
    const client = fakeClient();
    renderui({ client });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', cancelable: true }));
    });
    expect(document.querySelector('.feedback')?.textContent).toContain('correct');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', cancelable: true }));
    });
    expect(client._quitCalls).toBe(1);
  });

  it('quit button asks the bridge to quit', () => {
    const client = fakeClient();
    renderui({ client });
    const quitBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('quit'),
    )!;
    act(() => {
      quitBtn.click();
    });
    expect(client._quitCalls).toBe(1);
  });
});
