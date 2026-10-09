import assert from 'node:assert/strict';
import test from 'node:test';
import type TonalClient from '@dlwiest/ts-tonal-client';
import { isoWeekNumber, tonalToday, weekNumberBefore } from '../src/utils/tonal-week.js';

function fakeClient(methods: Record<string, unknown>): TonalClient {
  // Test seam: only getDailyMetrics is stubbed, so the real TonalClient shape is
  // deliberately not satisfied.
  const stub = methods as unknown as TonalClient;
  return stub;
}

test('isoWeekNumber matches the two week numbers confirmed against live Tonal data', () => {
  // Confirmed live: getTargetScores/getMetricScores reported 202634 for the week of Monday
  // 2026-08-17, and 202635 once the account's "today" rolled over to Monday 2026-08-24.
  assert.equal(isoWeekNumber('2026-08-17'), 202634);
  assert.equal(isoWeekNumber('2026-08-24'), 202635);
});

test('isoWeekNumber follows the ISO week-year, which Tonal is confirmed to use', () => {
  // No longer an assumption. Tonal's own weekly Volume total for the ISO week numbered 2026-01
  // reconstructs exactly from daily volume on 2025-12-29 + 12-30 + 12-31 -- December 2025
  // days filed under week 01 of 2026, which only the ISO week-year rule produces. Tonal also
  // emits no 202553 (ISO gives 2025 52 weeks; the US convention would give 53).
  assert.equal(isoWeekNumber('2025-12-29'), 202601, 'Tonal counts this Monday in week 202601');
  assert.equal(isoWeekNumber('2025-12-31'), 202601, 'and this Wednesday too');
  assert.equal(isoWeekNumber('2025-12-27'), 202552, 'while the prior Saturday stays in 202552');
  assert.equal(isoWeekNumber('2027-01-01'), 202653, 'Friday still inside ISO week 53 of 2026');
  // The conventions also disagree on every Sunday; ISO closes the week rather than opening one.
  assert.equal(isoWeekNumber('2026-08-23'), 202634, 'Sunday closes the ISO week; US would say 202635');
});

test('isoWeekNumber reproduces the year-boundary week Tonal actually reported', () => {
  // The exact discriminator, as a regression guard: these three dates and no others must land
  // in 202601, because their daily volumes sum to the weekly total Tonal reports for it.
  const boundary = ['2025-12-29', '2025-12-30', '2025-12-31'];
  for (const date of boundary) {
    assert.equal(isoWeekNumber(date), 202601, `${date} belongs to Tonal week 202601`);
  }
  for (const outside of ['2025-12-28', '2026-01-05']) {
    assert.notEqual(isoWeekNumber(outside), 202601, `${outside} must NOT fall in 202601`);
  }
});

test('isoWeekNumber throws on a date it cannot parse rather than returning NaN', () => {
  // A NaN would bypass tonalToday's catch and surface as "Current Week (NaN)"
  // with every value blank, which reads as authoritative rather than unavailable.
  for (const bad of ['2026-08-24T00:00:00Z', '2026/08/24', '', 'not-a-date']) {
    assert.throws(() => isoWeekNumber(bad), /YYYY-MM-DD/, `${JSON.stringify(bad)} must throw`);
  }
});

test('weekNumberBefore walks back by dates, not by subtracting from the YYYYWW encoding', () => {
  // 202635 minus 4 "weeks" naively would be 202631, which happens to be right here...
  assert.equal(weekNumberBefore('2026-08-24', 4), 202631);
  // ...but across a year boundary the encoding is not arithmetic: 202601 minus 4 is not a
  // week number at all. Date math gives the real answer.
  assert.equal(weekNumberBefore('2026-01-05', 4), 202550);
  assert.equal(weekNumberBefore('2026-08-24', 52), 202535);
  assert.equal(weekNumberBefore('2026-08-24', 0), 202635);
});

test('weekNumberBefore rejects an unparseable date', () => {
  assert.throws(() => weekNumberBefore('2026-08-24T00:00:00Z', 4), /YYYY-MM-DD/);
});

test('tonalToday asks Tonal for today rather than reading the local clock', async () => {
  let requestedDays: number | undefined;
  const client = fakeClient({
    getDailyMetrics: async (days: number) => {
      requestedDays = days;
      return [{ date: '2026-08-24' }];
    },
  });

  const today = await tonalToday(client);
  assert.deepEqual(today, { date: '2026-08-24', weekNumber: 202635 });
  assert.equal(requestedDays, 1, 'only today is needed, so only one day should be requested');
});

test('tonalToday degrades to undefined for an unparseable date', async () => {
  const client = fakeClient({
    getDailyMetrics: async () => [{ date: '2026-08-24T00:00:00Z' }],
  });

  assert.equal(await tonalToday(client), undefined);
});

test('tonalToday returns undefined instead of throwing when Tonal fails', async () => {
  const client = fakeClient({
    getDailyMetrics: async () => {
      throw new Error('network error');
    },
  });

  assert.equal(await tonalToday(client), undefined);
});

test('tonalToday returns undefined when the response carries no date', async () => {
  const client = fakeClient({ getDailyMetrics: async () => [] });
  assert.equal(await tonalToday(client), undefined);
});
