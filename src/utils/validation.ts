import { TonalMCPError } from './error-handler.js';
import { DEFAULTS } from '../constants.js';

interface ValidatedWorkoutExercise {
  movementName: string;
  [key: string]: unknown;
}

export function validateRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TonalMCPError(`${fieldName} is required and must be a non-empty string`, 'VALIDATION_ERROR', 400);
  }

  return value.trim();
}

export function validateOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new TonalMCPError(`${fieldName} must be a string`, 'VALIDATION_ERROR', 400);
  }

  return value;
}

export function validateOptionalPositiveInteger(
  value: unknown,
  fieldName: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TonalMCPError(
      `${fieldName} must be a positive integer`,
      'VALIDATION_ERROR',
      400
    );
  }

  return value;
}

export function validateWorkoutExercises(
  value: unknown
): asserts value is ValidatedWorkoutExercise[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TonalMCPError('At least one exercise is required', 'VALIDATION_ERROR', 400);
  }

  value.forEach((exercise, index) => {
    const movementName =
      exercise &&
      typeof exercise === 'object' &&
      !Array.isArray(exercise) &&
      'movementName' in exercise
        ? exercise.movementName
        : undefined;

    if (typeof movementName !== 'string' || !movementName.trim()) {
      throw new TonalMCPError(
        `Exercise ${index + 1} movementName must be a non-empty string`,
        'VALIDATION_ERROR',
        400
      );
    }
  });
}

export function validateStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  
  if (!Array.isArray(value)) {
    throw new TonalMCPError(`${fieldName} must be an array`, 'VALIDATION_ERROR', 400);
  }
  
  const stringArray = value.filter(item => typeof item === 'string');
  if (stringArray.length !== value.length) {
    throw new TonalMCPError(`All items in ${fieldName} must be strings`, 'VALIDATION_ERROR', 400);
  }
  
  return stringArray;
}

export function validateOptionalLimit(limit: unknown): number {
  if (limit === undefined || limit === null) {
    return DEFAULTS.WORKOUT_LIMIT;
  }
  
  const num = Number(limit);
  if (isNaN(num) || num <= 0) {
    throw new TonalMCPError('Limit must be a positive number', 'VALIDATION_ERROR', 400);
  }
  
  // Cap at reasonable maximum
  return Math.min(num, DEFAULTS.MAX_WORKOUT_LIMIT);
}