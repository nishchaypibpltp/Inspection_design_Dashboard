// Windows-friendly local start: portable Postgres + dashboard (no Docker needed).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARE = path.resolve(HERE, '..');
// Short paths avoid Windows initdb crashes under the long Downloads path.
const PG_BIN = process.env.PG_BIN || 'C:\\insp-pg-bin\\pgsql\\bin';
const DB_DIR = process.env.PGDATA_DIR || 'C:\\insp-dash-pg';
const SNAPSHOT = path.join(SHARE, 'data', '01-vehicle_inspection.sql');
const DB_PORT = Number(process.env.DB_PORT) || 55432;
const APP_PORT = Number(process.env.PORT) || 8787;

const exe = (name) => path.join(PG_BIN, `${name}.exe`);
const client = (database) =>
  new pg.Client({ host: '127.0.0.1', port: DB_PORT, user: 'postgres', database });

function run(bin, args) {
  return spawnSync(bin, args, { encoding: 'utf8' });
}

async function waitForReady(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const c = client('postgres');
      await c.connect();
      await c.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres on port ${DB_PORT} did not become ready in time`);
}

function isRunning() {
  // pg_ctl status exits 0 when a server owns the data dir, 3 when stopped.
  return run(exe('pg_ctl'), ['-D', DB_DIR, 'status']).status === 0;
}

async function main() {
  if (!existsSync(exe('postgres'))) {
    throw new Error(`Postgres binaries missing at ${PG_BIN}. Set PG_BIN to the pgsql\\bin folder.`);
  }
  if (!existsSync(SNAPSHOT)) {
    throw new Error(`Snapshot missing: ${SNAPSHOT}`);
  }

  await mkdir(DB_DIR, { recursive: true });

  if (!existsSync(path.join(DB_DIR, 'PG_VERSION'))) {
    console.log('  initialising Postgres data directory…');
    // trust auth: loopback-only dev instance, and it sidesteps the pwfile bug on Windows.
    const init = run(exe('initdb'), [
      '-D', DB_DIR,
      '-U', 'postgres',
      '--auth=trust',
      '--encoding=UTF8',
      '--locale=C',
    ]);
    if (init.status !== 0) {
      throw new Error(`initdb failed:\n${init.stderr || init.stdout}`);
    }
  }

  let startedByUs = false;
  if (isRunning()) {
    console.log(`  Postgres already running on port ${DB_PORT}`);
  } else {
    console.log(`  starting Postgres on port ${DB_PORT}…`);
    const start = run(exe('pg_ctl'), [
      '-D', DB_DIR,
      '-o', `-p ${DB_PORT}`,
      '-l', path.join(DB_DIR, 'server.log'),
      '-w',
      'start',
    ]);
    if (start.status !== 0) {
      throw new Error(`pg_ctl start failed:\n${start.stderr || start.stdout}`);
    }
    startedByUs = true;
  }

  await waitForReady();

  const admin = client('postgres');
  await admin.connect();
  const dbs = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'vehicle_inspection'`);
  if (dbs.rowCount === 0) {
    console.log('  creating database vehicle_inspection…');
    await admin.query('CREATE DATABASE vehicle_inspection');
  }
  await admin.end();

  const appDb = client('vehicle_inspection');
  await appDb.connect();

  let rows = 0;
  try {
    const r = await appDb.query('SELECT count(*)::int AS n FROM inspection_sessions');
    rows = r.rows[0].n;
  } catch {
    rows = 0;
  }

  if (rows === 0) {
    console.log('  loading snapshot (first run, ~30s)…');
    await appDb.query(await readFile(SNAPSHOT, 'utf8'));
    const r = await appDb.query('SELECT count(*)::int AS n FROM inspection_sessions');
    rows = r.rows[0].n;
  }
  await appDb.end();
  console.log(`  inspection cases     ${rows}`);

  const databaseUrl = `postgres://postgres@127.0.0.1:${DB_PORT}/vehicle_inspection`;
  console.log(`  starting dashboard on http://127.0.0.1:${APP_PORT}`);

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: HERE,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(APP_PORT), HOST: '127.0.0.1' },
    stdio: 'inherit',
  });

  // Leave Postgres up if it was already serving when we arrived.
  const stopPg = () => {
    if (!startedByUs) return;
    run(exe('pg_ctl'), ['-D', DB_DIR, '-m', 'fast', 'stop']);
  };

  const shutdown = () => {
    child.kill('SIGTERM');
    stopPg();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  child.on('exit', (code) => {
    stopPg();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('\n  Failed to start:', err.message || err);
  process.exit(1);
});
