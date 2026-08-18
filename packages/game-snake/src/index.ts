#!/usr/bin/env node
/** @waiting-room/game-snake — terminal Snake as a Waiting Room activity. */
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { createActivity } from '@waiting-room/sdk';

const activity = await createActivity({ session: 'auto', title: 'Snake' });
const instance = render(React.createElement(App, { activity }));
await instance.waitUntilExit();
await activity.dispose();
process.exit(0);
