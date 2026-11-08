const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, subscriptionStatus: true, subscriptionTier: true, trialEndsAt: true, currentPeriodEnd: true },
  });
  console.log(JSON.stringify(orgs, null, 2));
  await prisma.$disconnect();
})();
