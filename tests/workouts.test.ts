import assert from 'node:assert/strict';
import test from 'node:test';
import type TonalClient from '@dlwiest/ts-tonal-client';
import type { TonalActivitySummary } from '@dlwiest/ts-tonal-client';
import { getRecentWorkouts } from '../src/tools/workouts.js';
import type { MCPResponse } from '../src/types/index.js';

function tonalClient(methods: Record<string, unknown>): TonalClient {
  return methods as unknown as TonalClient;
}

function reportText(response: MCPResponse): string {
  const [content] = response.content;
  assert.ok(content && content.type === 'text', 'expected a text content block');
  return (content as { type: 'text'; text: string }).text;
}

function activitySummary(overrides: Partial<TonalActivitySummary> = {}): TonalActivitySummary {
  return {
    id: 'activity-42',
    deletedAt: null,
    userId: 'user-1',
    name: 'Full Body',
    workoutId: 'workout-1',
    isInProgram: false,
    isGuidedWorkout: false,
    isBaselineWorkout: false,
    timestamp: new Date().toISOString(),
    UTCTimestamp: new Date().toISOString(),
    localTimestamp: new Date().toISOString(),
    endTime: new Date().toISOString(),
    timeZone: 'America/Los_Angeles',
    targetArea: 'Full Body',
    duration: 1800,
    timeUnderTension: 900,
    repGoalPercentage: null,
    totalReps: 50,
    totalVolume: 5000,
    ...overrides,
  } as TonalActivitySummary;
}

// This is the fix for finding #6: get_recent_workouts previously never emitted the
// activity ID, which made get_workout_activity_details undiscoverable for "what did
// I just do" -- list_workout_activities' offset-0 page is oldest-first, not recent.
test('emits workoutActivityId per row so get_workout_activity_details is discoverable', async () => {
  const client = tonalClient({
    getActivitySummaries: async () => [activitySummary({ id: 'activity-42' })],
  });

  const response = await getRecentWorkouts(client);
  const text = reportText(response);

  assert.match(text, /workoutActivityId: activity-42/);
});

test('handles an empty workout history without throwing', async () => {
  const client = tonalClient({
    getActivitySummaries: async () => [],
  });

  const response = await getRecentWorkouts(client);
  const text = reportText(response);

  assert.match(text, /No recent workouts found/);
});

test('respects the limit argument', async () => {
  const client = tonalClient({
    getActivitySummaries: async () => [
      activitySummary({ id: 'activity-1' }),
      activitySummary({ id: 'activity-2' }),
      activitySummary({ id: 'activity-3' }),
    ],
  });

  const response = await getRecentWorkouts(client, { limit: 1 });
  const text = reportText(response);

  assert.match(text, /workoutActivityId: activity-1/);
  assert.doesNotMatch(text, /workoutActivityId: activity-2/);
});

// Ported from upstream dlwiest/ts-tonal-mcp: wall-clock duration and time under tension are
// different quantities and must never be conflated in totals, averages, or per-row output.
test('distinguishes wall-clock duration from time under tension in totals and entries', async () => {
  const client = tonalClient({
    getActivitySummaries: async () => [
      activitySummary({ id: 'activity-42', duration: 10_920, timeUnderTension: 360 }),
    ],
  });

  const text = reportText(await getRecentWorkouts(client, { limit: 1 }));

  assert.match(text, /Total Wall-clock Time: 182 minutes/);
  assert.match(text, /Average Wall-clock Duration: 182 minutes/);
  assert.match(text, /Total Time Under Tension: 6 minutes/);
  assert.match(text, /Average Time Under Tension: 6 minutes/);
  assert.match(text, /Wall-clock duration \(duration\): 182 min/);
  assert.match(text, /Time under tension \(timeUnderTension\): 6 min/);
  assert.doesNotMatch(text, /^- Duration:/m);
  assert.doesNotMatch(text, /Average Duration:/);
  assert.match(text, /workoutActivityId: activity-42/, 'the workoutActivityId line is preserved');
});

test('averages wall-clock time and time under tension independently across several workouts', async () => {
  const client = tonalClient({
    getActivitySummaries: async () => [
      activitySummary({ id: 'a1', duration: 3600, timeUnderTension: 600 }),
      activitySummary({ id: 'a2', duration: 1800, timeUnderTension: 1200 }),
    ],
  });

  const text = reportText(await getRecentWorkouts(client, { limit: 2 }));

  assert.match(text, /Total Wall-clock Time: 90 minutes/);
  assert.match(text, /Average Wall-clock Duration: 45 minutes/);
  assert.match(text, /Total Time Under Tension: 30 minutes/);
  assert.match(text, /Average Time Under Tension: 15 minutes/);
});
