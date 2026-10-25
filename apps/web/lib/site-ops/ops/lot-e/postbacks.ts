/**
 * Phase 34, lot E — cœurs de Réglages → Postbacks (adresses de réception, test, import CSV des joueurs). Appelés par
 * `app/(admin)/settings/postbacks/actions.ts`, `postbacks/import/actions.ts` et par Kevin. Administrateurs seulement.
 * L'adresse d'un point de réception porte son jeton : elle ne revient que dans `data.url` (jamais dans le journal).
 */
import { z } from "zod";
import { randomToken } from "@linkaffipro/core";
import { prisma, audit, toJsonValue } from "@linkaffipro/db";
import { env } from "@/lib/env";
import { DEFAULT_MAPPING, normalizeMapping, parsePostback, postbackUrlTemplate, type PostbackMapping } from "@/lib/postback/parse";
import { applyParsedPostback, handlePostback } from "@/lib/postback/apply";
import { ENDPOINT_DISABLED_OK } from "@/app/(admin)/settings/postbacks/core-texts";
import { detectPlayerColumns, parseCsv, rowsToPostbackParams } from "@/lib/postback/csv";
import { adminOnly, fail, needUser, ok, optBool, preview, resolveNamed, str, viaMeta, type CoreRun, type Fail } from "./common";

/** Correspondance des paramètres : texte JSON du formulaire (vide = valeur par défaut), ou objet donné par Kevin. */
export function parseMappingField(raw: unknown): PostbackMapping {
  if (raw && typeof raw === "object") return normalizeMapping(raw);
  const text = str(raw).trim();
  if (!text) return DEFAULT_MAPPING;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      "La correspondance des paramètres doit être un JSON valide (ou laissez le champ vide pour la valeur par défaut).",
    );
  }
  return normalizeMapping(json);
}

function urlOf(token: string, mapping: PostbackMapping): string {
  return postbackUrlTemplate(env.appBaseUrl, token, mapping);
}

/** Programme désigné par son identifiant (site) ou par son nom (Kevin). */
async function findProgramId(input: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; result: Fail } | null> {
  const id = str(input.programId).trim();
  if (id) return { ok: true, id };
  const raw = str(input.program).trim();
  if (!raw) return null;
  const rows = await prisma.affiliateProgram.findMany({ select: { id: true, name: true } });
  const ref = await resolveNamed({ plural: "programmes", one: "le programme" }, raw, rows);
  return ref.ok ? { ok: true, id: ref.id } : ref;
}

/** Point de réception désigné par son identifiant (site) ou par son nom (Kevin). */
async function findEndpoint(input: Record<string, unknown>) {
  const id = str(input.endpointId).trim();
  const raw = str(input.endpoint).trim();
  if (id || !raw) {
    const ep = id ? await prisma.postbackEndpoint.findUnique({ where: { id } }) : null;
    return ep ? ({ ok: true, ep } as const) : ({ ok: false, result: fail("Adresse de retour du casino introuvable.", "not_found", "endpointId") } as const);
  }
  const rows = await prisma.postbackEndpoint.findMany({ select: { id: true, name: true } });
  const ref = await resolveNamed({ plural: "adresses de retour du casino", one: "l'adresse de retour du casino" }, raw, rows);
  if (!ref.ok) return ref;
  const ep = await prisma.postbackEndpoint.findUnique({ where: { id: ref.id } });
  return ep ? ({ ok: true, ep } as const) : ({ ok: false, result: fail("Adresse de retour du casino introuvable.", "not_found") } as const);
}

