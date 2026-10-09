import assert from 'node:assert/strict';
import test from 'node:test';
import type TonalClient from '@dlwiest/ts-tonal-client';
import type { TonalMovement, TonalWorkoutEstimateSet } from '@dlwiest/ts-tonal-client';
import { estimateWorkoutDuration } from '../src/tools/workout-duration.js';

function tonalClient(methods: Record<string, unknown>): TonalClient {
  return methods as unknown as TonalClient;
}

function reportText(response: Awaited<ReturnType<typeof estimateWorkoutDuration>>): string {
  const [content] = response.content;
  assert.equal(content.type, 'text');
  return (content as { type: 'text'; text: string }).text;
}

const BENCH_MOVEMENT = {
  id: 'bench',
  name: 'Bench Press',
  countReps: true,
} as TonalMovement;

test('estimates duration via the client without creating a workout', async () => {
  let receivedSets: TonalWorkoutEstimateSet[] | undefined;
  const client = tonalClient({
    getMovements: async () => [BENCH_MOVEMENT],
    estimateWorkoutDuration: async (sets: TonalWorkoutEstimateSet[]) => {
      receivedSets = sets;
      return { duration: 725 };
    },
  });

  const response = await estimateWorkoutDuration(client, {
    exercises: [{ movementName: 'Bench Press', sets: 3, reps: 10 }],
  });

  const text = reportText(response);
  assert.match(text, /12 minute/);
  assert.match(text, /725s/);
  assert.match(text, /Bench Press/);
  assert.match(text, /no workout was created or modified/);
  assert.ok(receivedSets && receivedSets.length === 3);
});

test('returns a validation error instead of throwing when exercises are missing', async () => {
  const client = tonalClient({
    getMovements: async () => [BENCH_MOVEMENT],
    estimateWorkoutDuration: async () => ({ duration: 0 }),
  });

  const response = await estimateWorkoutDuration(client, {});
  assert.equal(response.isError, true);
  const text = reportText(response);
  assert.match(text, /At least one exercise is required/);
});

test('surfaces an unknown movement as a tool error rather than throwing', async () => {
  const client = tonalClient({
    getMovements: async () => [BENCH_MOVEMENT],
    estimateWorkoutDuration: async () => ({ duration: 0 }),
  });

  const response = await estimateWorkoutDuration(client, {
    exercises: [{ movementName: 'Nonexistent Movement', sets: 2, reps: 10 }],
  });

  assert.equal(response.isError, true);
});

test('surfaces a client-level estimateWorkoutDuration failure as isError, not swallowed', async () => {
  // This is the failure mode the estimateWorkoutDuration client bug actually produced in
  // practice before the patch-package fix (HTTP 400 from /user-workouts/estimate). Even with
  // the client patched, the tool must still handle the client method throwing -- for whatever
  // reason -- by surfacing it as a proper MCP tool error with the real message intact, not
  // swallowing it or miscategorizing it as something else (e.g. a validation error).
  const client = tonalClient({
    getMovements: async () => [BENCH_MOVEMENT],
    estimateWorkoutDuration: async () => {
      throw new Error('HTTP 400: json: cannot unmarshal object into Go value of type content.SetList');
    },
  });

  const response = await estimateWorkoutDuration(client, {
    exercises: [{ movementName: 'Bench Press', sets: 3, reps: 10 }],
  });

  assert.equal(response.isError, true);
  const text = reportText(response);
  assert.match(text, /estimate_workout_duration/);
  assert.match(text, /cannot unmarshal object into Go value of type content\.SetList/);
});

// --- Ported from upstream dlwiest/ts-tonal-mcp: header set count, singular/plural, per-set weight ---

test('header reports the set count and singularizes one set / one minute', async () => {
  const client = tonalClient({
    getMovements: async () => [BENCH_MOVEMENT],
    estimateWorkoutDuration: async () => ({ duration: 60 }),
  });

  const text = reportText(
    await estimateWorkoutDuration(client, {
      exercises: [{ movementName: 'Bench Press', sets: 1, reps: 5 }],
    })
  );

  assert.match(text, /60s across 1 set\b/, 'one set must not read "1 sets"');
  assert.match(text, /\*\*1 minute\*\*/);
  assert.match(text, /\*\*Bench Press\*\* - 1 set\b/, 'per-exercise count is singular too');
  assert.doesNotMatch(text, /1 sets/);
});

test('header counts every set across exercises', async () => {
  const client = tonalClient({
    getMovements: async () => [BENCH_MOVEMENT],
    estimateWorkoutDuration: async () => ({ duration: 725 }),
  });

  const text = reportText(
    await estimateWorkoutDuration(client, {
      exercises: [{ movementName: 'Bench Press', sets: 3, reps: 10 }],
    })
  );

  assert.match(text, /725s across 3 sets/);
});

test('labels an exercise weight as a fallback when only some sets specify their own', async () => {
  // exercisesToSets resolves per-set weight as (setDetail.weight ?? exercise.weight ?? 0), so 70
  // reaches only the set that omits a weight. A bare "@ 70%" would imply all three.
  let received: TonalWorkoutEstimateSet[] | undefined;
  const client = tonalClient({
    getMovements: async () => [BENCH_MOVEMENT],
    estimateWorkoutDuration: async (sets: TonalWorkoutEstimateSet[]) => {
      received = sets;
      return { duration: 300 };
    },
  });

  const text = reportText(
    await estimateWorkoutDuration(client, {
      exercises: [
        {
          movementName: 'Bench Press',
          weight: 70,
          setDetails: [{ reps: 10 }, { reps: 8, weight: 85 }, { reps: 6, weight: 95 }],
        },
      ],
    })
  );

  assert.match(text, /3 sets with per-set programming @ 70% where unspecified/);
  assert.equal(received?.[0].weightPercentage, 70, 'set without its own weight inherits 70');
  assert.equal(received?.[1].weightPercentage, 85);
  assert.equal(received?.[2].weightPercentage, 95);
});

test('omits the exercise weight entirely when every set specifies its own', async () => {
  const client = tonalClient({
    getMovements: async () => [BENCH_MOVEMENT],
    estimateWorkoutDuration: async () => ({ duration: 200 }),
  });

  const text = reportText(
    await estimateWorkoutDuration(client, {
      exercises: [
        {
          movementName: 'Bench Press',
          weight: 70,
          setDetails: [{ reps: 10, weight: 80 }, { reps: 8, weight: 90 }],
        },
      ],
    })
  );

  assert.doesNotMatch(text, /70%/, '70 reaches no set, so printing it would be false');
  assert.match(text, /2 sets with per-set programming/);
});

test('a uniform exercise still prints its weight without the fallback wording', async () => {
  const client = tonalClient({
    getMovements: async () => [BENCH_MOVEMENT],
    estimateWorkoutDuration: async () => ({ duration: 300 }),
  });

  const text = reportText(
    await estimateWorkoutDuration(client, {
      exercises: [{ movementName: 'Bench Press', sets: 3, reps: 10, weight: 70 }],
    })
  );

  assert.match(text, /3 sets × 10 reps @ 70%/);
  assert.doesNotMatch(text, /where unspecified/);
});
