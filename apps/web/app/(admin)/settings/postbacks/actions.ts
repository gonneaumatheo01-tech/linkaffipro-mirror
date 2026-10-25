"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  postbackCreate,
  postbackRegenerateToken,
  postbackTest,
  postbackToggle,
  postbackUpdate,
} from "@/lib/site-ops/ops/lot-e/postbacks";
import { backParams, webActor, type SiteOpResult } from "@/lib/site-ops/ops/lot-e/common";
import { requireAdmin } from "@/lib/session";

/** Phase 34 : chaque action appelle le cœur unique (`lib/site-ops/ops/lot-e/postbacks.ts`), comme Kevin. */
function back(params: Record<string, string>): never {
  redirect(`/settings/postbacks?${new URLSearchParams(params).toString()}`);
}

/** Adresse absente : erreur levée comme avant (`findUniqueOrThrow`). */
function orThrow(r: SiteOpResult): SiteOpResult {
  if (!r.ok && r.code === "not_found" && r.field === "endpointId") throw new Error(r.error);
  return r;
}

/** Créer un endpoint de postback pour un programme (ADMIN). */
export async function createEndpointAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await postbackCreate(
    { programId: formData.get("programId"), name: formData.get("name"), mapping: formData.get("mapping") ?? "" },
    webActor(admin),
  );
  if (r.ok) revalidatePath("/settings/postbacks");
  back(backParams(r));
}

/** Modifier nom et mapping (ADMIN). */
export async function updateEndpointAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("endpointId"));
  const r = await postbackUpdate({ endpointId: id, name: formData.get("name"), mapping: formData.get("mapping") ?? "" }, webActor(admin));
  if (r.ok) revalidatePath("/settings/postbacks");
  back(backParams(r, { endpoint: id }));
}

export async function toggleEndpointAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("endpointId"));
  const r = orThrow(await postbackToggle({ endpointId: id }, webActor(admin)));
  revalidatePath("/settings/postbacks");
  back(backParams(r, { endpoint: id }));
}

export async function regenerateTokenAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("endpointId"));
  const r = orThrow(await postbackRegenerateToken({ endpointId: id }, webActor(admin)));
  revalidatePath("/settings/postbacks");
  back(backParams(r, { endpoint: id }));
}

/** Simule un postback REGISTRATION (ou autre) pour vérifier la chaîne (ADMIN). */
export async function testPostbackAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("endpointId"));
  const r = orThrow(
    await postbackTest(
      {
        endpointId: id,
        subId: String(formData.get("subId") ?? ""),
        event: String(formData.get("event") ?? "registration"),
        amount: String(formData.get("amount") ?? ""),
      },
      webActor(admin),
    ),
  );
  revalidatePath("/settings/postbacks");
  back(backParams(r, { endpoint: id }));
}
