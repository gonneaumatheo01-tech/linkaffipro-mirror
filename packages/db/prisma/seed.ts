// Seed : crée le premier ADMIN à partir des variables ADMIN_EMAIL, ADMIN_NAME, ADMIN_INITIAL_PASSWORD
// s'il n'existe aucun utilisateur avec cet e-mail. Idempotent.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Phase 8 : plus de catégories par défaut (le client crée les siennes dans Réglages → Catégories).

async function main() {
  // Phase 8 : plus aucune catégorie créée d'office, c'est le client qui crée les siennes.
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
