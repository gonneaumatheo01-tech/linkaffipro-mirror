/** Importe les cinq photos de chauffe d'une persona (lancé dans le conteneur : base interne joignable). */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@linkaffipro/db";

const DOSSIER = process.env.FLIRT_DIR ?? "apps/worker/assets/flirt";
const PRENOM = process.env.FLIRT_PERSONA ?? "Léa";
const SLOTS: Array<[number, string]> = [
  [1, "assise sur le lit, soutien-gorge et culotte gris, selfie dans le miroir, téléphone devant le visage, couverture léopard, coussins roses, plantes"],
  [2, "à quatre pattes sur le lit, soutien-gorge et culotte gris, penchée vers l avant, cheveux longs, même chambre"],
  [3, "assise sur le lit, soutien-gorge enlevé, bras croisés sur la poitrine, culotte grise, même chambre"],
  [4, "assise sur le lit, soutien-gorge gris, plus de culotte, une main entre les jambes, même chambre"],
  [5, "debout, complètement nue, de dos et de profil, téléphone dans la main, même chambre"],
];

async function main() {
  const persona = await prisma.persona.findFirst({ where: { name: PRENOM }, select: { id: true, name: true } });
  if (!persona) throw new Error("persona introuvable");
  for (const [slot, description] of SLOTS) {
    const bytes = await readFile(path.join(DOSSIER, `${slot}.jpg`));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const existe = await prisma.mediaAsset.findUnique({ where: { sha256 }, select: { id: true } });
    const asset =
      existe ??
      (await prisma.mediaAsset.create({
        data: { filename: `${persona.name}-chauffe-${slot}.jpg`, mimeType: "image/jpeg", size: bytes.byteLength, sha256, bytes },
        select: { id: true },
      }));
    await prisma.personaFlirtMedia.upsert({
      where: { personaId_slot: { personaId: persona.id, slot } },
      update: { assetId: asset.id, description },
      create: { personaId: persona.id, slot, assetId: asset.id, description },
    });
    console.log("slot", slot, "ok");
  }
  console.log("total", await prisma.personaFlirtMedia.count({ where: { personaId: persona.id } }));
  await prisma.$disconnect();
}
void main();
