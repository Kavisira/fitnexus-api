// ONE-OFF MIGRATION — run once after the normalizePhone change ships,
// then delete this file. Normalizes every existing User.phone (and
// Organization.phone, for consistency) to digits-only so the new
// normalized lookups in auth.service.ts actually match pre-existing
// accounts. Safe to re-run (idempotent) — already-normalized values
// are skipped.
import { PrismaClient } from '@prisma/client';

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

const prisma = new PrismaClient();

(async () => {
  const users = await prisma.user.findMany({ select: { id: true, phone: true } });
  let updated = 0;
  for (const u of users) {
    const normalized = normalizePhone(u.phone);
    if (normalized !== u.phone) {
      const clash = await prisma.user.findUnique({ where: { phone: normalized } });
      if (clash && clash.id !== u.id) {
        console.error(`SKIPPED user ${u.id}: normalizing "${u.phone}" -> "${normalized}" collides with user ${clash.id}`);
        continue;
      }
      await prisma.user.update({ where: { id: u.id }, data: { phone: normalized } });
      console.log(`user ${u.id}: "${u.phone}" -> "${normalized}"`);
      updated++;
    }
  }

  const orgs = await prisma.organization.findMany({ select: { id: true, phone: true } });
  let orgUpdated = 0;
  for (const o of orgs) {
    const normalized = normalizePhone(o.phone);
    if (normalized !== o.phone) {
      await prisma.organization.update({ where: { id: o.id }, data: { phone: normalized } });
      orgUpdated++;
    }
  }

  console.log(`Done. ${updated} user(s) and ${orgUpdated} organization(s) normalized.`);
  await prisma.$disconnect();
})();
