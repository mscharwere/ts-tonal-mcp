import TonalClient from '@dlwiest/ts-tonal-client';
import { validateOptionalLimit } from '../utils/validation.js';
import { MCPResponse } from '../types/index.js';

export async function getRecentWorkouts(client: TonalClient, args?: { limit?: number }): Promise<MCPResponse> {
  const limit = validateOptionalLimit(args?.limit);
  // Use activity summaries for completed workout data
  const activities = await client.getActivitySummaries();
  const recentActivities = activities.slice(0, limit);
  
  let report = `# 🏋️ Recent Workouts\n\n`;

  if (recentActivities.length === 0) {
    report += `No recent workouts found. Time to get moving! 💪\n`;
    return {
      content: [{ type: 'text' as const, text: report }],
    };
  }

  // Show summary stats
  const totalVolume = recentActivities.reduce((sum, w) => sum + w.totalVolume, 0);
  const totalWallClockTime = recentActivities.reduce((sum, w) => sum + w.duration, 0);
  const totalTimeUnderTension = recentActivities.reduce(
    (sum, w) => sum + w.timeUnderTension,
    0
  );
  const avgWallClockDuration = totalWallClockTime / recentActivities.length / 60;
  const avgTimeUnderTension = totalTimeUnderTension / recentActivities.length / 60;

  report += `**Summary (last ${recentActivities.length} workouts):**\n`;
  report += `- Total Volume: ${totalVolume.toLocaleString()} lbs\n`;
  report += `- Total Wall-clock Time: ${Math.round(totalWallClockTime / 60)} minutes\n`;
  report += `- Average Wall-clock Duration: ${Math.round(avgWallClockDuration)} minutes\n`;
  report += `- Total Time Under Tension: ${Math.round(totalTimeUnderTension / 60)} minutes\n`;
  report += `- Average Time Under Tension: ${Math.round(avgTimeUnderTension)} minutes\n\n`;

  report += `## Workout History\n\n`;

  recentActivities.forEach(activity => {
    const date = new Date(activity.timestamp);
    const daysAgo = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    const timeAgo = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;
    
    const wallClockDuration = Math.round(activity.duration / 60);
    const timeUnderTension = Math.round(activity.timeUnderTension / 60);
    const volume = activity.totalVolume.toLocaleString();
    
    report += `**${activity.name}** (${timeAgo})\n`;
    report += `- workoutActivityId: ${activity.id}\n`;
    report += `- Wall-clock duration (duration): ${wallClockDuration} min | Time under tension (timeUnderTension): ${timeUnderTension} min | Volume: ${volume} lbs | Reps: ${activity.totalReps}\n`;
    report += `- Target: ${activity.targetArea} | Type: ${activity.isGuidedWorkout ? 'Guided' : 'Free Lift'}\n`;
    
    if (activity.isInProgram) {
      report += `- Part of Program\n`;
    }
    
    report += `\n`;
  });

  return {
    content: [{ type: 'text' as const, text: report }],
  };
}

