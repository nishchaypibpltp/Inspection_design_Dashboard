// Session status → explorer bucket. One place, used by SQL builders and the UI contract.
// Raw statuses observed live: SETUP, READY, RECORDING, REVIEW_READY, ABORTED,
// EXTRACTION_FAILED. Future (schema supports, zero rows today): SUBMITTED,
// SUBMISSION_FAILED, EXPIRED.
export const BUCKET_CASE_SQL = `
  CASE
    WHEN s.status IN ('SETUP','READY')                        THEN 'not_started'
    WHEN s.status = 'RECORDING'                               THEN 'in_progress'
    WHEN s.status = 'REVIEW_READY'                            THEN 'review_ready'
    WHEN s.status = 'SUBMITTED'                               THEN 'submitted'
    WHEN s.status IN ('EXTRACTION_FAILED','SUBMISSION_FAILED') THEN 'failed'
    WHEN s.status = 'ABORTED'                                 THEN 'aborted'
    WHEN s.status = 'EXPIRED'                                 THEN 'expired'
    ELSE 'other'
  END`;

export const BUCKETS = [
  'not_started', 'in_progress', 'review_ready', 'submitted',
  'failed', 'aborted', 'expired', 'rejected', 'other',
];

// 'rejected' is vendor_remarks = 'REJECTED' on the submission row — a bucket
// layered on top of 'submitted'. Zero rows today (no submissions yet); the
// explorer still exposes the filter so the column is ready the day Mode-B goes live.
