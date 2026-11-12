// One-off CLI script: creates (or updates the password of) the single
// PlatformAdmin row the /admin-portal login checks against. Reads the
// email/password from environment variables rather than taking them
// as arguments or hardcoding them here, so the actual credential never
// gets typed into a file or a shell history entry that outlives this
// one run.
//
// Usage (from fit-nexus-api/):
//   PLATFORM_ADMIN_EMAIL="you@example.com" PLATFORM_ADMIN_PASSWORD="yourpassword" npx ts-node scripts/seed-platform-admin.ts
//
// Safe to re-run — upserts on email, so re-running with a new password
// just rotates it for the existing row instead of erroring.
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email || !password) {
    // eslint-disable-next-line no-console
    console.error('Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD in the environment before running this script.');
    process.exit(1);
  }
  if (password.length < 6) {
    // eslint-disable-next-line no-console
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const admin = await prisma.platformAdmin.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });

  // eslint-disable-next-line no-console
  console.log(`Platform admin ready: ${admin.email} (id ${admin.id})`);
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
