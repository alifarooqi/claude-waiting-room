#!/usr/bin/env node
/** @waiting-room/exercise-math — quick math MCQs as a Waiting Room activity. */
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { createActivity } from '@waiting-room/sdk';

const activity = await createActivity({ session: 'auto', title: 'Math' });
const instance = render(React.createElement(App, { activity }));
await instance.waitUntilExit();
await activity.dispose();
process.exit(0);
