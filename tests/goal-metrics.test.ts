import assert from 'node:assert/strict';
import test from 'node:test';
import type TonalClient from '@dlwiest/ts-tonal-client';
import type {
  TonalGoalMetric,
  TonalMetricScoresResponse,
  TonalTargetScoresResponse,
} from '@dlwiest/ts-tonal-client';
import { getGoalMetrics } from '../src/tools/goal-metrics.js';
import type { MCPResponse } from '../src/types/index.js';

function fakeClient(methods: Record<string, unknown>): TonalClient {
  // Test seam: only the handful of methods each test exercises are stubbed, so the real
  // TonalClient shape is deliberately not satisfied.
  const stub = methods as unknown as TonalClient;
  return stub;
}

function reportText(response: MCPResponse): string {
  const [content] = response.content;
  assert.ok(content && content.type === 'text', 'expected a text content block');
  return content.text;
}

// Mirrors the seven metrics the live account actually returns, including the descriptions
// that cross-reference each other.
const GOAL_METRICS: TonalGoalMetric[] = [
  { id: 'm-volume', name: 'Volume', goalId: 'g1', description: 'Total pounds lifted. Lifting more volume drives hypertrophy.' },
  { id: 'm-work', name: 'Work', goalId: 'g1', description: 'Work in kilojoules, a proxy for calorie burn.' },
  { id: 'm-mqs', name: 'Movement Quality Score', goalId: 'g1', description: 'How much your workouts improve movement patterns.' },
  { id: 'm-strength-sets', name: 'Strength Sets', goalId: 'g1', description: 'Sets above 72% of your one-rep max, as lifting heavier increases muscular strength.' },
  { id: 'm-power', name: 'Power Reps', goalId: 'g1', description: 'Reps above 80% of your Power PR. Explosive lifting develops power.' },
  { id: 'm-endurance', name: 'Endurance Sets', goalId: 'g1', description: 'Nine or more reps at your suggested weight to boost stamina through high-effort strength work.' },
  { id: 'm-fss', name: 'Functional Strength Score', goalId: 'g1', description: 'Unilateral and rotational moves that develop functional strength.' },
] as TonalGoalMetric[];

const TARGETS: TonalTargetScoresResponse = {
  'm-strength-sets': [
    { userId: 'u1', weekNumber: 202635, metricId: 'm-strength-sets', target: 13, lowRange: 11, highRange: 15 },
    { userId: 'u1', weekNumber: 202634, metricId: 'm-strength-sets', target: 12, lowRange: 10, highRange: 13 },
  ],
  'm-fss': [
    { userId: 'u1', weekNumber: 202634, metricId: 'm-fss', target: 150.00, lowRange: 140, highRange: 190 },
  ],
} as TonalTargetScoresResponse;

const SCORES: TonalMetricScoresResponse = {
  'm-strength-sets': [
    { userId: 'u1', weekNumber: 202634, metricId: 'm-strength-sets', score: 14.50 },
  ],
  'm-fss': [
    { userId: 'u1', weekNumber: 202634, metricId: 'm-fss', score: 200.00 },
  ],
} as TonalMetricScoresResponse;

function client(today: string | null = '2026-08-24') {
  return fakeClient({
    getGoalMetrics: async () => GOAL_METRICS,
    getTargetScores: async () => TARGETS,
    getMetricScores: async () => SCORES,
    getDailyMetrics: async () => (today === null ? [] : [{ date: today }]),
  });
}

test('reports every goal metric when no filter is given', async () => {
  const text = reportText(await getGoalMetrics(client(), {}));

  for (const metric of GOAL_METRICS) {
    assert.match(text, new RegExp(`## ${metric.name}`), `${metric.name} must be reported`);
  }
  assert.doesNotMatch(text, /Filtered to names/, 'no filter notice when unfiltered');
});

