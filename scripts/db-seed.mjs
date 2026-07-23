#!/usr/bin/env node
// =============================================================================
// db-seed.mjs — apply supabase/seed.sql (demo data).
// -----------------------------------------------------------------------------
// Same contract as db-migrate.mjs: reads DATABASE_URL / SUPABASE_DB_URL, uses
// `pg` if available else prints the psql command, and never requires
// credentials to exist. The seed is idempotent (ON CONFLICT DO NOTHING), so it
// is safe to run more than once.
//
// Run AFTER migrations.  Usage:  node scripts/db-seed.mjs  (or: npm run db:seed)
// =============================================================================

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SEED_FILE = resolve(__dirname, '..', 'supabase', 'seed.sql')

const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || ''

function printManualInstructions() {
  console.log('\nTo seed manually:')
  console.log('  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql\n')
  console.log('The seed is idempotent (ON CONFLICT DO NOTHING) — safe to re-run.')
}

async function main() {
  let sql
  try {
    sql = await readFile(SEED_FILE, 'utf8')
  } catch {
    console.error(`Seed file not found at ${SEED_FILE}.`)
    process.exit(1)
  }

  if (!DB_URL) {
    console.log('No DATABASE_URL / SUPABASE_DB_URL is set — nothing was applied.')
    console.log('Set one, e.g.:')
    console.log('  export DATABASE_URL="postgresql://postgres:<pw>@<host>:5432/postgres"')
    printManualInstructions()
    process.exit(0)
  }

  let pg
  try {
    pg = (await import('pg')).default
  } catch {
    console.log('The `pg` library is not installed, so this script cannot connect directly.')
    console.log('Either `npm i -D pg` and re-run, or seed manually:')
    printManualInstructions()
    process.exit(0)
  }

  const client = new pg.Client({ connectionString: DB_URL })
  try {
    await client.connect()
  } catch (err) {
    console.error(`Could not connect to the database: ${err.message}`)
    process.exit(1)
  }

  try {
    process.stdout.write('Seeding demo data ... ')
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('COMMIT')
      console.log('ok')
      console.log('Demo data seeded successfully.')
    } catch (err) {
      await client.query('ROLLBACK')
      console.log('FAILED')
      console.error(`\nSeeding failed and was rolled back:\n  ${err.message}`)
      console.error('(Did you run the migrations first? `npm run db:migrate`)')
      process.exit(1)
    }
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
