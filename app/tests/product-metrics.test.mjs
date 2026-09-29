import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_METRIC_DEFINITIONS,
  buildJourneyFunnel,
  metricPercent,
} from '../lib/product-metrics.mjs';

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
