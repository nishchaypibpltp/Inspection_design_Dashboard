// Read-only Postgres access to the vehicle-inspection POC database.
// The dashboard NEVER writes — every statement here is a SELECT.
import pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@127.0.0.1:5432/vehicle_inspection?sslmode=disable';

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  // Safety net: a read-only dashboard has no business holding long locks.
  statement_timeout: 15_000,
});

export async function q(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

// IST calendar-day expression reused across queries.
export const IST_DAY = `(created_at AT TIME ZONE 'Asia/Kolkata')::date`;
