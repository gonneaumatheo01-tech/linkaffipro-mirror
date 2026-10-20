import { prisma } from '@linkaffipro/db';

async function main() {
  const p = await prisma.persona.update({
    where: { id: 'c2ygtw2hit56bzwgkwqb8hmp2' },
    data: { name: 'Léa' },
  });
  console.log('persona = ' + p.name);
  await prisma.$disconnect();
  process.exit(0);
}

main();
