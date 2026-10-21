import { prisma } from "@linkaffipro/db";
const CH = "cmv0tqkcf000gf4s0neae75aj";
const J = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
async function tick() {
  const m = await prisma.membership.findFirst({ where: { channelId: CH }, orderBy: { requestedAt: "desc" } });
  const d = await prisma.accountDm.findFirst({ orderBy: { createdAt: "desc" } });
  console.log("\n=== " + new Date().toLocaleTimeString("fr-FR") + " ===");
  console.log("MEMBERSHIP:", J(m ? { id: m.id, status: m.status, requestedAt: m.requestedAt, approveAt: m.approveAt, attempts: m.attempts, lastError: m.lastError } : null));
  console.log("ACCOUNT DM :", J(d ? { id: d.id, text: d.text, dueAt: d.dueAt, status: d.status, sentAt: d.sentAt, lastError: d.lastError } : null));
}
tick();
setInterval(tick, 5000);
