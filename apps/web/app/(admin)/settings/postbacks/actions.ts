"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomToken } from "@linkaffipro/core";
import { prisma, audit, toJsonValue } from "@linkaffipro/db";
import { requireAdmin } from "@/lib/session";
import { DEFAULT_MAPPING, normalizeMapping } from "@/lib/postback/parse";
import { handlePostback } from "@/lib/postback/apply";

function back(params: Record<string, string>): never {
  redirect(`/settings/postbacks?${new URLSearchParams(params).toString()}`);
}
function isRedirect(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}
function parseMappingField(raw: FormDataEntryValue | null) {
  const text = String(raw ?? "").trim();
  if (!text) return DEFAULT_MAPPING;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Le mapping doit être un JSON valide.");
  }
  return normalizeMapping(json);
}

/** Créer un endpoint de postback pour un programme (ADMIN). */
export async function createEndpointAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = z.object({ programId: z.string().min(1), name: z.string().trim().min(2).max(80) }).safeParse({ programId: formData.get("programId"), name: formData.get("name") });
  if (!parsed.success) back({ error: "Programme et nom (2 caractères minimum) requis." });
  try {
    const mapping = parseMappingField(formData.get("mapping"));
    const ep = await prisma.postbackEndpoint.create({ data: { programId: parsed.data.programId, name: parsed.data.name, token: randomToken(24), mapping: toJsonValue(mapping) } });
    await audit({ userId: admin.id, action: "postback.endpoint_created", entityType: "PostbackEndpoint", entityId: ep.id, metadata: { name: ep.name, programId: ep.programId } });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({ error: err instanceof Error ? err.message : "Création impossible." });
  }
  revalidatePath("/settings/postbacks");
  back({ ok: "Endpoint créé : copiez l'URL et donnez-la au programme." });
}

/** Modifier nom et mapping (ADMIN). */
export async function updateEndpointAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("endpointId"));
  const name = z.string().trim().min(2).max(80).safeParse(formData.get("name"));
  if (!name.success) back({ error: "Nom invalide." });
  try {
    const mapping = parseMappingField(formData.get("mapping"));
    await prisma.postbackEndpoint.update({ where: { id }, data: { name: name.data, mapping: toJsonValue(mapping) } });
    await audit({ userId: admin.id, action: "postback.endpoint_updated", entityType: "PostbackEndpoint", entityId: id });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({ error: err instanceof Error ? err.message : "Modification impossible.", endpoint: id });
  }
  revalidatePath("/settings/postbacks");
  back({ ok: "Endpoint enregistré.", endpoint: id });
}

export async function toggleEndpointAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("endpointId"));
  const ep = await prisma.postbackEndpoint.findUniqueOrThrow({ where: { id } });
  await prisma.postbackEndpoint.update({ where: { id }, data: { isActive: !ep.isActive } });
  await audit({ userId: admin.id, action: ep.isActive ? "postback.endpoint_disabled" : "postback.endpoint_enabled", entityType: "PostbackEndpoint", entityId: id });
  revalidatePath("/settings/postbacks");
  back({ ok: ep.isActive ? "Endpoint désactivé : les postbacks reçus seront refusés (403)." : "Endpoint activé.", endpoint: id });
}

export async function regenerateTokenAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("endpointId"));
  await prisma.postbackEndpoint.update({ where: { id }, data: { token: randomToken(24) } });
  await audit({ userId: admin.id, action: "postback.token_regenerated", entityType: "PostbackEndpoint", entityId: id });
  revalidatePath("/settings/postbacks");
  back({ ok: "Nouveau jeton généré : l'ancienne URL ne fonctionne plus, redonnez la nouvelle au programme.", endpoint: id });
}

/** Simule un postback REGISTRATION (ou autre) pour vérifier la chaîne (ADMIN). */
export async function testPostbackAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("endpointId"));
  const subId = String(formData.get("subId") ?? "").trim();
  const eventRaw = String(formData.get("event") ?? "registration").trim() || "registration";
  const amount = String(formData.get("amount") ?? "").trim();
  const ep = await prisma.postbackEndpoint.findUniqueOrThrow({ where: { id } });
  const mapping = normalizeMapping(ep.mapping);
  const params: Record<string, string> = { [mapping.player_id]: `test-${Date.now().toString(36)}`, [mapping.event]: eventRaw, [mapping.txid]: `test-${randomToken(4)}` };
  if (subId) params[mapping.sub_id] = subId;
  if (amount) params[mapping.amount] = amount;
  const r = await handlePostback(ep, params, null);
  await audit({ userId: admin.id, action: "postback.test_sent", entityType: "PostbackEndpoint", entityId: id, metadata: { status: r.status } });
  revalidatePath("/settings/postbacks");
  if (r.status === "ERROR") back({ error: `Test : ${r.message}`, endpoint: id });
  back({ ok: `Test ${r.status === "ACCEPTED" ? "accepté" : "ignoré"} : ${r.message}`, endpoint: id });
}
