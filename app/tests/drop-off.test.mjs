import test from 'node:test';
import assert from 'node:assert/strict';
import { dropOff } from '../lib/drop-off.mjs';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const STALE = '2026-09-25T10:00:00Z';
const FRESH = '2026-09-28T11:00:00Z';
const ALL_PERMS = { camera_granted: true, microphone_granted: true, location_granted: true };
const FLOW = ['RC_DOCUMENT', 'CHASSIS_NUMBER', 'DICKY_BOOT', 'BI_FUEL_TANK', 'GAS_KIT_NUMBER']
  .map(stage_type => ({ stage_type, condition_key: /BI_FUEL|GAS_KIT/.test(stage_type) ? 'BI_FUEL_ONLY' : null }));
const recording = extra => ({
  status: 'RECORDING', updated_at: STALE, permissions_state: ALL_PERMS, stages: FLOW,
  recording_started: true, recording_complete: false, upload_status: 'IN_PROGRESS', ...extra,
});

test('stopped mid-recording → the stage after the last mark', () => {
  assert.deepEqual(dropOff(recording({ marks: ['RC_DOCUMENT'] }), NOW),
    { kind: 'stage', how: 'inactive', stage: 'CHASSIS_NUMBER' });
});

test('recent activity is reported as active, not dropped', () => {
  assert.equal(dropOff(recording({ marks: ['RC_DOCUMENT'], updated_at: FRESH }), NOW).how, 'active');
});

test('conditional stages count only when the checklist confirms them', () => {
  const marks = ['RC_DOCUMENT', 'CHASSIS_NUMBER', 'DICKY_BOOT'];
  assert.equal(dropOff(recording({ marks }), NOW).kind, 'after_last_stage');
  assert.equal(dropOff(recording({ marks, checklist_state: { is_bi_fuel: true } }), NOW).stage, 'BI_FUEL_TANK');
});

test('retired stages in old marks are ignored', () => {
  assert.equal(dropOff(recording({ marks: ['RC_DOCUMENT', 'ODOMETER'] }), NOW).stage, 'CHASSIS_NUMBER');
  assert.equal(dropOff(recording({ marks: ['ODOMETER'] }), NOW).kind, 'stage_unknown');
});

test('before recording: permissions screen vs start screen', () => {
  const base = { status: 'SETUP', updated_at: STALE, recording_started: false };
  assert.deepEqual(dropOff({ ...base, permissions_state: { camera_granted: true } }, NOW),
    { kind: 'permissions', how: 'inactive', missing: ['microphone', 'location'] });
  assert.equal(dropOff({ ...base, status: 'READY', permissions_state: ALL_PERMS }, NOW).kind, 'before_recording');
});

test('after recording: upload, processing, and terminal outcomes', () => {
  assert.equal(dropOff(recording({ recording_complete: true }), NOW).kind, 'upload');
  assert.equal(dropOff(recording({ recording_complete: true, upload_status: 'COMPLETE' }), NOW).kind, 'processing');
  assert.equal(dropOff(recording({ upload_status: 'FAILED' }), NOW).kind, 'upload_failed');
  assert.deepEqual(dropOff({ status: 'SUBMITTED' }, NOW), { kind: 'completed' });
  assert.deepEqual(dropOff({ status: 'EXTRACTION_FAILED' }, NOW), { kind: 'extraction_failed' });
});

test('aborted and expired sessions keep how they ended', () => {
  assert.equal(dropOff(recording({ status: 'ABORTED', marks: ['RC_DOCUMENT'] }), NOW).how, 'cancelled');
  assert.equal(dropOff(recording({ status: 'EXPIRED', marks: ['RC_DOCUMENT'] }), NOW).how, 'expired');
});
