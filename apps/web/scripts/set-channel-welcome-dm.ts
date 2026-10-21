/**
 * Regle le DM de bienvenue par compte reel d'un canal.
 * Sans argument : liste canaux, comptes et 10 derniers DM.
 * Avec arguments : node ... scripts/set-channel-welcome-dm.ts <channelId> <accountId|-> <delaiMinutes> [texte]
 *   "-" en compte = desactive. Texte absent = texte par defaut.
 */
import { prisma } from "@linkaffipro/db";

async function main() {
  const [canal, compte, delai, ...texte] = process.argv.slice(2);

  if (!canal) {
    for (const c of await prisma.channel.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, welcomeDmEnabled: true, welcomeDmDelayMinutes: true },
    }))
      console.log(
        `canal  ${c.id}  ${c.title}  ${c.welcomeDmEnabled ? `ACTIF (${c.welcomeDmDelayMinutes} min)` : "inactif"}`,
      );
    for (const a of await prisma.telegramUserAccount.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, status: true },
    }))
      console.log(`compte ${a.id}  ${a.label}  ${a.status}`);
    for (const d of await prisma.accountDm.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { createdAt: true, status: true, dueAt: true, sentAt: true, text: true, lastError: true },
    }))
      console.log(
        `dm     ${d.createdAt.toISOString()}  ${d.status}  du=${d.dueAt.toISOString()}  ${d.text.slice(0, 40)}  ${d.lastError ?? ""}`,
      );
    return;
  }

  const actif = Boolean(compte && compte !== "-");
  const maj = await prisma.channel.update({
    where: { id: canal },
    data: {
      welcomeDmEnabled: actif,
      welcomeDmAccountId: actif ? compte : null,
      welcomeDmDelayMinutes: delai ? Number(delai) : 30,
      welcomeDmText: texte.length > 0 ? texte.join(" ") : null,
    },
    select: { title: true, welcomeDmEnabled: true, welcomeDmAccountId: true, welcomeDmDelayMinutes: true },
  });
  console.log("canal mis a jour :", maj);
}

main().then(() => process.exit(0));
