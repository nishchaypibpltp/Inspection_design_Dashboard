import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_METRIC_DEFINITIONS,
  buildJourneyFunnel,
  buildJourneySteps,
  buildPlatformBreakdown,
  metricPercent,
  platformOf,
} from '../lib/product-metrics.mjs';

test('journey steps chain conversion through every stage and flag the biggest drop', () => {
  const journey = {
    created: 100, permission_granted: 90, started: 80, recording_complete: 50,
    completed: 45, clean_completed: 30, submitted: 20, approved: 15,
  };
  const steps = buildJourneySteps(journey, [
    { stage: 'RC_DOCUMENT', reached: 78, eligible: 80, conditional: false },
    { stage: 'CHASSIS_NUMBER', reached: 60, eligible: 80, conditional: false },
    { stage: 'GAS_KIT_NUMBER', reached: 20, eligible: 25, conditional: true, condition_key: 'BI_FUEL_ONLY' },
  ]);
  const by = Object.fromEntries(steps.map(s => [s.key, s]));

  assert.deepEqual(steps.map(s => s.phase), [
    'Setup', 'Setup', 'Recording', 'Recording', 'Recording', 'Recording', 'Recording',
    'Processing', 'Delivery', 'Delivery',
  ]);
  assert.equal(by['stage:CHASSIS_NUMBER'].pct_from_previous, 76.9);
  assert.equal(by['stage:CHASSIS_NUMBER'].drop_users, 18);
  assert.equal(by['stage:CHASSIS_NUMBER'].pct_of_created, 60);
  // The conditional stage is measured against eligible sessions and skipped in the chain.
  assert.equal(by['stage:GAS_KIT_NUMBER'].pct_of_eligible, 80);
  assert.equal(by['stage:GAS_KIT_NUMBER'].pct_from_previous, undefined);
  assert.equal(by.recording_complete.drop_users, 10);
  assert.equal(by.completed.clean_pct, 66.7);
  assert.equal(steps.filter(s => s.biggest_drop).map(s => s.key).join(), 'stage:CHASSIS_NUMBER');
});

test('platform breakdown classifies user agents and reports rates per platform', () => {
  assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)'), 'iOS');
  assert.equal(platformOf('Mozilla/5.0 (Linux; Android 14; SM-A546E)'), 'Android');
  assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0)'), 'Other');
  assert.equal(platformOf(null), 'Unknown');

  const rows = buildPlatformBreakdown([
    { ua: 'iPhone OS 18_7', sessions: 6, permission_granted: 4, started: 3, completed: 2, clean_completed: 1 },
    { ua: 'iPhone OS 18_5', sessions: 4, permission_granted: 4, started: 3, completed: 2, clean_completed: 1 },
    { ua: 'Android 15', sessions: 2, permission_granted: 1, started: 1, completed: 0, clean_completed: 0 },
  ]);
  assert.deepEqual(rows.map(r => [r.platform, r.sessions, r.permission_pct, r.completed_pct]), [
    ['iOS', 10, 80, 40],
    ['Android', 2, 50, 0],
  ]);
});

test('metricPercent reports one decimal place and handles empty cohorts', () => {
  assert.equal(metricPercent(60, 121), 49.6);
  assert.equal(metricPercent(139, 276), 50.4);
  assert.equal(metricPercent(0, 60), 0);
  assert.equal(metricPercent(0, 0), null);
});

test('journey funnel reports local conversion and cumulative reach separately', () => {
  const funnel = buildJourneyFunnel([
    ['created', 'Created', 100],
    ['started', 'Started', 80],
    ['completed', 'Completed', 60],
  ]);

  assert.deepEqual(funnel, [
    {
      key: 'created',
      label: 'Created',
      users: 100,
      conversion_from_previous_pct: 100,
      cumulative_reach_pct: 100,
    },
    {
      key: 'started',
      label: 'Started',
      users: 80,
      conversion_from_previous_pct: 80,
      cumulative_reach_pct: 80,
    },
    {
      key: 'completed',
      label: 'Completed',
      users: 60,
      conversion_from_previous_pct: 75,
      cumulative_reach_pct: 60,
    },
  ]);
});

test('metric definitions keep conversion and exit formulas distinct', () => {
  assert.match(PRODUCT_METRIC_DEFINITIONS.stage_conversion.formula, /stage n−1/);
  assert.match(PRODUCT_METRIC_DEFINITIONS.stage_exit.formula, /not completing/);
  assert.doesNotMatch(
    Object.keys(PRODUCT_METRIC_DEFINITIONS).join(' '),
    /guidance/i,
  );
});
