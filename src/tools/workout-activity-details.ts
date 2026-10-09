import TonalClient from '@dlwiest/ts-tonal-client';
import type { TonalFormattedWorkoutSummary } from '@dlwiest/ts-tonal-client';
import { MCPResponse } from '../types/index.js';
import { handleToolError } from '../utils/error-handler.js';
import { validateRequiredString } from '../utils/validation.js';

// get_workout_activity_details is adapted from upstream dlwiest/ts-tonal-mcp 020a063 / 87dab74 but
// extended to surface the per-set mode-flag and performance fields upstream drops (chains/spotter/
// eccentric/burnout, spotterMode, repsInReserve, avgVelocity, maxWeight, weightPercentage,
// warmUp/dropSet) so BAYMAX can confirm which resistance mode was actually engaged.
// get_workout_summary below is ported from upstream 87dab74, including its type overlay.

interface FormattedMovementSet {
  movementName?: string | null;
  blockNumber?: number | null;
  setGroup?: number | null;
  totalVolume?: number | null;
  totalOnMachineVolume?: number | null;
  sets?: unknown[] | null;
}

// The 0.6.0 runtime returns these fields, but its published declarations omit them.
// Omit avoids conflicts with pending declarations; remove this overlay after a client
// release publishes the fields.
type CompleteFormattedWorkoutSummary = Omit<
  TonalFormattedWorkoutSummary,
  'coachName' | 'timeUnderTension' | 'movementSets'
> & {
  coachName?: string | null;
  timeUnderTension?: number | null;
  movementSets?: FormattedMovementSet[] | null;
};

function formatMetric(
  value: number | null | undefined,
  unit?: string
): string {
  if (value === undefined || value === null) {
    return 'not reported';
  }

  return unit ? `${value} ${unit}` : String(value);
}

function formatFlag(value: boolean | null | undefined): string {
  if (value === undefined || value === null) {
    return 'not reported';
  }
  return value ? 'yes' : 'no';
}

export async function getWorkoutActivityDetails(
  client: TonalClient,
  args?: Record<string, unknown>
): Promise<MCPResponse> {
  try {
    const activityId = validateRequiredString(args?.activityId, 'activityId');
    const detail = await client.getWorkoutActivityById(activityId);
    const movements = await client.getMovements().catch(() => []);
    const movementNames = new Map(
      movements.map(movement => [movement.id, movement.name])
    );

    let report = '# Workout Activity Details\n\n';
    report += `- Activity ID: ${detail.id}\n`;
    report += `- Began: ${detail.beginTime}\n`;
    report += `- Ended: ${detail.endTime ?? 'not reported'}\n`;
    report += `- Wall-clock session duration (totalDuration): ${formatMetric(detail.totalDuration, 'seconds')}\n`;
    report += `- Time under tension (activeDuration): ${formatMetric(detail.activeDuration, 'seconds')}\n`;
    report += `- Total sets: ${detail.totalSets}\n`;
    report += `- Total reps: ${detail.totalReps}\n`;
    report += `- Total volume: ${formatMetric(detail.totalVolume, 'lb')}\n`;
    report += '\nWeight fields below are per-cable resistance, as reported by Tonal. A derived total-load-per-rep figure is shown alongside each so a two-cable lift\'s real load is not misread as the per-cable number.\n';

    report += '\n## Performed Sets\n';
    if (detail.workoutSetActivity.length === 0) {
      report += 'No performed sets were returned for this activity.\n';
    } else {
      detail.workoutSetActivity.forEach((set, index) => {
        const movementName = movementNames.get(set.movementId)
          ?? 'Unknown movement (catalog entry unavailable)';
        const repCount = set.repCount;
        const totalOnMachineVolume = set.totalOnMachineVolume;
        const derivedTotalLoadPerRep =
          repCount !== undefined && repCount > 0 &&
          totalOnMachineVolume !== undefined && totalOnMachineVolume > 0
            ? totalOnMachineVolume / repCount
            : undefined;

        report += `\n### Set ${index + 1}: ${movementName}\n`;
        report += `- Set group (setGroup): ${formatMetric(set.setGroup)}\n`;
        report += `- Block number (blockNumber): ${formatMetric(set.blockNumber)}\n`;
        report += `- Reps (repCount): ${formatMetric(repCount)}\n`;
        report += `- Reps in reserve (repsInReserve): ${formatMetric(set.repsInReserve)}\n`;
        report += `- Average weight, per cable (avgWeight): ${formatMetric(set.avgWeight, 'lb')}\n`;
        report += `- Maximum weight, per cable (maxWeight): ${formatMetric(set.maxWeight, 'lb')}\n`;
        report += `- Weight percentage (weightPercentage): ${formatMetric(set.weightPercentage ?? undefined, '%')}\n`;
        report += `- Derived total load per rep (totalOnMachineVolume / repCount, both cables): ${formatMetric(derivedTotalLoadPerRep, 'lb')}\n`;
        report += `- One-rep max, per cable (oneRepMax): ${formatMetric(set.oneRepMax, 'lb')}\n`;
        report += `- On-machine volume (totalOnMachineVolume): ${formatMetric(totalOnMachineVolume, 'lb')}\n`;
        report += `- Average velocity (avgVelocity): ${formatMetric(set.avgVelocity)}\n`;
        report += `- Range of motion (romLengthIn): ${formatMetric(set.romLengthIn, 'in')}\n`;
        report += `- Warm-up (warmUp): ${formatFlag(set.warmUp)}\n`;
        report += `- Drop set (dropSet): ${formatFlag(set.dropSet)}\n`;
        report += `- Burnout mode engaged (burnout): ${formatFlag(set.burnout)}\n`;
        report += `- Spotter mode engaged (spotter): ${formatFlag(set.spotter)}\n`;
        report += `- Spotter mode (spotterMode): ${set.spotterMode ?? 'not reported'}\n`;
        report += `- Eccentric mode engaged (eccentric): ${formatFlag(set.eccentric)}\n`;
        report += `- Chains mode engaged (chains): ${formatFlag(set.chains)}\n`;
      });
    }

    return {
      content: [{ type: 'text' as const, text: report }],
    };
  } catch (error) {
    return handleToolError(error, 'get_workout_activity_details');
  }
}

