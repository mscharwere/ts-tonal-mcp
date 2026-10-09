import type TonalClient from '@dlwiest/ts-tonal-client';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Computes an ISO 8601 week number (Monday-start; week 1 is the week containing the year's
 * first Thursday) for a "YYYY-MM-DD" date string, encoded the way Tonal's own
 * TonalTargetScore/TonalMetricScore `weekNumber` fields are: YYYYWW (2026 week 34 -> 202634).
 *
 * CONFIRMED empirically that Tonal really does use ISO 8601 here, not the US convention
 * (Sunday-start, week 1 contains Jan 1). Method: sum daily `TonalDailyMetrics.totalVolume`
 * into weekly buckets under each convention and compare against Tonal's own weekly Volume
 * metric scores. Three independent results, all on real data:
 *
 *   1. Tonal's own weekly Volume total for an ISO week numbered 2026-01 reconstructs exactly
 *      by summing the daily volumes of 2025-12-29, -30 and -31 -- December 2025 days filed
 *      under week 01 of 2026. That is the ISO week-year rule; a calendar-year convention
 *      cannot produce it.
 *   2. No 202553 exists; the highest 2025 week observed is 202552. ISO gives 2025 exactly 52
 *      weeks, whereas the US convention would give 53.
 *   3. Ten consecutive weekly Volume totals match ISO bucketing 10/10 against 9/10 for the
 *      US convention, the single miss being precisely the year-boundary week.
 *
 * The two conventions also disagree on every Sunday (2026-08-23 is ISO 202634 but US
 * 202635), so that route would discriminate too on an account that trains on Sundays. This
 * one does not -- zero Sundays carried volume across 400 days -- which is why the year
 * boundary was the usable discriminator.
 */
export function isoWeekNumber(dateString: string): number {
  const [year, month, day] = dateString.split('-').map(Number);

  // Throw rather than let NaN propagate. TonalDailyMetrics.date is typed only as `string`,
  // and sibling date fields in this API are full timestamps, so a format change is possible.
  // NaN would sail past currentTonalWeekNumber's catch and be reported as an authoritative
  // "Current Week (NaN)" with every value blank; throwing routes it to the honest
  // could-not-determine fallback instead.
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Expected a "YYYY-MM-DD" date string, received ${JSON.stringify(dateString)}`);
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  // Move to the Thursday of this ISO week; the ISO week-year is that Thursday's year.
  const isoDayNum = (date.getUTCDay() + 6) % 7; // Monday=0 .. Sunday=6
  date.setUTCDate(date.getUTCDate() - isoDayNum + 3);
  const isoYear = date.getUTCFullYear();

  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);

  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / MS_PER_WEEK);
  return isoYear * 100 + week;
}

/**
 * Returns the ISO week number (YYYYWW) for the week containing the date `weeks` weeks before
 * `dateString`. Done by date arithmetic rather than subtracting from the YYYYWW encoding,
 * which is not arithmetic -- 202601 minus 4 is not a week number at all.
 */
export function weekNumberBefore(dateString: string, weeks: number): number {
  const [year, month, day] = dateString.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Expected a "YYYY-MM-DD" date string, received ${JSON.stringify(dateString)}`);
  }

  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() - weeks * 7);
  const iso = shifted.toISOString().slice(0, 10);
  return isoWeekNumber(iso);
}

export interface TonalToday {
  /** Account-local "today" as YYYY-MM-DD, per Tonal itself. */
  date: string;
  /** ISO week number (YYYYWW) containing that date. */
  weekNumber: number;
}

/**
 * Asks Tonal what "today" is via getDailyMetrics(1) rather than reading the MCP server
 * process's clock, which may run in a different timezone than the account. Verified live:
 * getDailyMetrics(1) returns exactly one row for today, and the series is dense day-by-day,
 * so [0] is today rather than the most recent day that happens to have activity.
 *
 * Returns both the date and its week number because callers need the date to compute a
 * lookback window (see weekNumberBefore) and the week number to label the report.
 *
 * Returns undefined instead of throwing when this can't be determined, so callers can fall
 * back to clearly-labeled behavior rather than silently guessing.
 */
export async function tonalToday(client: TonalClient): Promise<TonalToday | undefined> {
  try {
    const [today] = await client.getDailyMetrics(1);
    if (!today?.date) {
      return undefined;
    }
    return { date: today.date, weekNumber: isoWeekNumber(today.date) };
  } catch {
    return undefined;
  }
}
