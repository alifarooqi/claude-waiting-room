import { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Activity } from '@waiting-room/sdk';
import { generateQuestion, type Question } from './math.js';

interface QuizState {
  readonly q: Question;
  readonly selected: number;
  readonly score: number;
  readonly streak: number;
  readonly answered: number;
  readonly feedback: '' | 'correct' | 'wrong';
}

function initialState(): QuizState {
  return { q: generateQuestion(), selected: 0, score: 0, streak: 0, answered: 0, feedback: '' };
}

export function App({ activity }: { activity: Activity }) {
  const { exit } = useApp();
  const [state, setState] = useState<QuizState>(initialState);
  const [paused, setPaused] = useState(activity.state === 'needs_attention');
  const [offline, setOffline] = useState(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    activity.onPause(() => setPaused(true));
    activity.onResume(() => setPaused(false));
    activity.onDisconnect(() => setOffline(true));
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, [activity]);

  const submit = (idx: number) => {
    const correct = state.q.options[idx] === state.q.answer;
    const next: QuizState = {
      ...state,
      score: state.score + (correct ? 1 : 0),
      streak: correct ? state.streak + 1 : 0,
      answered: state.answered + 1,
      feedback: correct ? 'correct' : 'wrong',
    };
    setState(next);
    advanceTimer.current = setTimeout(() => setState(initialState()), 800);
  };

  useInput((input, key) => {
    if (input === 'q' || input === 'Q') {
      void activity.focusAgentTerminal().finally(() => exit());
      return;
    }
    if (paused || state.feedback !== '') return;
    const n = state.q.options.length;
    if (key.upArrow || input === 'k') {
      setState((s) => ({ ...s, selected: (s.selected - 1 + n) % n }));
    } else if (key.downArrow || input === 'j') {
      setState((s) => ({ ...s, selected: (s.selected + 1) % n }));
    } else if (key.return) {
      submit(state.selected);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={34}>
      <Text>
        math — score <Text bold>{state.score}</Text> · streak{' '}
        <Text bold>{state.streak}</Text> · answered {state.answered}
      </Text>
      <Text>
        {state.q.a} {state.q.op === '*' ? '×' : state.q.op === '-' ? '−' : '+'} {state.q.b} = ?
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {state.q.options.map((opt, i) => (
          <Text key={opt} color={i === state.selected ? 'cyan' : undefined} bold={i === state.selected}>
            {i === state.selected ? '❯' : ' '} {opt}
          </Text>
        ))}
      </Box>
      {state.feedback === 'correct' && <Text color="green">✓ correct!</Text>}
      {state.feedback === 'wrong' && <Text color="red">✗ it was {state.q.answer}</Text>}
      {paused && (
        <Text bold color="yellow">
          || PAUSED — Claude needs you
        </Text>
      )}
      {offline && <Text color="red">! daemon offline — auto-pause unavailable</Text>}
      <Text dimColor>up/down choose - enter answer - q quit</Text>
    </Box>
  );
}
