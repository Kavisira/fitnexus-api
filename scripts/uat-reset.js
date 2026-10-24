// FULL TENANT WIPE. Deleting Organization cascades (ON DELETE CASCADE,
// per schema.prisma) through every single table that descends from
// it — Branch, Employee, Member, User (including the Owner login!),
// RolePermission, LeaveAllocationConfig, OtpCode, literally everything.
//
// After --apply, there is NO login left at all. You must register a
// brand-new Owner/Organization from scratch (signup -> verify OTP)
// to use the app again.
//
// Usage: node scripts/uat-reset.js            -> dry run (counts + full backup only)
//        node scripts/uat-reset.js --apply     -> backup + actually delete every Organization

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const envText = fs.readFileSync(envPath, 'utf8');
const match = envText.match(/^DATABASE_URL="?([^"\n]+)"?/m);
if (!match) throw new Error('DATABASE_URL not found in .env');
process.env.DATABASE_URL = match[1];

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

// Every model in schema.prisma, by its Prisma Client accessor name.
const ALL_MODELS = [
  'organization', 'branch', 'membershipPlan', 'offer', 'member', 'memberMetricEntry',
  'lead', 'leadActivity', 'employee', 'salaryComponent', 'payslip', 'review',
  'reviewResponse', 'appraisal', 'employeeActivity', 'jobTitle', 'user',
  'rolePermission', 'otpCode', 'notification', 'notificationSetup',
  'notificationConfig', 'expense', 'leaveAllocationConfig', 'leaveBalance',
  'leaveRequest', 'biometricDevice', 'biometricEnrollment', 'attendancePunch',
  'attendanceDayRecord', 'holiday', 'alert', 'alertDismissal', 'formTemplate',
  'formField', 'formShareLink', 'formSubmission', 'formAnswer', 'dietPlan',
  'dietPlanItem', 'workoutPlan', 'workoutPlanExercise', 'workoutSet',
  'memberPublicAccess',
];

async function main() {
  const orgs = await prisma.organization.findMany();
  console.log(`Organization rows found: ${orgs.length}`);
  orgs.forEach((o) => console.log(`  - ${o.name} (${o.id}), status=${o.status}`));

  console.log('\nFull backup snapshot (every table):');
  const backup = {};
  for (const model of ALL_MODELS) {
    const rows = await prisma[model].findMany();
    backup[model] = rows;
    console.log(`  ${model}: ${rows.length} row(s)`);
  }

  const backupFile = path.join(__dirname, `uat-full-wipe-backup-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log('\nFull backup written to:', backupFile);

  if (!APPLY) {
    console.log('\nDRY RUN ONLY — nothing deleted. Re-run with --apply to actually delete every Organization (and everything cascading from it).');
    return;
  }

  console.log('\nDeleting all Organization rows (cascades to everything)...');
  const result = await prisma.organization.deleteMany();
  console.log(`Deleted ${result.count} organization(s) and everything cascading from them.`);
  console.log('There is no login left. Register a new Owner/Organization to use the app again.');
}

main()
  .catch((err) => {
    console.error('FAILED:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
