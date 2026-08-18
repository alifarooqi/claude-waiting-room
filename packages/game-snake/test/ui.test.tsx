import { describe, it, expect } from 'vitest';
import React from 'react';
import { App } from '../src/App.js';
import { fakeActivity } from './fake-activity.js';
import { renderForTest } from './ink-render.js';

describe('snake UI', () => {
  it('renders the board and score', async () => {
    const act = fakeActivity();
    const { lastFrame, unmount } = renderForTest(<App activity={act} />);
    await whenReady(act, lastFrame);
    expect(lastFrame()).toContain('snake');
    unmount();
  }, 5000);

  it('shows the pause overlay when Claude needs attention', async () => {
    const act = fakeActivity();
    const { lastFrame, unmount } = renderForTest(<App activity={act} />);
    await whenReady(act, lastFrame);

    act._pause();
    await waitFor(() => expect(lastFrame()).toContain('PAUSED'));

    act._resume();
    await waitFor(() => expect(lastFrame()).not.toContain('PAUSED'));
    unmount();
  }, 5000);

  it('shows the offline banner when the daemon disconnects', async () => {
    const act = fakeActivity();
    const { lastFrame, unmount } = renderForTest(<App activity={act} />);
    await whenReady(act, lastFrame);
    act._disconnect();
    await waitFor(() => expect(lastFrame()).toContain('daemon offline'));
    unmount();
  }, 5000);
});

/** Wait for the first frame AND callback registration (effects flushed). */
async function whenReady(act: { _ready: boolean }, lastFrame: () => string): Promise<void> {
  await waitFor(() => {
    expect(lastFrame()).toContain('score');
    expect(act._ready).toBe(true);
  });
}

async function waitFor(pred: () => void, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      pred();
      return;
    } catch {
      if (Date.now() > deadline) throw new Error('condition not met before timeout');
    }
    await new Promise((r) => setTimeout(r, 40));
  }
}
