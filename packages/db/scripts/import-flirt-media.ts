// Importe les cinq photos de chauffe d'une persona : 1 ensemble, 2 à quatre pattes, 3 torse nu, 4 sans bas, 5 nue de dos.
// Usage, depuis packages/db : node --env-file-if-exists=../../.env.local --import tsx scripts/import-flirt-media.ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dossier = process.argv[2] ?? path.join(process.env.HOME ?? "", "Desktop/photos-lea-chauffe");
const prenom = process.argv[3] ?? "Léa";

const SLOTS: Array<[number, string]> = [
  [1, "assise sur le lit, soutien-gorge et culotte gris, selfie dans le miroir, téléphone devant le visage, couverture léopard, coussins roses, plantes"],
  [2, "à quatre pattes sur le lit, soutien-gorge et culotte gris, penchée vers l avant, cheveux longs, même chambre"],
  [3, "assise sur le lit, soutien-gorge enlevé, bras croisés sur la poitrine, culotte grise, même chambre"],
  [4, "assise sur le lit, soutien-gorge gris, plus de culotte, une main entre les jambes, même chambre"],
  [5, "debout, complètement nue, de dos et de profil, téléphone dans la main, même chambre"],
];

const persona = await prisma.persona.findFirst({ where: { name: prenom }, select: { id: true, name: true } });
if (!persona) throw new Error(`persona introuvable : ${prenom}`);

for (const [slot, description] of SLOTS) {
  const bytes = await readFile(path.join(dossier, `${slot}.jpg`));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existant = await prisma.mediaAsset.findUnique({ where: { sha256 }, select: { id: true } });
  const asset =
    existant ??
    (await prisma.mediaAsset.create({
      data: {
        filename: `${persona.name}-chauffe-${slot}.jpg`,
        mimeType: "image/jpeg",
        size: bytes.byteLength,
        sha256,
        bytes,
      },
      select: { id: true },
    }));
  await prisma.personaFlirtMedia.upsert({
    where: { personaId_slot: { personaId: persona.id, slot } },
    update: { assetId: asset.id, description },
    create: { personaId: persona.id, slot, assetId: asset.id, description },
  });
  console.log(`slot ${slot} : ${bytes.byteLength} octets, asset ${asset.id}`);
}

const total = await prisma.personaFlirtMedia.count({ where: { personaId: persona.id } });
console.log(`termine : ${total} photos de chauffe pour ${persona.name}`);
await prisma.$disconnect();
