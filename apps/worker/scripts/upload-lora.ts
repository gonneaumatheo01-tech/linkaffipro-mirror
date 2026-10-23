/**
 * `pnpm agents:upload-lora <fichier.safetensors> --persona <id>` : envoie un fichier LoRA local sur le stockage de
 * fal.ai et écrit son adresse dans la fiche persona (`Persona.loraUrl`). Clé : `FAL_KEY` dans l'environnement, sinon
 * celle rangée par les agents (Réglages → Agents). Base injoignable (Mac sans accès à la base de production) :
 * l'adresse est affichée, à coller dans la fiche persona. La clé n'est jamais affichée.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { prisma } from "@linkaffipro/db";
import { createFalClient, readSecret } from "@linkaffipro/agents";

const file = process.argv.slice(2).find((a) => !a.startsWith("--") && process.argv[process.argv.indexOf(a) - 1] !== "--persona");
const pi = process.argv.indexOf("--persona");
const personaId = pi >= 0 ? process.argv[pi + 1] : undefined;
if (!file || !personaId) {
  console.error("Usage : pnpm agents:upload-lora <fichier.safetensors> --persona <id>");
  process.exit(1);
}

async function key(): Promise<string | null> {
  if (process.env.FAL_KEY?.trim()) return process.env.FAL_KEY.trim();
  return readSecret(prisma, "providers.fal.apiKey").catch(() => null);
}

try {
  const apiKey = await key();
  if (!apiKey) throw new Error("Aucune clé fal.ai : mets FAL_KEY dans l'environnement ou colle la clé dans Agents → Réglages.");
  const bytes = new Uint8Array(await readFile(file));
  console.log(`Envoi de ${basename(file)} (${Math.round(bytes.byteLength / 1024 / 1024)} Mo) sur le stockage fal.ai…`);
  const url = await createFalClient({ apiKey }).upload({ bytes, mimeType: "application/octet-stream", filename: basename(file) });
  console.log(`Adresse du fichier LoRA : ${url}`);
  try {
    await prisma.persona.update({ where: { id: personaId }, data: { loraUrl: url } });
    console.log("Adresse écrite dans la fiche persona ✅");
  } catch (err) {
    console.log(`Base injoignable ou persona introuvable (${(err as Error).message.slice(0, 120)}) : colle l'adresse ci-dessus dans la fiche persona.`);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