/** Créer un point de réception de postback pour un programme. */
export const postbackCreate: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const program = await findProgramId(input);
  if (program && !program.ok) return program.result;
  const parsed = z
    .object({ programId: z.string().min(1), name: z.string().trim().min(2).max(80) })
    .safeParse({ programId: program?.id, name: input.name });
  if (!parsed.success) return fail("Choisissez un programme et donnez un nom (2 caractères minimum).");
  let mapping: PostbackMapping;
  try {
    mapping = parseMappingField(input.mapping);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Création impossible.", "invalid", "mapping");
  }
  if (opts.dryRun) return preview({ summary: `Nouvelle adresse de retour du casino « ${parsed.data.name} » pour le programme choisi.` });
  try {
    const ep = await prisma.postbackEndpoint.create({
      data: { programId: parsed.data.programId, name: parsed.data.name, token: randomToken(24), mapping: toJsonValue(mapping) },
    });
    await audit({
      userId: actor.userId,
      action: "postback.endpoint_created",
      entityType: "PostbackEndpoint",
      entityId: ep.id,
      metadata: { name: ep.name, programId: ep.programId, ...viaMeta(actor) },
    });
    return ok("Adresse créée : copiez l'URL et donnez-la au partenaire.", { endpointId: ep.id, url: urlOf(ep.token, mapping) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Création impossible.");
  }
};

/** Modifier nom et correspondance. Kevin peut n'en donner qu'un : l'autre est gardé. */
export const postbackUpdate: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findEndpoint(input);
  if (!found.ok) return found.result;
  const { ep } = found;
  const name = z.string().trim().min(2).max(80).safeParse(input.name === undefined ? ep.name : input.name);
  if (!name.success) return fail("Le nom doit faire entre 2 et 80 caractères.", "invalid", "name");
  let mapping: PostbackMapping;
  try {
    mapping = input.mapping === undefined ? normalizeMapping(ep.mapping) : parseMappingField(input.mapping);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Modification impossible.", "invalid", "mapping");
  }
  if (opts.dryRun) return preview({ summary: `Adresse de retour du casino « ${name.data} » : nom et correspondance des paramètres enregistrés.` });
  try {
    await prisma.postbackEndpoint.update({ where: { id: ep.id }, data: { name: name.data, mapping: toJsonValue(mapping) } });
    await audit({
      userId: actor.userId,
      action: "postback.endpoint_updated",
      entityType: "PostbackEndpoint",
      entityId: ep.id,
      metadata: viaMeta(actor),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Modification impossible.");
  }
  return ok("Adresse enregistrée.", { endpointId: ep.id });
};

/** Activer / désactiver un point de réception (le site bascule ; Kevin peut dire l'état voulu). */
export const postbackToggle: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findEndpoint(input);
  if (!found.ok) return found.result;
  const { ep } = found;
  const wanted = optBool(input.active);
  if (wanted !== undefined && wanted === ep.isActive)
    return ok(ep.isActive ? "Adresse déjà active." : "Adresse déjà désactivée.", { endpointId: ep.id, unchanged: true });
  if (opts.dryRun)
    return preview({
      summary: ep.isActive ? `Désactivation de l'adresse de retour du casino « ${ep.name} ».` : `Activation de l'adresse de retour du casino « ${ep.name} ».`,
      impact: ep.isActive ? "Les retours du partenaire seront refusés jusqu'à réactivation." : null,
    });
  await prisma.postbackEndpoint.update({ where: { id: ep.id }, data: { isActive: !ep.isActive } });
  await audit({
    userId: actor.userId,
    action: ep.isActive ? "postback.endpoint_disabled" : "postback.endpoint_enabled",
    entityType: "PostbackEndpoint",
    entityId: ep.id,
    metadata: viaMeta(actor),
  });
  return ok(
    ep.isActive ? ENDPOINT_DISABLED_OK : "Adresse activée.",
    { endpointId: ep.id },
  );
};

/** Nouvelle adresse (nouveau jeton) : l'ancienne ne fonctionne plus. */
export const postbackRegenerateToken: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findEndpoint(input);
  if (!found.ok) return found.result;
  const { ep } = found;
  if (opts.dryRun)
    return preview({
      summary: `Nouvelle adresse pour « ${ep.name} ».`,
      impact: "L'ancienne adresse cesse aussitôt de fonctionner : il faudra redonner la nouvelle au partenaire.",
    });
  const token = randomToken(24);
  await prisma.postbackEndpoint.update({ where: { id: ep.id }, data: { token } });
  await audit({
    userId: actor.userId,
    action: "postback.token_regenerated",
    entityType: "PostbackEndpoint",
    entityId: ep.id,
    metadata: viaMeta(actor),
  });
  return ok("Nouvelle URL générée : l'ancienne ne fonctionne plus, redonnez la nouvelle au partenaire.", {
    endpointId: ep.id,
    url: urlOf(token, normalizeMapping(ep.mapping)),
  });
};

