import assert from 'node:assert/strict';
import test from 'node:test';
import type { TonalMovement, TonalWorkoutEstimateSet, WorkoutSet } from '@dlwiest/ts-tonal-client';
import {
  exercisesToSets,
  reconstructExercisesFromSets,
} from '../src/utils/workout-conversion.js';

// This file covers PR-B's actual fix: the live data-loss bug where update_workout
// silently wiped spotter/eccentric/chains/flex any time Carlos had enabled one of
// them manually on the Tonal touchscreen, because (a) the write path hardcoded all
// four to false regardless of intent, and (b) reconstructExercisesFromSets never
// read them back from the API response in the first place, so there was nothing to
// preserve even after fixing (a) alone.

function movement(
  id: string,
  name: string,
  overrides: Partial<TonalMovement> = {}
): TonalMovement {
  return {
    id,
    createdAt: '',
    updatedAt: '',
    name,
    shortName: name,
    muscleGroups: [],
    bodyRegion: '',
    bodyRegionDisplay: '',
    baseOfSupport: '',
    pushPull: '',
    family: '',
    familyDisplay: '',
    inFreeLift: false,
    onMachine: true,
    countReps: true,
    isTwoSided: false,
    isBilateral: true,
    isAlternating: false,
    offMachineAccessory: '',
    descriptionHow: '',
    descriptionWhy: '',
    sortOrder: 0,
    imageAssetId: '',
    skillLevel: 0,
    active: true,
    featureGroupIds: null,
    isGeneric: false,
    ...overrides,
  };
}

const CHAINS_CAPABLE = movement('cable-row', 'Cable Row', {
  onMachineInfo: {
    accessory: 'Handles',
    resistanceType: 'Digital',
    spotterDisabled: false,
    eccentricDisabled: false,
    chainsDisabled: false,
    burnoutDisabled: false,
  },
});

const CHAINS_DISABLED = movement('leg-press', 'Leg Press', {
  onMachineInfo: {
    accessory: 'None',
    resistanceType: 'Digital',
    spotterDisabled: true,
    eccentricDisabled: false,
    chainsDisabled: true,
    burnoutDisabled: false,
  },
});

const NO_MACHINE_INFO_REPORTED = movement('plank', 'Plank', { countReps: false });

function baseSet(overrides: Partial<TonalWorkoutEstimateSet> = {}): TonalWorkoutEstimateSet {
  return {
    blockStart: true,
    movementId: 'cable-row',
    prescribedReps: 10,
    repetition: 1,
    repetitionTotal: 1,
    blockNumber: 1,
    burnout: false,
    spotter: false,
    eccentric: false,
    chains: false,
    flex: false,
    warmUp: false,
    weightPercentage: 50,
    setGroup: 1,
    round: 1,
    description: '',
    dropSet: false,
    ...overrides,
  };
}

test('defaults all four mode flags to false when a brand-new set does not specify them', () => {
  const sets = exercisesToSets(
    [{ movementName: 'Cable Row', sets: 1, reps: 10, weight: 50 }],
    [CHAINS_CAPABLE]
  );

  assert.equal(sets.length, 1);
  assert.equal(sets[0].spotter, false);
  assert.equal(sets[0].eccentric, false);
  assert.equal(sets[0].chains, false);
  assert.equal(sets[0].flex, false);
});

test('forwards an explicit true for each of the four mode flags on a capable movement', () => {
  const sets = exercisesToSets(
    [
      {
        movementName: 'Cable Row',
        setDetails: [{ reps: 10, weight: 50, spotter: true, eccentric: true, chains: true, flex: true }],
      },
    ],
    [CHAINS_CAPABLE]
  );

  assert.equal(sets[0].spotter, true);
  assert.equal(sets[0].eccentric, true);
  assert.equal(sets[0].chains, true);
  assert.equal(sets[0].flex, true);
});

