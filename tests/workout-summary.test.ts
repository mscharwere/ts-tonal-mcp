import assert from 'node:assert/strict';
import test from 'node:test';
import type TonalClient from '@dlwiest/ts-tonal-client';
import { getWorkoutSummary } from '../src/tools/workout-activity-details.js';
import { toolsRegistry } from '../src/tools/registry.js';
import type { MCPResponse } from '../src/types/index.js';

// get_workout_summary is ported from upstream dlwiest/ts-tonal-mcp. All values are synthetic.

function fakeClient(methods: Record<string, unknown>): TonalClient {
  return methods as unknown as TonalClient;
}

function reportText(response: MCPResponse): string {
  const [content] = response.content;
  assert.ok(content && content.type === 'text', 'expected a text content block');
  return (content as { type: 'text'; text: string }).text;
}

const SUMMARY = {
  id: 'activity-42',
  deletedAt: null,
  userId: 'user-1',
  name: 'Upper Body Builder',
  workoutId: 'workout-1',
  coachName: 'Coach Example',
  targetArea: 'Upper Body',
  isInProgram: true,
  isGuidedWorkout: false,
  isBaselineWorkout: false,
  timestamp: '2026-08-30T12:00:00Z',
  UTCTimestamp: '2026-08-30T12:00:00Z',
  localTimestamp: '2026-08-30T05:00:00',
  endTime: '2026-08-30T15:02:00Z',
  timeZone: 'America/Los_Angeles',
  duration: 10_920,
  timeUnderTension: 360,
  movementSets: [
    {
      movementName: 'Bench Press',
      movementId: 'movement-bench',
      totalVolume: 1_250,
      totalOnMachineVolume: 1_250,
      blockNumber: 1,
      setGroup: 2,
      sets: [{ repCount: 5 }, { repCount: 5 }],
    },
    {
      movementName: 'Lat Pulldown',
      movementId: 'movement-pulldown',
      totalVolume: 800,
      totalOnMachineVolume: 800,
      blockNumber: 2,
      setGroup: 3,
      sets: [{ repCount: 8 }],
    },
  ],
};

test('get_workout_summary is registered read-only with a required activityId and the user selector', () => {
  const tool = toolsRegistry.get('get_workout_summary');
  assert.ok(tool, 'get_workout_summary must be registered');
  assert.deepEqual(tool.inputSchema.required, ['activityId']);
  assert.ok('activityId' in tool.inputSchema.properties);
  assert.ok('user' in tool.inputSchema.properties, 'multi-user selector must be advertised');
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.equal(tool.annotations?.destructiveHint, false);
  assert.match(tool.description, /timeUnderTension/);
});

test('surfaces summary metadata and preserves Tonal movement-breakdown order', async () => {
  const text = reportText(
    await getWorkoutSummary(fakeClient({ getFormattedWorkoutSummary: async () => SUMMARY }), {
      activityId: 'activity-42',
    })
  );

  assert.match(text, /Name: Upper Body Builder/);
  assert.match(text, /Coach: Coach Example/);
  assert.match(text, /Target area: Upper Body/);
  assert.match(text, /In program \(isInProgram\): yes/);
  assert.match(text, /Guided workout \(isGuidedWorkout\): no/);
  assert.match(text, /Total volume \(totalVolume\): 1250 lb/);
  assert.match(text, /On-machine volume \(totalOnMachineVolume\): 1250 lb/);
  assert.match(text, /Performed set entries: 2/);
  assert.ok(text.indexOf('1. Bench Press') < text.indexOf('2. Lat Pulldown'));
});

test('labels summary wall-clock duration and time under tension without swapping them', async () => {
  const text = reportText(
    await getWorkoutSummary(fakeClient({ getFormattedWorkoutSummary: async () => SUMMARY }), {
      activityId: 'activity-42',
    })
  );

  assert.match(text, /Wall-clock session duration \(duration\): 10920 seconds/);
  assert.match(text, /Time under tension \(timeUnderTension\): 360 seconds/);
  assert.doesNotMatch(text, /Wall-clock session duration \(duration\): 360 seconds/);
  assert.doesNotMatch(text, /^- Duration:/m);
});

test('reports "not reported" for fields the 0.6.0 client omits and tolerates a missing breakdown', async () => {
  const { coachName, timeUnderTension, movementSets, ...bare } = SUMMARY;
  void coachName; void timeUnderTension; void movementSets;
  const text = reportText(
    await getWorkoutSummary(fakeClient({ getFormattedWorkoutSummary: async () => bare }), {
      activityId: 'activity-42',
    })
  );

  assert.match(text, /Coach: not reported/);
  assert.match(text, /Time under tension \(timeUnderTension\): not reported/);
  assert.match(text, /No movement breakdown was returned/);
});

test('passes a trimmed activity ID to summary retrieval and maps failures to isError', async () => {
  const calls: string[] = [];
  const response = await getWorkoutSummary(
    fakeClient({
      getFormattedWorkoutSummary: async (activityId: string) => {
        calls.push(activityId);
        throw new Error('summary unavailable');
      },
    }),
    { activityId: '  activity-42  ' }
  );

  assert.deepEqual(calls, ['activity-42']);
  assert.equal(response.isError, true);
  assert.match(reportText(response), /summary unavailable/);
});

test('rejects a missing activity ID before calling the client', async () => {
  let calls = 0;
  const response = await getWorkoutSummary(
    fakeClient({ getFormattedWorkoutSummary: async () => { calls += 1; return SUMMARY; } }),
    {}
  );

  assert.equal(response.isError, true);
  assert.match(reportText(response), /VALIDATION_ERROR/);
  assert.equal(calls, 0);
});