/** Simule un postback (inscription par défaut) pour vérifier la chaîne. */
export const postbackTest: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findEndpoint(input);
  if (!found.ok) return found.result;
  const { ep } = found;
  const subId = str(input.subId).trim();
  const eventRaw = str(input.event ?? "registration").trim() || "registration";
  const amount = str(input.amount).trim();
  if (opts.dryRun)
    return preview({
      summary: `Retour de test « ${eventRaw} » sur « ${ep.name} »${subId ? ` avec l'identifiant de suivi ${subId}` : ""}${amount ? `, montant ${amount}` : ""}.`,
      impact: "Un joueur de test est enregistré comme le ferait un vrai retour du casino.",
    });
  const mapping = normalizeMapping(ep.mapping);
  const params: Record<string, string> = {
    [mapping.player_id]: `test-${Date.now().toString(36)}`,
    [mapping.event]: eventRaw,
    [mapping.txid]: `test-${randomToken(4)}`,
  };
  if (subId) params[mapping.sub_id] = subId;
  if (amount) params[mapping.amount] = amount;
  const r = await handlePostback(ep, params, null);
  await audit({
    userId: actor.userId,
    action: "postback.test_sent",
    entityType: "PostbackEndpoint",
    entityId: ep.id,
    metadata: { status: r.status, ...viaMeta(actor) },
  });
  if (r.status === "ERROR") return fail(`Test : ${r.message}`);
  return ok(`Test ${r.status === "ACCEPTED" ? "accepté" : "ignoré"} : ${r.message}`, { endpointId: ep.id, status: r.status });
};

// ---------------------------------------------------------------------------------------------- import CSV

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Texte du fichier : `csv` (texte), `csvB64` (formulaire du site, étape 2) ou `file` (document reçu par Kevin). */
function csvTextOf(input: Record<string, unknown>): { text: string; filename: string } {
  const file = input.file as { text?: unknown; fileName?: unknown } | undefined;
  const filename = str(input.filename || file?.fileName || "import.csv").slice(0, 120);
  if (typeof input.csv === "string") return { text: input.csv, filename };
  if (file && typeof file === "object" && typeof file.text === "string") return { text: file.text, filename };
  return { text: Buffer.from(str(input.csvB64), "base64").toString("utf8"), filename };
}

export type PlayersCsvAnalysis = {
  filename: string;
  headers: string[];
  rows: string[][];
  total: number;
  columns: Record<string, number | null>;
  invalid: number;
};

/** Analyse du fichier (aucune écriture) : en-tête, colonnes reconnues, lignes illisibles. Lève si illisible. */
function analysePlayersCsv(text: string, filename: string): PlayersCsvAnalysis | { error: string } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "Le fichier ne contient aucune ligne de données sous l'en-tête." };
  const columns = detectPlayerColumns(rows[0]!);
  const params = rowsToPostbackParams(rows.slice(1), columns);
  let invalid = 0;
  for (const p of params) {
    try {
      parsePostback(p, DEFAULT_MAPPING);
    } catch {
      invalid++;
    }
  }
  return { filename, headers: rows[0]!, rows: rows.slice(1, 21), total: rows.length - 1, columns, invalid };
}

function importSummary(a: PlayersCsvAnalysis): string {
  return `Fichier « ${a.filename} » : ${a.total} ligne${a.total > 1 ? "s" : ""}${a.invalid ? `, dont ${a.invalid} illisible${a.invalid > 1 ? "s" : ""} (ignorée${a.invalid > 1 ? "s" : ""})` : ""}.`;
}

/**
 * Étape 1 du site : analyse et aperçu, journalisé (`postback.players_previewed`), sans aucune autre écriture.
 * `data` = l'aperçu (en-tête, 20 premières lignes, colonnes, lignes illisibles).
 */
