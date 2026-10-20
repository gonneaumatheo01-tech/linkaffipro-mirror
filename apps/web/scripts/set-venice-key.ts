import { prisma, type Prisma } from "@linkaffipro/db";
import { encrypt, decrypt } from "@linkaffipro/core";

async function main() {
  const cle = (process.env.VENICE_KEY ?? "").trim();
  if (!cle) {
    console.log("!! aucune cle : relance avec la ligne export VENICE_KEY='...'");
    process.exit(1);
  }
  console.log("cle fournie : " + cle.slice(0, 14) + "... (" + cle.length + " caracteres)");

  const row = await prisma.setting.findUnique({ where: { key: "assistant.venice" } });
  const valeur = (row && row.value ? row.value : {}) as Record<string, unknown>;
  await prisma.setting.update({
    where: { key: "assistant.venice" },
    data: {
      value: Object.assign({}, valeur, { apiKeyEncrypted: encrypt(cle), lastError: null }) as Prisma.InputJsonObject,
    },
  });

  const relu = await prisma.setting.findUnique({ where: { key: "assistant.venice" } });
  const clair = decrypt((relu?.value as Record<string, string>).apiKeyEncrypted ?? "");
  console.log("=> cle enregistree et relue : " + clair.slice(0, 14) + "... (" + clair.length + " caracteres)");

  try {
    const res = await fetch("https://api.venice.ai/api/v1/api_keys/rate_limits", {
      headers: { Authorization: "Bearer " + cle, Accept: "application/json" },
    });
    console.log("=> verification Venice : HTTP " + res.status + (res.status === 200 ? " (cle acceptee)" : ""));
  } catch (err) {
    console.log("=> verification Venice impossible : " + (err instanceof Error ? err.message : String(err)));
  }

  await prisma.$disconnect();
}

void main();
