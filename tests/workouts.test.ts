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

// Ported from upstream dlwiest/ts-tonal-mcp PR #12. An activity imported from another app
// comes back from Tonal with no name or workout type, an empty target area, no volume or
// reps, and a time under tension that just repeats the duration.
function externalActivity(overrides: Record<string, unknown> = {}): TonalActivitySummary {
  const { name: _name, workoutType: _workoutType, ...unnamed } = activitySummary();
  return {
    ...unnamed,
    id: 'activity-43',
    targetArea: '',
    duration: 2_700,
    timeUnderTension: 2_700,
    totalReps: 0,
    totalVolume: 0,
    activityType: 'External',
    source: 'Apple Watch',
    externalWorkoutType: 'walking',
    ...overrides,
  } as unknown as TonalActivitySummary;
}

test('labels activities imported from other apps instead of rendering an undefined name', async () => {
  const text = reportText(await getRecentWorkouts(tonalClient({
    getActivitySummaries: async () => [externalActivity()],
  }), { limit: 1 }));

  assert.match(text, /^\*\*External activity: walking \(Apple Watch\)\*\* \(/m);
  assert.match(text, /workoutActivityId: activity-43/);
  assert.match(text, /^- Wall-clock duration \(duration\): 45 min$/m);
  assert.match(text, /^- Type: External \(no Tonal activity detail, volume, reps, or time under tension\)$/m);
  assert.doesNotMatch(text, /undefined|Free Lift|Target:/);
});

test('falls back to "not reported" when an imported activity lacks its source or type', async () => {
  const text = reportText(await getRecentWorkouts(tonalClient({
    getActivitySummaries: async () => [externalActivity({ source: undefined, externalWorkoutType: undefined })],
  }), { limit: 1 }));

  assert.match(text, /External activity: not reported \(source not reported\)/);
  assert.doesNotMatch(text, /undefined/);
});

test('leaves imported activities out of the summary totals', async () => {
  const text = reportText(await getRecentWorkouts(tonalClient({
    getActivitySummaries: async () => [
      activitySummary({ id: 'activity-42', duration: 10_920, timeUnderTension: 360 }),
      externalActivity(),
    ],
  }), { limit: 2 }));

  assert.match(text, /Summary \(last 1 workouts\)/);
  assert.match(text, /Total Wall-clock Time: 182 minutes/);
  assert.match(text, /Average Wall-clock Duration: 182 minutes/);
  assert.match(text, /Total Time Under Tension: 6 minutes/);
  assert.match(text, /Average Time Under Tension: 6 minutes/);
  assert.match(text, /^- External Activities: 1 \(imported from other apps, not included above\)$/m);
  assert.match(text, /\*\*Full Body\*\*/);
  assert.match(text, /\*\*External activity: walking \(Apple Watch\)\*\*/);
});

test('reports zero averages rather than NaN when every recent activity is imported', async () => {
  const text = reportText(await getRecentWorkouts(tonalClient({
    getActivitySummaries: async () => [externalActivity()],
  }), { limit: 1 }));

  assert.match(text, /Average Wall-clock Duration: 0 minutes/);
  assert.match(text, /Average Time Under Tension: 0 minutes/);
  assert.doesNotMatch(text, /NaN/);
});

test('does not mention external activities when there are none', async () => {
  const text = reportText(await getRecentWorkouts(tonalClient({
    getActivitySummaries: async () => [activitySummary()],
  }), { limit: 1 }));

  assert.doesNotMatch(text, /External Activities:/);
});