// This is the exact bug scenario from feedback_baymax_tonal_weight_unit... no -- from the
// live data-loss finding: reconstruct a workout that has chains enabled (as if freshly
// fetched via get_workout_for_editing), then re-submit it through an "unrelated" edit
// (weight only) without ever mentioning chains, and confirm chains survives.
test('round-trip: chains enabled on read survives an unrelated re-submit that never mentions chains', () => {
  const readSets: WorkoutSet[] = [
    baseSet({ chains: true, weightPercentage: 50 }) as unknown as WorkoutSet,
  ];

  const reconstructed = reconstructExercisesFromSets(readSets, [CHAINS_CAPABLE]);
  assert.equal(reconstructed[0].setDetails?.[0].chains, true, 'chains must be read back from the API response');

  // Simulate an "unrelated" edit: bump the weight, touch nothing about chains. The
  // caller (or an LLM working from get_workout_for_editing's JSON) round-trips the
  // reconstructed setDetails unchanged apart from the field it actually means to edit.
  const edited = reconstructed.map((exercise) => ({
    ...exercise,
    setDetails: exercise.setDetails?.map((set) => ({ ...set, weight: 65 })),
  }));

  const rewritten = exercisesToSets(edited, [CHAINS_CAPABLE]);

  assert.equal(rewritten[0].chains, true, 'chains must survive an edit that never mentioned it');
  assert.equal(rewritten[0].weightPercentage, 65, 'the actual intended edit must still apply');
});

test('round-trip: all four mode flags survive together through reconstruction and re-submission', () => {
  const readSets: WorkoutSet[] = [
    baseSet({ spotter: true, eccentric: true, chains: true, flex: true }) as unknown as WorkoutSet,
  ];

  const reconstructed = reconstructExercisesFromSets(readSets, [CHAINS_CAPABLE]);
  const rewritten = exercisesToSets(reconstructed, [CHAINS_CAPABLE]);

  assert.equal(rewritten[0].spotter, true);
  assert.equal(rewritten[0].eccentric, true);
  assert.equal(rewritten[0].chains, true);
  assert.equal(rewritten[0].flex, true);
});

test('pre-flight guard rejects chains: true on a movement reporting chainsDisabled', () => {
  assert.throws(
    () =>
      exercisesToSets(
        [
          {
            movementName: 'Leg Press',
            setDetails: [{ reps: 10, weight: 50, chains: true }],
          },
        ],
        [CHAINS_DISABLED]
      ),
    /Leg Press.*set 1.*chains.*chainsDisabled is true/s
  );
});

test('pre-flight guard rejects spotter: true on a movement reporting spotterDisabled', () => {
  assert.throws(
    () =>
      exercisesToSets(
        [
          {
            movementName: 'Leg Press',
            setDetails: [{ reps: 10, weight: 50, spotter: true }],
          },
        ],
        [CHAINS_DISABLED]
      ),
    /spotterDisabled is true/
  );
});

test('pre-flight guard allows chains: false on a movement reporting chainsDisabled', () => {
  assert.doesNotThrow(() =>
    exercisesToSets(
      [
        {
          movementName: 'Leg Press',
          setDetails: [{ reps: 10, weight: 50, chains: false }],
        },
      ],
      [CHAINS_DISABLED]
    )
  );
});

test('pre-flight guard does not block a mode request when onMachineInfo is simply not reported', () => {
  // Absence of onMachineInfo means Tonal hasn't reported mode-support data for this
  // movement, not that every mode is unsupported -- must not be treated as a blanket
  // rejection (this was the naive first-pass implementation's bug during development).
  assert.doesNotThrow(() =>
    exercisesToSets(
      [
        {
          movementName: 'Plank',
          setDetails: [{ duration: 30, burnout: true }],
        },
      ],
      [NO_MACHINE_INFO_REPORTED]
    )
  );
});

test('pre-flight guard flags the exact set index among multiple sets', () => {
  assert.throws(
    () =>
      exercisesToSets(
        [
          {
            movementName: 'Leg Press',
            setDetails: [
              { reps: 10, weight: 50 },
              { reps: 10, weight: 50, chains: true },
            ],
          },
        ],
        [CHAINS_DISABLED]
      ),
    /set 2/
  );
});
