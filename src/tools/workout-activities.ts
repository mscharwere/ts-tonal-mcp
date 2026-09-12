import TonalClient from '@dlwiest/ts-tonal-client';
import type { TonalWorkoutActivity } from '@dlwiest/ts-tonal-client';
import { MCPResponse } from '../types/index.js';
import { handleToolError, TonalMCPError } from '../utils/error-handler.js';

// Cherry-picked from upstream dlwiest/ts-tonal-mcp commit 020a063 (add workout
// activity enumeration tool), as finalized by 87dab74. Adapted only where our
// conventions differ (none needed here -- this file already matched).

const DEFAULT_OFFSET = 0;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function validateOptionalIntegerInRange(
  value: unknown,
  fieldName: string,
  minimum: number,
  maximum?: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    const range = maximum === undefined
      ? `an integer greater than or equal to ${minimum}`
      : `an integer from ${minimum} to ${maximum}`;
    throw new TonalMCPError(
      `${fieldName} must be ${range}`,
      'VALIDATION_ERROR',
      400
    );
  }

  return value;
}

function sortNewestFirst(
  activities: TonalWorkoutActivity[]
): TonalWorkoutActivity[] {
  return [...activities].sort(
    (left, right) => Date.parse(right.beginTime) - Date.parse(left.beginTime)
  );
}

export async function listWorkoutActivities(
  client: TonalClient,
  args?: Record<string, unknown>
): Promise<MCPResponse> {
  try {
    const offset = validateOptionalIntegerInRange(
      args?.offset,
      'offset',
      0
    ) ?? DEFAULT_OFFSET;
    const limit = validateOptionalIntegerInRange(
      args?.limit,
      'limit',
      1,
      MAX_LIMIT
    ) ?? DEFAULT_LIMIT;

    const activities = await client.getWorkoutActivities(offset, limit);
    const orderedActivities = sortNewestFirst(activities);

    let report = '# Workout Activities\n\n';
    report += '- Source: workout-activities\n';
    report += `- API offset: ${offset}\n`;
    report += `- API limit: ${limit}\n`;
    report += `- Activities returned: ${orderedActivities.length}\n`;
    report += "- API page selection: oldest-first; offset 0 requests the account's oldest activities, and increasing offset advances toward newer activities\n";
    report += '- Display order: newest-first within this API-selected page only\n';
    report += "- For the account's recent workouts, use get_recent_workouts instead -- this tool's offset-0 page is the OLDEST activities, not the most recent ones\n";

    if (orderedActivities.length === 0) {
      report += '- Page beginTime range: none\n';
    } else {
      report += `- Page beginTime range: ${orderedActivities[orderedActivities.length - 1].beginTime} (oldest) to ${orderedActivities[0].beginTime} (newest)\n`;
    }

    if (activities.length === limit) {
      report += `- nextOffset: ${offset + activities.length} (the full page means additional activities may exist)\n`;
    }

    report += '\n## Activities\n';
    if (orderedActivities.length === 0) {
      report += 'No workout activities found at this API offset.\n';
    } else {
      for (const activity of orderedActivities) {
        report += `- ${activity.beginTime} | workoutActivityId ${activity.id} | Sets ${activity.totalSets} | Reps ${activity.totalReps} | Volume ${activity.totalVolume.toLocaleString()} lb\n`;
      }
    }

    return {
      content: [{ type: 'text' as const, text: report }],
    };
  } catch (error) {
    return handleToolError(error, 'list_workout_activities');
  }
}
