import { prisma } from '@linkaffipro/db';

async function main() {
  const p = await prisma.persona.update({
    where: { id: 'c2ygtw2hit56bzwgkwqb8hmp2' },
    data: { minExchangesBeforeOffer: 8, requireInterest: false, maxOfferSends: 2 },
  });
  console.log('minExchangesBeforeOffer = ' + p.minExchangesBeforeOffer);
  console.log('requireInterest = ' + p.requireInterest);
  console.log('maxOfferSends = ' + p.maxOfferSends);
  await prisma.$disconnect();
  process.exit(0);
}

main();