test('filters on metric NAME only, never descriptions', async () => {
  const text = reportText(await getGoalMetrics(client(), { filter: 'strength' }));

  assert.match(text, /## Strength Sets/);
  assert.match(text, /## Functional Strength Score/);
  // These two describe strength in their blurbs but are not strength metrics. Matching
  // descriptions would silently include them.
  assert.doesNotMatch(text, /## Endurance Sets/);
  assert.doesNotMatch(text, /## Volume/);
  assert.match(text, /Filtered to names matching "strength" \(2 of 7\)/);
});

test('filtering is case-insensitive', async () => {
  const text = reportText(await getGoalMetrics(client(), { filter: 'STRENGTH sEtS'.slice(0, 8) }));
  assert.match(text, /## Strength Sets/);
});

test('a filter matching nothing lists what is available instead of failing silently', async () => {
  const response = await getGoalMetrics(client(), { filter: 'cardio' });
  const text = reportText(response);

  assert.notEqual(response.isError, true, 'an empty match is not an error');
  assert.match(text, /No goal metric name matched "cardio"/);
  assert.match(text, /Available: .*Strength Sets/);
});

test('a non-string filter is a validation error', async () => {
  const response = await getGoalMetrics(client(), { filter: 42 });
  assert.equal(response.isError, true);
  assert.match(reportText(response), /filter must be a string/);
});

test('reports the real current week even when it has no actual score yet', async () => {
  // Today is 2026-08-24 -> week 202635. Strength Sets has a 202635 target but no score.
  const text = reportText(await getGoalMetrics(client(), { filter: 'Strength Sets' }));

  assert.match(text, /Current Week \(202635\)/);
  assert.match(text, /Actual: N\/A/);
  assert.match(text, /Target: 13\.00/);
  assert.match(text, /Range: 11\.00 - 15\.00/);
});

test('labels a fallback week distinctly rather than implying it is the current week', async () => {
  // Functional Strength Score has data only for 202634, while the real current week is 202635.
  const text = reportText(await getGoalMetrics(client(), { filter: 'Functional' }));

  assert.match(text, /Most Recent Available Week \(202634\)/);
  assert.match(text, /current week \(202635\) has no data yet/);
  assert.match(text, /Actual: 200\.00/);
  assert.match(text, /Target: 150\.00/);
});

test('never reports a pre-populated FUTURE week as current, and keeps it out of the trend', async () => {
  const futureTargets = {
    'm-strength-sets': [
      { userId: 'u1', weekNumber: 202640, metricId: 'm-strength-sets', target: 14, lowRange: 12, highRange: 16 },
      { userId: 'u1', weekNumber: 202634, metricId: 'm-strength-sets', target: 12, lowRange: 10, highRange: 13 },
    ],
  } as TonalTargetScoresResponse;

  const withFuture = fakeClient({
    getGoalMetrics: async () => GOAL_METRICS,
    getTargetScores: async () => futureTargets,
    getMetricScores: async () => SCORES,
    getDailyMetrics: async () => [{ date: '2026-08-24' }],
  });

  const text = reportText(await getGoalMetrics(withFuture, { filter: 'Strength Sets' }));

  assert.doesNotMatch(text, /Current Week \(202640\)/, 'a future week is not "current"');
  assert.doesNotMatch(text, /Week 202640/, 'a future week must not leak into the trend');
  assert.match(text, /Most Recent Available Week \(202634\)/);
  assert.match(text, /Actual: 14\.50/);
});

test('anchors on the newest week with an actual, labeled, when today cannot be determined', async () => {
  // 202635 exists as a target only; 202634 is the newest week with a recorded actual. With
  // today unknown, 202634 is the honest anchor -- reporting 202635 would show "Actual: N/A"
  // for a week that may not have happened while burying the real actual.
  const text = reportText(await getGoalMetrics(client(null), { filter: 'Strength Sets' }));

  assert.match(text, /Most Recent Available Week \(202634\)/);
  assert.match(text, /today's current week could not be determined/);
  assert.match(text, /Actual: 14\.50/);
  assert.doesNotMatch(text, /202635/, 'a target-only newer week must not be presented as current');
});

test('says how far back it looked when a metric has no actuals in the window', async () => {
  // getMetricScores({}) here stands for "the lookback returned nothing for this metric".
  // The copy must NOT claim there is no completed activity -- this tool only ever sees a
  // window, and the account may have years of older history outside it.
  const noScores = fakeClient({
    getGoalMetrics: async () => GOAL_METRICS,
    getTargetScores: async () => TARGETS,
    getMetricScores: async () => ({}),
    getDailyMetrics: async () => [{ date: '2026-08-24' }],
  });

  const text = reportText(await getGoalMetrics(noScores, { filter: 'Strength Sets' }));

  assert.match(text, /No actual scores in the last 52 weeks/);
  assert.doesNotMatch(text, /no completed activity/, 'must not claim the account never trained');
  assert.match(text, /Target: 13\.00/, 'targets must still be reported');
});

test('requests actuals with a startWeek, because the bare call returns nothing', async () => {
  // Verified live: getMetricScores() with no startWeek returns {} even on an account with
  // years of history, while an explicit early startWeek returns hundreds of entries.
  // Omitting it makes every Actual read N/A.
  let received: unknown = 'NOT_CALLED';
  const spy = fakeClient({
    getGoalMetrics: async () => GOAL_METRICS,
    getTargetScores: async () => TARGETS,
    getMetricScores: async (startWeek: unknown) => {
      received = startWeek;
      return SCORES;
    },
    getDailyMetrics: async () => [{ date: '2026-08-24' }],
  });

  await getGoalMetrics(spy, {});
  assert.equal(received, 202535, '52 weeks before 2026-08-24 is week 202535');
});

test('still sends a startWeek when Tonal cannot tell us today', async () => {
  // Regression guard: passing no startWeek falls back to the bare getMetricScores call, which
  // returns {} -- that would lose every actual AND, with no scores left to anchor on, the
  // ceiling protection against future targets. The clock is fine for sizing a 52-week window
  // even though it must not be used to label the current week.
  let received: unknown = 'NOT_CALLED';
  const noToday = fakeClient({
    getGoalMetrics: async () => GOAL_METRICS,
    getTargetScores: async () => TARGETS,
    getMetricScores: async (startWeek: unknown) => {
      received = startWeek;
      return SCORES;
    },
    getDailyMetrics: async () => {
      throw new Error('network error');
    },
  });

  const text = reportText(await getGoalMetrics(noToday, { filter: 'Strength Sets' }));

  assert.equal(typeof received, 'number', 'a startWeek must still be sent');
  assert.ok((received as number) > 202000, 'startWeek must look like a YYYYWW value');
  // The label must still admit it does not know today -- the clock anchors the window only.
  assert.match(text, /today's current week could not be determined/);
});

test('degraded path still keeps future targets out of the report', async () => {
  // today unknown AND a future target present. Actuals still arrive (startWeek was sent), so
  // the newest scored week anchors the ceiling and 202640 stays out.
  const noTodayFuture = fakeClient({
    getGoalMetrics: async () => GOAL_METRICS,
    getTargetScores: async () => ({
      'm-strength-sets': [
        { userId: 'u1', weekNumber: 202640, metricId: 'm-strength-sets', target: 99, lowRange: 90, highRange: 110 },
        { userId: 'u1', weekNumber: 202634, metricId: 'm-strength-sets', target: 12, lowRange: 10, highRange: 13 },
      ],
    }),
    getMetricScores: async () => ({
      'm-strength-sets': [
        { userId: 'u1', weekNumber: 202634, metricId: 'm-strength-sets', score: 14.50 },
      ],
    }),
    getDailyMetrics: async () => {
      throw new Error('network error');
    },
  });

  const text = reportText(await getGoalMetrics(noTodayFuture, { filter: 'Strength Sets' }));

  assert.doesNotMatch(text, /202640/, 'future target must not surface');
  assert.doesNotMatch(text, /99\.00/, 'future target value must not surface');
  assert.match(text, /Most Recent Available Week \(202634\)/);
  assert.match(text, /Actual: 14\.50/);
});

test('names the most recent recorded week when the reported week has no actual', async () => {
  // The idle-account shape: targets for recent weeks, actuals only from months ago. Reporting
  // a bare "N/A" hides that there IS history; naming the last recorded week does not.
  const idle = fakeClient({
    getGoalMetrics: async () => GOAL_METRICS,
    getTargetScores: async () => TARGETS,
    getMetricScores: async () => ({
      'm-strength-sets': [
        { userId: 'u1', weekNumber: 202410, metricId: 'm-strength-sets', score: 21.5 },
        { userId: 'u1', weekNumber: 202409, metricId: 'm-strength-sets', score: 18 },
      ],
    }),
    getDailyMetrics: async () => [{ date: '2026-08-24' }],
  });

  const text = reportText(await getGoalMetrics(idle, { filter: 'Strength Sets' }));

  assert.match(text, /Current Week \(202635\)/);
  assert.match(text, /Actual: N\/A/);
  assert.match(text, /Most recent was week 202410: 21\.50/);
  assert.doesNotMatch(text, /No actual scores in the last/, 'there ARE actuals, just not this week');
});

test('does not claim missing actuals when the reported week has a score', async () => {
  const text = reportText(await getGoalMetrics(client(), { filter: 'Functional' }));
  assert.doesNotMatch(text, /No actual scores in the last/);
  assert.doesNotMatch(text, /Most recent was week/);
  assert.match(text, /Actual: 200\.00/);
});

test('a metric with no score data says so instead of throwing', async () => {
  const text = reportText(await getGoalMetrics(client(), { filter: 'Volume' }));
  assert.match(text, /## Volume/);
  assert.match(text, /No score data available for this metric/);
});

test('keeps future weeks out of the headline AND trend when today cannot be determined', async () => {
  // The invariant "never present a future target as current or as history" previously held
  // only when today's week was known. With getDailyMetrics failing, the newest week carrying
  // an ACTUAL becomes the ceiling, since Tonal records an actual only for a week that
  // happened. 202640/202639 are target-only future weeks and must not surface.
  const futureHeavy = fakeClient({
    getGoalMetrics: async () => GOAL_METRICS,
    getTargetScores: async () => ({
      'm-strength-sets': [
        { userId: 'u1', weekNumber: 202640, metricId: 'm-strength-sets', target: 14, lowRange: 12, highRange: 16 },
        { userId: 'u1', weekNumber: 202639, metricId: 'm-strength-sets', target: 14, lowRange: 12, highRange: 16 },
        { userId: 'u1', weekNumber: 202634, metricId: 'm-strength-sets', target: 12, lowRange: 10, highRange: 13 },
      ],
    }),
    getMetricScores: async () => ({
      'm-strength-sets': [
        { userId: 'u1', weekNumber: 202634, metricId: 'm-strength-sets', score: 14.50 },
      ],
    }),
    getDailyMetrics: async () => {
      throw new Error('network error');
    },
  });

  const text = reportText(await getGoalMetrics(futureHeavy, { filter: 'Strength Sets' }));

  assert.doesNotMatch(text, /202640/, 'a target-only future week must not appear anywhere');
  assert.doesNotMatch(text, /202639/, 'a target-only future week must not appear anywhere');
  assert.match(text, /Most Recent Available Week \(202634\)/);
  assert.match(text, /Actual: 14\.50/, 'the real actual must be the headline, not pushed out');
});

test('reports no goal metrics without inventing a filter the caller never passed', async () => {
  const empty = fakeClient({
    getGoalMetrics: async () => [],
    getTargetScores: async () => ({}),
    getMetricScores: async () => ({}),
    getDailyMetrics: async () => [{ date: '2026-08-24' }],
  });

  const response = await getGoalMetrics(empty, {});
  const text = reportText(response);

  assert.notEqual(response.isError, true);
  assert.match(text, /Tonal returned no goal metrics for this account/);
  assert.doesNotMatch(text, /undefined/, 'must not echo a filter that was never supplied');
});

test('echoes the filter actually applied, not the raw padded argument', async () => {
  const text = reportText(await getGoalMetrics(client(), { filter: '  Strength Sets  ' }));
  assert.match(text, /Filtered to names matching "strength sets"/);
  assert.match(text, /## Strength Sets/);
});

test('the trend heading does not claim contiguity for non-contiguous weeks', async () => {
  const sparse = fakeClient({
    getGoalMetrics: async () => GOAL_METRICS,
    getTargetScores: async () => ({
      'm-strength-sets': [
        { userId: 'u1', weekNumber: 202635, metricId: 'm-strength-sets', target: 13, lowRange: 11, highRange: 15 },
        { userId: 'u1', weekNumber: 202630, metricId: 'm-strength-sets', target: 12, lowRange: 10, highRange: 13 },
        { userId: 'u1', weekNumber: 202405, metricId: 'm-strength-sets', target: 11, lowRange: 9, highRange: 12 },
      ],
    }),
    getMetricScores: async () => ({
      'm-strength-sets': [
        { userId: 'u1', weekNumber: 202630, metricId: 'm-strength-sets', score: 9 },
      ],
    }),
    getDailyMetrics: async () => [{ date: '2026-08-24' }],
  });

  const text = reportText(await getGoalMetrics(sparse, { filter: 'Strength Sets' }));

  assert.match(text, /\*\*Last 3 Recorded Weeks\*\*/);
  assert.doesNotMatch(text, /Week Trend/, 'weeks spanning 15 calendar weeks are not "the last 3 weeks"');
});
