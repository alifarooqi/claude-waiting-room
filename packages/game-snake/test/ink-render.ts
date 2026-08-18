/**
 * Minimal ink test renderer: ink's real render() against fully-controlled
 * mock streams. (ink-testing-library@3's builtin stdin lacks ref/unref,
 * which ink 5.2's useInput requires — so we own the mocks instead.)
 */
import { EventEmitter } from 'node:events';
import React from 'react';
import { render as inkRender } from 'ink';

export interface TestRender {
  /** Last write that contained visible content (skips bare ANSI escapes). */
  lastFrame(): string;
  unmount(): void;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`, 'g');

export function renderForTest(element: React.ReactElement): TestRender {
  const frames: string[] = [];

  const stdout = new EventEmitter() as unknown as Record<string, unknown> & {
    write(s: string): void;
  };
  stdout.columns = 100;
  stdout.rows = 40;
  stdout.isTTY = true;
  stdout.write = (s: string) => {
    frames.push(s);
  };
  stdout.clearLine = () => {};
  stdout.cursorTo = () => {};
  stdout.moveCursor = () => {};

  const stdin = new EventEmitter() as unknown as Record<string, unknown> & {
    write(d: string | Buffer): void;
  };
  stdin.isTTY = true;
  stdin.setEncoding = () => {};
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  stdin.write = (d: string | Buffer) => stdin.emit('data', d);

  const instance = inkRender(element, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  return {
    lastFrame: () => {
      for (let i = frames.length - 1; i >= 0; i--) {
        const visible = frames[i]!.replace(ANSI, '').trim();
        if (visible !== '') return frames[i]!;
      }
      return '';
    },
    unmount: () => {
      instance.unmount();
      instance.cleanup();
    },
  };
}
