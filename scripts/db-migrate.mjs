#!/usr/bin/env node
// =============================================================================
// db-migrate.mjs — apply supabase/migrations/*.sql in filename order.
// -----------------------------------------------------------------------------
// Reads DATABASE_URL (or SUPABASE_DB_URL) from the environment. Uses the `pg`
// library IF it is installed; otherwise prints the equivalent psql / supabase
// CLI commands and exits cleanly. NEVER requires credentials to exist — with no
// DB URL it explains what to set and exits 0 (so CI without a DB doesn't fail).
//
// Usage:  node scripts/db-migrate.mjs   (or: npm run db:migrate)
// =============================================================================

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')

const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || ''

async function listMigrations() {
  const files = await readdir(MIGRATIONS_DIR)
  return files.filter((f) => f.endsWith('.sql')).sort() // 0001, 0002, 0003 ...
}

function printManualInstructions(files) {
  console.log('\nTo apply the migrations manually, run either:\n')
  console.log('  # Supabase CLI (recommended — applies everything in supabase/):')
  console.log('  supabase db push\n')
  console.log('  # or plain psql, in order:')
  for (const f of files) {
    console.log(`  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/${f}`)
  }
  console.log('  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql   # settings, designs, store\n')
}

async function main() {
  const files = await listMigrations()
  if (files.length === 0) {
    console.error('No .sql migrations found in supabase/migrations/.')
    process.exit(1)
  }

  console.log(`Found ${files.length} migration file(s): ${files.join(', ')}`)

  if (!DB_URL) {
    console.log('\nNo DATABASE_URL / SUPABASE_DB_URL is set — nothing was applied.')
    console.log('Set one of them to a Postgres connection string, e.g.:')
    console.log('  export DATABASE_URL="postgresql://postgres:<pw>@<host>:5432/postgres"')
    printManualInstructions(files)
    process.exit(0)
  }

  // Try to load `pg` (not a declared dependency — detect at runtime).
  let pg
  try {
    pg = (await import('pg')).default
  } catch {
    console.log('\nThe `pg` library is not installed, so this script cannot connect directly.')
    console.log('Either `npm i -D pg` and re-run, or apply the SQL manually:')
    printManualInstructions(files)
    process.exit(0)
  }

  const client = new pg.Client({ connectionString: DB_URL })
  try {
    await client.connect()
  } catch (err) {
    console.error(`\nCould not connect to the database: ${err.message}`)
    console.error('Check DATABASE_URL / SUPABASE_DB_URL and that the DB is reachable.')
    process.exit(1)
  }

  try {
    for (const f of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8')
      process.stdout.write(`Applying ${f} ... `)
      // Each file is applied in its own transaction; a failure rolls that file
      // back and aborts the run.
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('COMMIT')
        console.log('ok')
      } catch (err) {
        await client.query('ROLLBACK')
        console.log('FAILED')
        console.error(`\nMigration ${f} failed and was rolled back:\n  ${err.message}`)
        process.exit(1)
      }
    }
    console.log('\nAll migrations applied successfully.')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
