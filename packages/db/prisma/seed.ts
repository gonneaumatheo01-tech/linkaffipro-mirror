// Seed : crée le premier ADMIN à partir des variables ADMIN_EMAIL, ADMIN_NAME, ADMIN_INITIAL_PASSWORD
// s'il n'existe aucun utilisateur avec cet e-mail. Idempotent.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_CATEGORIES: Array<{ name: string; slug: string; color: string }> = [
  { name: "Bonus", slug: "bonus", color: "#16a34a" },
  { name: "Preuve de gains", slug: "preuve-de-gains", color: "#ca8a04" },
  { name: "Teasing", slug: "teasing", color: "#9333ea" },
  { name: "Rappel", slug: "rappel", color: "#2563eb" },
  { name: "Information", slug: "information", color: "#64748b" },
  { name: "Événement", slug: "evenement", color: "#dc2626" },
  { name: "Sondage", slug: "sondage", color: "#0891b2" },
];

/** Catégories de messages par défaut (idempotent : crée seulement celles qui manquent). */
async function seedCategories() {
  let created = 0;
  for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
    const existing = await prisma.messageCategory.findUnique({ where: { slug: c.slug } });
    if (existing) continue;
    await prisma.messageCategory.create({ data: { ...c, sortOrder: i } });
    created++;
  }
  console.log(`[seed] catégories de messages : ${created} créée(s).`);
}

async function main() {
  await seedCategories();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || "Admin";
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password) {
    console.log("[seed] ADMIN_EMAIL ou ADMIN_INITIAL_PASSWORD absent : aucun admin créé.");
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[seed] l'utilisateur ${email} existe déjà, rien à faire.`);
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({ data: { email, name, passwordHash, role: "ADMIN" } });
  await prisma.auditLog.create({ data: { action: "user.seed_admin", entityType: "User", metadata: { email } } });
  console.log(`[seed] administrateur ${email} créé.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
