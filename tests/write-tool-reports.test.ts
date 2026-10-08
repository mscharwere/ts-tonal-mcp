import assert from 'node:assert/strict';
import test from 'node:test';
import type TonalClient from '@dlwiest/ts-tonal-client';
import type { TonalMovement, TonalWorkoutEstimateSet } from '@dlwiest/ts-tonal-client';
import { createWorkout } from '../src/tools/custom-workouts.js';
import type { MCPResponse } from '../src/types/index.js';

// The three write tools are never invoked against the live account, by policy. Their success
// reports are therefore code that only ever runs after a real mutation -- i.e. never exercised
// at all. These tests drive that formatting with a mocked client so the report path is covered
// without creating anything on Tonal, and so the exercise summary stays mirrored with
// estimate_workout_duration's (see the comment in src/tools/workout-duration.ts).

function fakeClient(methods: Record<string, unknown>): TonalClient {
  // Test seam: only the methods under exercise are stubbed, so the real TonalClient shape is
  // deliberately not satisfied.
  const stub = methods as unknown as TonalClient;
  return stub;
}

function reportText(response: MCPResponse): string {
  const [content] = response.content;
  assert.ok(content && content.type === 'text', 'expected a text content block');
  return content.text;
}

const BENCH = { id: 'bench', name: 'Bench Press', countReps: true } as unknown as TonalMovement;
const PLANK = { id: 'plank', name: 'Plank Jack', countReps: false } as unknown as TonalMovement;

function creator(onCreate?: (payload: { sets: TonalWorkoutEstimateSet[] }) => void) {
  return fakeClient({
    getMovements: async () => [BENCH, PLANK],
    createWorkout: async (payload: { sets: TonalWorkoutEstimateSet[]; title: string }) => {
      onCreate?.(payload);
      return { id: 'wk-1', title: payload.title, duration: 900, sets: payload.sets };
    },
  });
}

test('create_workout report singularizes a one-set exercise, matching the estimate tool', async () => {
  const text = reportText(
    await createWorkout(creator(), {
      title: 'Single Set Day',
      exercises: [{ movementName: 'Bench Press', sets: 1, reps: 5 }],
    })
  );

  assert.match(text, /- 1 set × 5 reps/, 'must not read "1 sets"');
  assert.doesNotMatch(text, /1 sets/);
});

test('create_workout report pluralizes normally above one set', async () => {
  const text = reportText(
    await createWorkout(creator(), {
      title: 'Normal Day',
      exercises: [
        { movementName: 'Bench Press', sets: 4, reps: 8, weight: 70 },
        { movementName: 'Plank Jack', sets: 3, duration: 45 },
      ],
    })
  );

  assert.match(text, /- 4 sets × 8 reps @ 70%/);
  assert.match(text, /- 3 sets × 45s/);
  assert.match(text, /Estimated Duration:\*\* 15 minutes/);
  assert.match(text, /Workout ID:\*\* wk-1/);
});

test('create_workout still accepts the shared exercise schema shape, setDetails included', async () => {
  // Guards the schema extraction: create_workout, update_workout and
  // estimate_workout_duration now share one exercise schema, so the input shape that schema
  // advertises must still be accepted by the handler and reach the client as sets.
  let received: TonalWorkoutEstimateSet[] | undefined;
  const text = reportText(
    await createWorkout(creator(p => { received = p.sets; }), {
      title: 'Per-set Day',
      description: 'built from setDetails',
      exercises: [
        {
          movementName: 'Bench Press',
          weight: 70,
          setDetails: [{ reps: 10 }, { reps: 8, weight: 85 }],
          block: 1,
        },
      ],
    })
  );

  assert.match(text, /2 sets with per-set programming/);
  assert.equal(received?.length, 2);
  assert.equal(received?.[0].weightPercentage, 70, 'exercise weight is the per-set fallback');
  assert.equal(received?.[1].weightPercentage, 85, 'a per-set weight wins');
});

test('create_workout surfaces a validation failure without calling the client', async () => {
  let created = false;
  const response = await createWorkout(
    fakeClient({
      getMovements: async () => [BENCH],
      createWorkout: async () => { created = true; return { id: 'x', title: 'x', duration: 0, sets: [] }; },
    }),
    { title: '', exercises: [{ movementName: 'Bench Press', sets: 1, reps: 5 }] }
  );

  assert.equal(response.isError, true);
  assert.equal(created, false, 'nothing may be created when validation fails');
  assert.match(reportText(response), /title is required/i);
});

test('create_workout surfaces an unknown movement without calling the client', async () => {
  let created = false;
  const response = await createWorkout(
    fakeClient({
      getMovements: async () => [BENCH],
      createWorkout: async () => { created = true; return { id: 'x', title: 'x', duration: 0, sets: [] }; },
    }),
    { title: 'Bad Day', exercises: [{ movementName: 'Not A Movement', sets: 1, reps: 5 }] }
  );

  assert.equal(response.isError, true);
  assert.equal(created, false, 'nothing may be created for an unknown movement');
});
