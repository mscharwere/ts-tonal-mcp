import assert from 'node:assert/strict';
import test from 'node:test';
import type TonalClient from '@dlwiest/ts-tonal-client';
import type { TonalMovement, TonalWorkoutActivity, TonalWorkoutSetActivity } from '@dlwiest/ts-tonal-client';
import { getWorkoutActivityDetails } from '../src/tools/workout-activity-details.js';
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

const BENCH_MOVEMENT = {
  id: 'movement-bench',
  name: 'Bench Press',
  countReps: true,
} as TonalMovement;

function setActivity(overrides: Partial<TonalWorkoutSetActivity> = {}): TonalWorkoutSetActivity {
  return {
    movementId: 'movement-bench',
    setGroup: 1,
    blockNumber: 1,
    repCount: 10,
    avgWeight: 40,
    maxWeight: 45,
    weightPercentage: 60,
    totalOnMachineVolume: 800,
    oneRepMax: 60,
    romLengthIn: 18,
    avgVelocity: 1.2,
    repsInReserve: 2,
    warmUp: false,
    dropSet: false,
    burnout: false,
    spotter: false,
    spotterMode: undefined,
    eccentric: false,
    chains: false,
    ...overrides,
  };
}

function activityDetail(
  overrides: Partial<TonalWorkoutActivity> = {}
): TonalWorkoutActivity {
  return {
    id: 'activity-1',
    userId: 'user-1',
    workoutId: 'workout-1',
    beginTime: '2026-09-01T12:00:00Z',
    endTime: '2026-09-01T12:30:00Z',
    totalDuration: 1800,
    activeDuration: 900,
    totalSets: 1,
    totalReps: 10,
    totalVolume: 800,
    completed: true,
    workoutSetActivity: [setActivity()],
    ...overrides,
  };
}

test('registers get_workout_activity_details with read-only annotations', () => {
  const tool = toolsRegistry.get('get_workout_activity_details');
  assert.ok(tool);
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.equal(tool.annotations?.destructiveHint, false);
});

test('requires an activityId', async () => {
  const client = tonalClient({
    getWorkoutActivityById: async () => activityDetail(),
    getMovements: async () => [BENCH_MOVEMENT],
  });

  const response = await getWorkoutActivityDetails(client, {});

  assert.equal(response.isError, true);
  assert.match(reportText(response), /activityId is required/);
});

// This is the entire point of PR-A: upstream's get_workout_activity_details drops the
// mode-flag fields that make custom-mode training (chains/spotter/eccentric/burnout)
// visible. Assert the extended report actually surfaces them, not just that the tool runs.
test('surfaces every mode-flag and performance field upstream drops', async () => {
  const client = tonalClient({
    getWorkoutActivityById: async (activityId: string) => {
      assert.equal(activityId, 'activity-1');
      return activityDetail({
        workoutSetActivity: [
          setActivity({
            chains: true,
            spotter: true,
            spotterMode: 'Assist',
            eccentric: true,
            burnout: true,
            warmUp: true,
            dropSet: true,
            repsInReserve: 3,
            avgVelocity: 0.9,
            weightPercentage: 75,
            avgWeight: 50,
            maxWeight: 55,
          }),
        ],
      });
    },
    getMovements: async () => [BENCH_MOVEMENT],
  });

  const response = await getWorkoutActivityDetails(client, { activityId: 'activity-1' });
  const text = reportText(response);

  assert.match(text, /Chains mode engaged \(chains\): yes/);
  assert.match(text, /Spotter mode engaged \(spotter\): yes/);
  assert.match(text, /Spotter mode \(spotterMode\): Assist/);
  assert.match(text, /Eccentric mode engaged \(eccentric\): yes/);
  assert.match(text, /Burnout mode engaged \(burnout\): yes/);
  assert.match(text, /Warm-up \(warmUp\): yes/);
  assert.match(text, /Drop set \(dropSet\): yes/);
  assert.match(text, /Reps in reserve \(repsInReserve\): 3/);
  assert.match(text, /Average velocity \(avgVelocity\): 0\.9/);
  assert.match(text, /Weight percentage \(weightPercentage\): 75 %/);
});

test('reports weights as per-cable with a derived total-load-per-rep figure alongside', async () => {
  const client = tonalClient({
    getWorkoutActivityById: async () => activityDetail({
      workoutSetActivity: [
        setActivity({ avgWeight: 40, maxWeight: 45, totalOnMachineVolume: 800, repCount: 10 }),
      ],
    }),
    getMovements: async () => [BENCH_MOVEMENT],
  });

  const response = await getWorkoutActivityDetails(client, { activityId: 'activity-1' });
  const text = reportText(response);

  assert.match(text, /per-cable/i);
  assert.match(text, /Average weight, per cable \(avgWeight\): 40 lb/);
  assert.match(text, /Maximum weight, per cable \(maxWeight\): 45 lb/);
  // totalOnMachineVolume (800) / repCount (10) = 80 lb total load per rep, both cables.
  assert.match(text, /Derived total load per rep \(totalOnMachineVolume \/ repCount, both cables\): 80 lb/);
});

test('omits the derived total-load figure rather than dividing by zero when repCount is missing', async () => {
  const client = tonalClient({
    getWorkoutActivityById: async () => activityDetail({
      workoutSetActivity: [
        setActivity({ repCount: undefined, totalOnMachineVolume: 800 }),
      ],
    }),
    getMovements: async () => [BENCH_MOVEMENT],
  });

  const response = await getWorkoutActivityDetails(client, { activityId: 'activity-1' });
  const text = reportText(response);

  assert.match(text, /Derived total load per rep \(totalOnMachineVolume \/ repCount, both cables\): not reported/);
});

test('resolves movement names from the catalog and falls back gracefully when unresolved', async () => {
  const client = tonalClient({
    getWorkoutActivityById: async () => activityDetail({
      workoutSetActivity: [setActivity({ movementId: 'movement-unknown' })],
    }),
    getMovements: async () => [BENCH_MOVEMENT],
  });

  const response = await getWorkoutActivityDetails(client, { activityId: 'activity-1' });
  const text = reportText(response);

  assert.match(text, /Unknown movement \(catalog entry unavailable\)/);
});

test('still reports set details when the movement catalog fetch fails', async () => {
  const client = tonalClient({
    getWorkoutActivityById: async () => activityDetail(),
    getMovements: async () => {
      throw new Error('catalog unavailable');
    },
  });

  const response = await getWorkoutActivityDetails(client, { activityId: 'activity-1' });

  assert.equal(response.isError, undefined);
  assert.match(reportText(response), /Unknown movement \(catalog entry unavailable\)/);
});

test('handles an activity with no performed sets', async () => {
  const client = tonalClient({
    getWorkoutActivityById: async () => activityDetail({ workoutSetActivity: [] }),
    getMovements: async () => [BENCH_MOVEMENT],
  });

  const response = await getWorkoutActivityDetails(client, { activityId: 'activity-1' });
  const text = reportText(response);

  assert.match(text, /No performed sets were returned/);
});

test('surfaces a client failure as a tool error, not a throw', async () => {
  const client = tonalClient({
    getWorkoutActivityById: async () => {
      throw new Error('activity not found');
    },
    getMovements: async () => [BENCH_MOVEMENT],
  });

  const response = await getWorkoutActivityDetails(client, { activityId: 'missing' });

  assert.equal(response.isError, true);
  assert.match(reportText(response), /activity not found/);
});