export const playersImportPreview: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const program = await findProgramId(input);
  if (program && !program.ok) return program.result;
  if (!program) return fail("Choisissez d'abord un programme.", "invalid", "programId");
  const size = typeof input.size === "number" ? input.size : null;
  const { text, filename } = csvTextOf(input);
  if (size === 0 || !text) return fail("Choisissez d'abord un fichier CSV.", "invalid", "file");
  if ((size ?? Buffer.byteLength(text, "utf8")) > MAX_IMPORT_BYTES) return fail("Fichier trop volumineux (5 Mo maximum).", "invalid", "file");
  try {
    const a = analysePlayersCsv(text, filename);
    if ("error" in a) return fail(a.error, "invalid", "file");
    if (!opts.dryRun)
      await audit({
        userId: actor.userId,
        action: "postback.players_previewed",
        metadata: { programId: program.id, filename, rows: a.total, invalid: a.invalid, ...viaMeta(actor) },
      });
    const data = { ...a, programId: program.id };
    return opts.dryRun ? preview({ summary: importSummary(a) }, data) : ok(importSummary(a), data);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Le fichier est illisible : exportez-le de nouveau au format CSV.", "invalid", "file");
  }
};

/**
 * Étape 2 : import idempotent par la même logique que les postbacks. Essai à blanc = l'aperçu (rien n'est écrit) :
 * Kevin le montre, puis importe après OUI.
 */
export const playersImport: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  const program0 = await findProgramId(input);
  if (program0 && !program0.ok) return program0.result;
  const programId = z.string().min(1).safeParse(program0?.id);
  if (!programId.success) return fail("Choisissez d'abord un programme.", "invalid", "programId");
  const { text, filename } = csvTextOf(input);
  const program = await prisma.affiliateProgram.findUnique({ where: { id: programId.data }, select: { id: true, name: true } });
  if (!program) return fail("Programme introuvable.", "not_found", "programId");
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) return fail("Fichier trop volumineux (5 Mo maximum).", "invalid", "file");
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Le fichier est illisible : exportez-le de nouveau au format CSV.", "invalid", "file");
  }
  if (rows.length < 2) return fail("Le fichier est vide.", "invalid", "file");
  if (opts.dryRun) {
    const a = analysePlayersCsv(text, filename);
    if ("error" in a) return fail(a.error, "invalid", "file");
    return preview(
      { summary: `${importSummary(a)} Import dans le programme « ${program.name} ».`, impact: null },
      { ...a, programId: program.id },
    );
  }
  const columns = detectPlayerColumns(rows[0]!);
  const params = rowsToPostbackParams(rows.slice(1), columns);
  const endpoint = {
    id: `import:${program.id}`,
    name: `Import CSV — ${program.name}`,
    programId: program.id,
    mapping: DEFAULT_MAPPING,
    isActive: true,
  };
  let imported = 0;
  let ignored = 0;
  const errors: string[] = [];
  for (const [i, p] of params.entries()) {
    try {
      const parsed = parsePostback(p, DEFAULT_MAPPING);
      const r = await applyParsedPostback(endpoint, parsed);
      if (r.status === "ACCEPTED") imported++;
      else if (r.status === "IGNORED") ignored++;
      else errors.push(`ligne ${i + 2} : ${r.message}`);
    } catch (err) {
      errors.push(`ligne ${i + 2} : ${err instanceof Error ? err.message : "erreur"}`);
    }
    if (errors.length > 200) {
      errors.push("… (arrêt de la liste des erreurs)");
      break;
    }
  }
  await prisma.importBatch.create({
    data: {
      kind: "PLAYERS_CSV",
      filename,
      rows: params.length,
      imported,
      errors: toJsonValue(errors.slice(0, 200)),
      createdById: actor.userId!,
    },
  });
  await audit({
    userId: actor.userId,
    action: "postback.players_imported",
    entityType: "AffiliateProgram",
    entityId: program.id,
    metadata: { filename, rows: params.length, imported, ignored, errors: errors.length, ...viaMeta(actor) },
  });
  return ok(
    `Import terminé : ${imported} joueur${imported > 1 ? "s" : ""} importé${imported > 1 ? "s" : ""}, ${ignored} ignoré${ignored > 1 ? "s" : ""}, ${errors.length} erreur${errors.length > 1 ? "s" : ""}.`,
    { imported, ignored, errors, total: params.length },
  );
};
