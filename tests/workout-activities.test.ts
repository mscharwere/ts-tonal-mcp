import assert from 'node:assert/strict';
import test from 'node:test';
import type TonalClient from '@dlwiest/ts-tonal-client';
import type { TonalWorkoutActivity } from '@dlwiest/ts-tonal-client';
import { listWorkoutActivities } from '../src/tools/workout-activities.js';
import { toolsRegistry } from '../src/tools/registry.js';
import type { MCPResponse } from '../src/types/index.js';

function tonalClient(methods: Record<string, unknown>): TonalClient {
  return methods as unknown as TonalClient;
}

function reportText(response: MCPResponse): string {
  const [content] = response.content;
  assert.ok(content && content.type === 'text', 'expected a text content block');
  return (content as { type: 'text'; text: string }).text;
}

function activity(
  id: string,
  beginTime: string,
  overrides: Partial<TonalWorkoutActivity> = {}
): TonalWorkoutActivity {
  return {
    id,
    userId: 'user-1',
    workoutId: `workout-${id}`,
    beginTime,
    endTime: beginTime,
    totalDuration: 600,
    activeDuration: 120,
    totalSets: 3,
    totalReps: 30,
    totalVolume: 1_500,
    completed: true,
    workoutSetActivity: [],
    ...overrides,
  };
}

function recordingClient(activities: TonalWorkoutActivity[]): {
  client: TonalClient;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  return {
    client: tonalClient({
      getWorkoutActivities: async (...args: unknown[]) => {
        calls.push(args);
        return activities;
      },
    }),
    calls,
  };
}

const ACTIVITIES = [
  activity('activity-1', '2026-08-10T12:00:00Z'),
  activity('activity-2', '2026-08-30T12:00:00Z', {
    totalSets: 5,
    totalReps: 42,
    totalVolume: 2_400,
  }),
  activity('activity-3', '2026-08-20T12:00:00Z'),
];

test('registers list_workout_activities with a user property and a pagination-trap warning', () => {
  const tool = toolsRegistry.get('list_workout_activities');
  assert.ok(tool);
  assert.match(tool.description, /oldest/i);
  assert.match(tool.description, /get_recent_workouts/);
  assert.ok('user' in tool.inputSchema.properties, 'expected a user property for multi-user account switching');
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.equal(tool.annotations?.destructiveHint, false);
});

test('registers get_workout_activity_details with a user property', () => {
  const tool = toolsRegistry.get('get_workout_activity_details');
  assert.ok(tool);
  assert.ok('user' in tool.inputSchema.properties, 'expected a user property for multi-user account switching');
  assert.deepEqual(tool.inputSchema.required, ['activityId']);
});

test('sends offset and limit to getWorkoutActivities with honest defaults', async () => {
  const { client, calls } = recordingClient([]);

  await listWorkoutActivities(client);

  assert.deepEqual(calls, [[0, 20]]);
});

test('sends explicit offset and limit through unchanged', async () => {
  const { client, calls } = recordingClient([]);

  await listWorkoutActivities(client, { offset: 40, limit: 5 });

  assert.deepEqual(calls, [[40, 5]]);
});

test('displays the returned page newest-first while reporting the true oldest-first API order', async () => {
  const { client } = recordingClient(ACTIVITIES);

  const response = await listWorkoutActivities(client, { offset: 0, limit: 20 });
  const text = reportText(response);

  const indexOfNewest = text.indexOf('activity-2');
  const indexOfMiddle = text.indexOf('activity-3');
  const indexOfOldest = text.indexOf('activity-1');
  assert.ok(indexOfNewest > -1 && indexOfMiddle > -1 && indexOfOldest > -1);
  assert.ok(indexOfNewest < indexOfMiddle, 'newest activity should be listed before the middle one');
  assert.ok(indexOfMiddle < indexOfOldest, 'middle activity should be listed before the oldest one');

  assert.match(text, /oldest\).*2026-08-30T12:00:00Z \(newest\)/s);
});

test('reports nextOffset only when the page is full', async () => {
  const fullPage = new Array(20).fill(null).map((_, index) =>
    activity(`activity-${index}`, `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00Z`)
  );
  const { client: fullClient } = recordingClient(fullPage);
  const fullResponse = await listWorkoutActivities(fullClient, { limit: 20 });
  assert.match(reportText(fullResponse), /nextOffset: 20/);

  const { client: partialClient } = recordingClient(ACTIVITIES);
  const partialResponse = await listWorkoutActivities(partialClient, { limit: 20 });
  assert.doesNotMatch(reportText(partialResponse), /nextOffset/);
});

test('handles an empty page without throwing', async () => {
  const { client } = recordingClient([]);

  const response = await listWorkoutActivities(client);
  const text = reportText(response);

  assert.match(text, /No workout activities found/);
  assert.match(text, /Page beginTime range: none/);
});

test('rejects an out-of-range limit as a validation error rather than forwarding it', async () => {
  const { client, calls } = recordingClient([]);

  const response = await listWorkoutActivities(client, { limit: 500 });

  assert.equal(response.isError, true);
  assert.equal(calls.length, 0);
  assert.match(reportText(response), /limit must be an integer from 1 to 100/);
});

test('rejects a negative offset as a validation error rather than forwarding it', async () => {
  const { client, calls } = recordingClient([]);

  const response = await listWorkoutActivities(client, { offset: -1 });

  assert.equal(response.isError, true);
  assert.equal(calls.length, 0);
});

test('surfaces a client failure as a tool error, not a throw', async () => {
  const client = tonalClient({
    getWorkoutActivities: async () => {
      throw new Error('upstream 503');
    },
  });

  const response = await listWorkoutActivities(client);

  assert.equal(response.isError, true);
  assert.match(reportText(response), /upstream 503/);
});
