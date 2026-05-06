// One-off: apply the JobType enum + Job.jobType column to prod Neon.
// Idempotent via DO-block + IF NOT EXISTS so re-running is a no-op.
// Delete this script after the deploy lands.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Prisma's $executeRawUnsafe runs one statement at a time (prepared-statement
// mode). Split into two calls.

const CREATE_ENUM_SQL = `
DO $$ BEGIN
  CREATE TYPE "JobType" AS ENUM (
    'TRIM_1','TRIM_1_INSTALL','TRIM_2','TRIM_2_INSTALL',
    'DOORS','DOOR_INSTALL','HARDWARE','HARDWARE_INSTALL',
    'FINAL_FRONT','FINAL_FRONT_INSTALL',
    'QC_WALK','PUNCH','WARRANTY','CUSTOM'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`

const ADD_COLUMN_SQL = `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "jobType" "JobType"`

const VERIFY_SQL = `
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'Job' AND column_name = 'jobType';
`

async function main() {
  console.log('Applying JobType migration...')
  console.log('  [1/2] CREATE TYPE JobType...')
  await prisma.$executeRawUnsafe(CREATE_ENUM_SQL)
  console.log('  [2/2] ALTER TABLE Job ADD COLUMN jobType...')
  await prisma.$executeRawUnsafe(ADD_COLUMN_SQL)
  console.log('Applied.')

  const rows = await prisma.$queryRawUnsafe(VERIFY_SQL)
  console.log('Verify:', JSON.stringify(rows, null, 2))
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Column Job.jobType not found after migration!')
  }
  console.log('OK — Job.jobType exists.')
}

main()
  .catch((e) => {
    console.error('Migration failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
