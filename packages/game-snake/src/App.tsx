import { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Activity } from '@waiting-room/sdk';
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
  type GameState,
  type Point,
} from './game.js';

const TICK_MS = 120; // ~8 ticks/sec

/** Render the board as plain rows (single Text per row keeps re-renders cheap). */
function renderBoard(game: GameState): string[] {
  const head = game.snake[0]!;
  const body = new Set(game.snake.slice(1).map((p) => `${p.x},${p.y}`));
  const rows: string[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    let row = '';
    for (let x = 0; x < WIDTH; x++) {
      if (x === head.x && y === head.y) row += '@';
      else if (body.has(`${x},${y}`)) row += 'o';
      else if (x === game.food.x && y === game.food.y) row += '*';
      else row += ' ';
    }
    rows.push(row);
  }
  return rows;
}

export function App({ activity }: { activity: Activity }) {
  const { exit } = useApp();
  const [game, setGame] = useState<GameState>(createInitialState);
  const [autoPaused, setAutoPaused] = useState(activity.state === 'needs_attention');
  const [manualPaused, setManualPaused] = useState(false);
  const [offline, setOffline] = useState(false);
  const paused = autoPaused || manualPaused;

  useEffect(() => {
    activity.onPause(() => setAutoPaused(true));
    activity.onResume(() => setAutoPaused(false));
    activity.onDisconnect(() => setOffline(true));
  }, [activity]);

  useEffect(() => {
    if (paused || game.gameOver) return;
    const id = setInterval(() => setGame((g) => step(g)), TICK_MS);
    return () => clearInterval(id);
  }, [paused, game.gameOver]);

  useInput((input, key) => {
    if (input === 'q' || input === 'Q') {
      // Hand focus back to Claude on the way out.
      void activity.focusAgentTerminal().finally(() => exit());
      return;
    }
    if (input === 'p' || input === 'P') {
      setManualPaused((m) => !m);
      return;
    }
    if (game.gameOver && key.return) {
      setGame(createInitialState());
      return;
    }
    if (paused) return;
    let dir: Point | undefined;
    if (key.upArrow || input === 'w') dir = UP;
    else if (key.downArrow || input === 's') dir = DOWN;
    else if (key.leftArrow || input === 'a') dir = LEFT;
    else if (key.rightArrow || input === 'd') dir = RIGHT;
    if (dir) setGame((g) => turn(g, dir));
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
      <Text>
        snake — score <Text bold>{game.score}</Text>
      </Text>
      {/* The playfield: its own hard boundary — the walls that kill you. */}
      <Box flexDirection="column" borderStyle="single" borderColor="green" marginTop={1}>
        {renderBoard(game).map((row, i) => (
          <Text key={i}>{row}</Text>
        ))}
      </Box>
      {autoPaused && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" marginTop={1}>
          <Text bold color="black" backgroundColor="yellow">
            == PAUSED — CLAUDE NEEDS YOU ==
          </Text>
          <Text color="black" backgroundColor="yellow">
            Claude stopped and is waiting for your input in its pane.
          </Text>
          <Text color="black" backgroundColor="yellow">
            The game resumes automatically when Claude gets back to work.
          </Text>
        </Box>
      )}
      {!autoPaused && manualPaused && (
        <Box marginTop={1}>
          <Text bold color="yellow">
            PAUSED — press p to resume
          </Text>
        </Box>
      )}
      {offline && (
        <Text color="red">
          ! daemon offline — auto-pause unavailable
        </Text>
      )}
      {game.gameOver && (
        <Text bold color="red">
          GAME OVER (score {game.score}) — Enter to restart
        </Text>
      )}
      <Text dimColor>arrows / WASD steer - p pause - q quit</Text>
    </Box>
  );
}