export async function getWorkoutSummary(
  client: TonalClient,
  args?: Record<string, unknown>
): Promise<MCPResponse> {
  try {
    const activityId = validateRequiredString(args?.activityId, 'activityId');
    const summary = await client.getFormattedWorkoutSummary(activityId) as CompleteFormattedWorkoutSummary;

    let report = '# Workout Summary\n\n';
    report += `- Name: ${summary.name}\n`;
    report += `- Coach: ${summary.coachName ?? 'not reported'}\n`;
    report += `- Target area: ${summary.targetArea}\n`;
    report += `- In program (isInProgram): ${summary.isInProgram ? 'yes' : 'no'}\n`;
    report += `- Guided workout (isGuidedWorkout): ${summary.isGuidedWorkout ? 'yes' : 'no'}\n`;
    report += `- Wall-clock session duration (duration): ${formatMetric(summary.duration, 'seconds')}\n`;
    report += `- Time under tension (timeUnderTension): ${formatMetric(summary.timeUnderTension, 'seconds')}\n`;

    const movementSets = summary.movementSets ?? [];
    report += '\n## Movement Breakdown\n';
    if (movementSets.length === 0) {
      report += 'No movement breakdown was returned for this workout.\n';
    } else {
      movementSets.forEach((movement, index) => {
        report += `\n### ${index + 1}. ${movement.movementName ?? 'Unknown movement'}\n`;
        report += `- Block number (blockNumber): ${formatMetric(movement.blockNumber)}\n`;
        report += `- Set group (setGroup): ${formatMetric(movement.setGroup)}\n`;
        report += `- Total volume (totalVolume): ${formatMetric(movement.totalVolume, 'lb')}\n`;
        report += `- On-machine volume (totalOnMachineVolume): ${formatMetric(movement.totalOnMachineVolume, 'lb')}\n`;
        report += `- Performed set entries: ${movement.sets?.length ?? 'not reported'}\n`;
      });
    }

    return {
      content: [{ type: 'text' as const, text: report }],
    };
  } catch (error) {
    return handleToolError(error, 'get_workout_summary');
  }
}
