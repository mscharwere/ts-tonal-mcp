import TonalClient from '@dlwiest/ts-tonal-client';
import { MCPResponse } from '../types/index.js';
import { handleToolError } from '../utils/error-handler.js';
import { validateRequiredString } from '../utils/validation.js';

// Adapted from upstream dlwiest/ts-tonal-mcp commit 020a063 / 87dab74
// (get_workout_activity_details), but extended here to surface the mode-flag
// and performance fields upstream's version drops: chains/spotter/eccentric/
// burnout (which mode was actually engaged per set), spotterMode,
// repsInReserve, avgVelocity, maxWeight, weightPercentage, and the
// warmUp/dropSet flags. This is the entire point of the PR -- these fields
// are what let BAYMAX confirm which resistance mode Carlos actually trained
// under. get_workout_summary was NOT ported: it requires an upstream
// type-drift overlay (fields the 0.6.0 runtime returns but its own published
// declarations omit) that isn't worth carrying for the value it adds.

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
