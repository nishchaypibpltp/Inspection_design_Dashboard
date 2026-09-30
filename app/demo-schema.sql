-- Stand-in schema for running the dashboard without the pilot snapshot
-- (../data/01-vehicle_inspection.sql). Tables, columns, column order and types follow
-- the real database's schema map. Load it, then run `npm run seed:demo`
-- to turn the placeholder sessions below into full demo cases.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE inspection_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id          text,
  customer_id        text,
  vehicle_reg        text,
  insurer_id         text,
  status             text NOT NULL,
  checklist_state    jsonb NOT NULL DEFAULT '{}',
  permissions_state  jsonb NOT NULL DEFAULT '{}',
  device_metadata    jsonb NOT NULL DEFAULT '{}',
  model_versions     jsonb NOT NULL DEFAULT '{}',
  language           text,
  deadline_at        timestamptz,
  grace_deadline_at  timestamptz,
  location_lat       double precision,
  location_lng       double precision,
  location_locked_at timestamptz,
  last_active_at     timestamptz,
  is_portrait_mode   boolean NOT NULL DEFAULT false,
  microphone_granted boolean NOT NULL DEFAULT false,
  orion_instance_id  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  client_request_id  text UNIQUE
);

CREATE TABLE inspection_stages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  sequence_number    int NOT NULL,
  stage_type         text NOT NULL,
  phase              text,
  capture_mode       text,
  is_required        boolean NOT NULL DEFAULT false,
  is_conditional     boolean NOT NULL DEFAULT false,
  condition_key      text,
  status             text NOT NULL DEFAULT 'PENDING',
  retry_count        int NOT NULL DEFAULT 0,
  video_timestamp_ms bigint,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, stage_type)
);

CREATE TABLE inspection_videos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL UNIQUE REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  storage_key      text,
  upload_id        text,
  mime_type        text,
  upload_status    text,
  duration_sec     int,
  file_size_bytes  bigint,
  stage_timestamps jsonb,
  motion_score     double precision,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE captured_assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  stage_id          uuid REFERENCES inspection_stages(id) ON DELETE CASCADE,
  stage_type        text,
  asset_type        text,
  capture_method    text,
  storage_key       text,
  checksum_sha256   text,
  mime_type         text,
  file_size_bytes   bigint,
  width_px          int,
  height_px         int,
  is_portrait       boolean,
  overlay_applied   boolean,
  metadata          jsonb,
  qc_result         jsonb,
  qc_result_version int,
  status            text,
  captured_at       timestamptz,
  uploaded_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inspection_findings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  asset_id     uuid REFERENCES captured_assets(id),
  stage_type   text,
  finding_type text NOT NULL,
  severity     text NOT NULL,
  source       text,
  confidence   double precision,
  message      text,
  status       text NOT NULL DEFAULT 'OPEN',
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);

CREATE TABLE inspection_processing_results (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  asset_id          uuid REFERENCES captured_assets(id),
  stage_type        text,
  processor_name    text NOT NULL,
  processor_version text,
  confidence        double precision,
  output_json       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inspection_audit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  customer_id text,
  event_type  text NOT NULL,
  from_state  text,
  to_state    text,
  actor       text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  ip_address  text,
  hmac_sig    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inspection_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL UNIQUE REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  client_submit_id text UNIQUE,
  manifest_key     text,
  status           text,
  submitted_at     timestamptz,
  packaged_at      timestamptz,
  vendor_case_id   bigint,
  download_key     text,
  vendor_status    text,
  vendor_remarks   text,
  dispatched_at    timestamptz
);

CREATE TABLE extraction_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL UNIQUE REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  status          text NOT NULL,
  attempt_count   int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 3,
  next_attempt_at timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  error_reason    text,
  worker_id       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE insurer_stage_configs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id     text NOT NULL,
  stage_type     text NOT NULL,
  display_order  int NOT NULL,
  is_mandatory   boolean NOT NULL DEFAULT false,
  condition      text,
  capture_source text NOT NULL DEFAULT 'EXTRACTED',
  min_blur_score double precision,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (insurer_id, stage_type)
);

CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL,
  platform    text NOT NULL,
  endpoint    text NOT NULL,
  keys_p256dh text,
  keys_auth   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz
);

-- Workflow engine. Sessions link here by value: inspection_sessions.orion_instance_id = workflow_instances.id.
CREATE SCHEMA orion_fsm;

CREATE TABLE orion_fsm.workflow_definitions (
  id             text NOT NULL,
  version        text NOT NULL,
  schema_version text,
  name           text,
  description    text,
  status         text,
  initial_state  text,
  definition     jsonb,
  tenant_id      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  superseded_by  text,
  PRIMARY KEY (id, version)
);

CREATE TABLE orion_fsm.workflow_instances (
  id                 text PRIMARY KEY,
  workflow_id        text NOT NULL,
  workflow_version   text NOT NULL,
  tenant_id          text,
  current_state      text,
  status             text,
  context            jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  parent_instance_id text,
  sw_state_key       text,
  runtime_generation bigint,
  FOREIGN KEY (workflow_id, workflow_version) REFERENCES orion_fsm.workflow_definitions (id, version)
);

CREATE TABLE orion_fsm.transition_logs (
  id               text PRIMARY KEY,
  instance_id      text NOT NULL REFERENCES orion_fsm.workflow_instances(id),
  workflow_id      text,
  workflow_version text,
  tenant_id        text,
  from_state       text,
  to_state         text,
  trigger          text,
  transition_type  text,
  guard_expr       text,
  entry_ts         timestamptz,
  exit_ts          timestamptz,
  duration_ms      bigint,
  correlation_id   text,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  actor_type       text,
  actor_id         text
);

CREATE TABLE orion_fsm.step_results (
  id          text PRIMARY KEY,
  instance_id text NOT NULL REFERENCES orion_fsm.workflow_instances(id),
  state       text,
  step_id     text,
  phase_index int,
  action_ref  text,
  status      text,
  result      jsonb,
  attempt     int,
  duration_ms bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  result_pii  bytea
);

CREATE TABLE orion_fsm.outbox_jobs (
  id              text PRIMARY KEY,
  instance_id     text NOT NULL REFERENCES orion_fsm.workflow_instances(id),
  tenant_id       text,
  step_id         text,
  action_ref      text,
  state           text,
  phase_index     int,
  payload         jsonb,
  status          text,
  claimed_by      text,
  attempt         int,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  completed_at    timestamptz,
  run_after       timestamptz,
  max_attempts    int,
  backoff_policy  text,
  backoff_base_ms bigint,
  pipeline_kind   text,
  target_state    text,
  sync_eligible   boolean,
  claim_source    text,
  generation      bigint
);

CREATE TABLE orion_fsm.execution_cursors (
  instance_id  text NOT NULL REFERENCES orion_fsm.workflow_instances(id),
  state        text,
  phase_index  int,
  status       text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  target_state text
);

CREATE TABLE orion_fsm.instance_relationship_types (
  code        text PRIMARY KEY,
  description text
);

CREATE INDEX ON inspection_sessions (created_at);
CREATE INDEX ON inspection_stages (session_id);
CREATE INDEX ON captured_assets (session_id);
CREATE INDEX ON inspection_findings (session_id);
CREATE INDEX ON inspection_processing_results (session_id);
CREATE INDEX ON inspection_audit_events (session_id);

-- Placeholder cases for seed-demo.mjs to rebuild (same count as the pilot snapshot).
INSERT INTO inspection_sessions (status)
SELECT 'SETUP' FROM generate_series(1, 276);
