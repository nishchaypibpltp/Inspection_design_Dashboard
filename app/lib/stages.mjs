// Stages dropped from the capture flow. Historical rows still exist in the
// database, so every dashboard read filters them out.
export const RETIRED_STAGES = Object.freeze([
  'FRONT_LEFT_DIAGONAL',
  'FRONT_RIGHT_DIAGONAL',
  'REAR_LEFT_DIAGONAL',
  'REAR_RIGHT_DIAGONAL',
  'ODOMETER',
  'PREVIOUS_DAMAGE',
  'VRN',
]);

// Stages added to the capture flow that older sessions have no row for.
// The case view lists them so every session shows the current stage set.
export const ADDED_STAGES = Object.freeze([
  'UNDER_FRONT',
  'GAS_KIT_NUMBER',
]);

// Stages listed in the AI/QC rejection chart even before any photo exists for them.
export const QC_CHART_STAGES = Object.freeze([
  'GAS_KIT_NUMBER',
]);

const RETIRED_SQL_LIST = RETIRED_STAGES.map(s => `'${s}'`).join(',');

// SQL predicate that keeps rows whose stage is still active (or has no stage).
export const activeStage = col => `(${col} IS NULL OR ${col} NOT IN (${RETIRED_SQL_LIST}))`;

export const isActiveStage = stage => !RETIRED_STAGES.includes(stage);
