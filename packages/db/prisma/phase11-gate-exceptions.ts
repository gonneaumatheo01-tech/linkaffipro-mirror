// Reprise de la phase 11 (décision D7) : rien ne doit changer pour les canaux réels au déploiement.
//   pnpm db:phase11            (local)
//   railway ssh --service web -- pnpm db:phase11   (production)
//
// Avant la phase 11, le bouton « canal à rejoindre » d'un canal faisait entrer directement dans le canal obligatoire
// (lien sans demande d'adhésion) : ni délai, ni message. Depuis, ces liens passent par une demande d'adhésion et le
// canal obligatoire applique sa propre règle. Pour garder exactement le comportement d'avant, ce script crée, sur
// chaque canal utilisé comme canal à rejoindre par la règle d'un AUTRE canal et qui a une règle par défaut, une
// exception « venu du bouton « canal à rejoindre » d'un de nos canaux → tout de suite, sans message » (portée
// SOURCE_KIND, type GATE). L'équipe peut ensuite la régler (ex. « après 1 jour ») dans « Qui peut entrer et quand ».
// Un canal obligatoire sans aucune règle n'a pas besoin d'exception : il fait déjà entrer tout de suite, sans message.
//
// Idempotent, une seule fois : marque Setting `phase11.gateExceptions` écrite à la fin ; ensuite le script ne touche
// plus rien (une exception supprimée par l'équipe n'est jamais recréée). Même sans la marque (passage interrompu), un
// canal qui a déjà une exception « bouton canal à rejoindre » ou « n'importe lequel de nos canaux » (créée par un
// passage précédent ou par l'équipe) est laissé tel quel. Aucune autre règle n'est modifiée (ordre compris).
//
// Demandes arrivées entre la mise en ligne et la reprise : le site applique la migration à son démarrage, donc le
// nouveau code peut recevoir des demandes avant ce script. Une personne venue du bouton « canal à rejoindre » est alors
// tombée sur la règle par défaut du canal obligatoire (ex. « accès dans 1 jour », ou validation à la main). Sur chaque
// canal où l'exception vient d'être créée, ces demandes encore en attente (planifiées ou à valider, provenance « canal
// à rejoindre », règle par défaut appliquée : seul le nouveau code enregistre `source.appliedRule`) sont replanifiées
// tout de suite sous l'exception (sans « Accepté », comme avant), avec un événement `membership.rescheduled`. Jamais sur
// un canal dont l'exception existait déjà (réglage de l'équipe).
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";

/** Marque écrite à la fin du premier passage réussi. */
export const GATE_EXCEPTIONS_KEY = "phase11.gateExceptions";
/** Texte de l'exception créée (affiché dans la fiche canal et dans les demandes). */
export const GATE_EXCEPTION_LABEL = "Venu du bouton « canal à rejoindre » d'un de nos canaux";

type Db = PrismaClient;

export type GateExceptionsReport = {
  /** Déjà fait (marque présente) : rien n'a été touché. */
  alreadyDone: boolean;
  doneAt: string | null;
  /** Canaux obligatoires repérés (utilisés par la règle d'un autre canal), avec une règle par défaut. */
  candidates: number;
  created: Array<{ channelId: string; title: string; ruleId: string }>;
  /** Canaux laissés tels quels : une exception équivalente existe déjà. */
  skippedExisting: Array<{ channelId: string; title: string; ruleId: string }>;
  /** Canaux obligatoires sans règle par défaut (déjà « tout de suite, sans message ») ou supprimés. */
  withoutDefault: Array<{ channelId: string; title: string | null }>;
  /** Demandes arrivées avant la reprise (venues du bouton, règle par défaut) replanifiées tout de suite. */
  rescheduled: Rescheduled[];
};

export type Rescheduled = {
  membershipId: string;
  channelId: string;
  title: string;
  ruleId: string;
  previousStatus: "SCHEDULED" | "REQUESTED";
  previousApproveAt: string | null;
};

/** Raison enregistrée dans l'événement `membership.rescheduled`. */
export const RESCHEDULE_REASON = "phase11_gate_exception";

function objectOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Demandes d'un canal arrivées avant la reprise par le bouton « canal à rejoindre » d'un autre canal, sous la règle par
 * défaut, encore en attente : replanifiées tout de suite sous l'exception `ruleId` (voir l'en-tête). Une demande traitée
 * entre-temps (acceptée, refusée, retirée) n'est jamais touchée.
 */
async function rescheduleWindowRequests(
  db: Db,
  channel: { id: string; title: string },
  ruleId: string,
  now: Date,
): Promise<Rescheduled[]> {
  const rows = await db.membership.findMany({
    where: {
      channelId: channel.id,
      status: { in: ["SCHEDULED", "REQUESTED"] },
      AND: [
        { source: { path: ["provenance", "type"], equals: "GATE" } },
        { source: { path: ["appliedRule", "scope"], equals: "DEFAULT" } },
      ],
    },
    select: {
      id: true,
      memberId: true,
      status: true,
      approveAt: true,
      approvalRuleId: true,
      source: true,
    },
    orderBy: { requestedAt: "asc" },
  });
  const out: Rescheduled[] = [];
  for (const m of rows) {
    const previousStatus = m.status as "SCHEDULED" | "REQUESTED";
    const source = objectOf(m.source);
    const updated = await db.membership.updateMany({
      where: { id: m.id, status: previousStatus },
      data: {
        status: "SCHEDULED",
        approveAt: now,
        expiresAt: null,
        approvalRuleId: ruleId,
        source: {
          ...source,
          rule: {
            id: ruleId,
            name: GATE_EXCEPTION_LABEL,
            mode: "IMMEDIATE",
            delaySeconds: 0,
            gateMode: "NONE",
          },
          appliedRule: { id: ruleId, scope: "SOURCE_KIND", label: GATE_EXCEPTION_LABEL },
        } as Prisma.InputJsonObject,
      },
    });
    if (updated.count === 0) continue;
    const previousApproveAt = m.approveAt?.toISOString() ?? null;
    await db.event.create({
      data: {
        type: "membership.rescheduled",
        memberId: m.memberId,
        channelId: channel.id,
        payload: {
          membershipId: m.id,
          reason: RESCHEDULE_REASON,
          ruleId,
          previousRuleId: m.approvalRuleId,
          previousStatus,
          previousApproveAt,
          approveAt: now.toISOString(),
        },
      },
    });
    out.push({
      membershipId: m.id,
      channelId: channel.id,
      title: channel.title,
      ruleId,
      previousStatus,
      previousApproveAt,
    });
  }
  return out;
}

function idsOf(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
}

/** Crée les exceptions « venu d'un canal obligatoire → tout de suite, sans message » (voir l'en-tête). */
export async function createGateExceptions(db: Db): Promise<GateExceptionsReport> {
  const marker = await db.setting.findUnique({ where: { key: GATE_EXCEPTIONS_KEY } });
  if (marker) {
    const doneAt =
      marker.value && typeof marker.value === "object" && "doneAt" in marker.value
        ? String((marker.value as { doneAt: unknown }).doneAt)
        : marker.updatedAt.toISOString();
    return {
      alreadyDone: true,
      doneAt,
      candidates: 0,
      created: [],
      skippedExisting: [],
      withoutDefault: [],
      rescheduled: [],
    };
  }

  // Canaux obligatoires : demandés par une règle active (avec des canaux à rejoindre) d'un autre canal.
  const rules = await db.approvalRule.findMany({
    where: { isActive: true, gateMode: { not: "NONE" } },
    select: { channelId: true, gateChannelIds: true },
  });
  const gateIds = new Set<string>();
  for (const r of rules)
    for (const id of idsOf(r.gateChannelIds)) if (id !== r.channelId) gateIds.add(id);

  const report: GateExceptionsReport = {
    alreadyDone: false,
    doneAt: null,
    candidates: 0,
    created: [],
    skippedExisting: [],
    withoutDefault: [],
    rescheduled: [],
  };
  const now = new Date();
  const channels = await db.channel.findMany({
    where: { id: { in: [...gateIds] } },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });
  for (const id of gateIds)
    if (!channels.some((c) => c.id === id))
      report.withoutDefault.push({ channelId: id, title: null });

  for (const c of channels) {
    const own = await db.approvalRule.findMany({
      where: { channelId: c.id },
      select: { id: true, scope: true, isDefault: true, sourceKind: true, sortOrder: true },
    });
    if (!own.some((r) => r.scope === "DEFAULT" && r.isDefault)) {
      report.withoutDefault.push({ channelId: c.id, title: c.title });
      continue;
    }
    report.candidates++;
    // Exception déjà là (passage précédent ou équipe) : jamais touchée, jamais doublée.
    const existing = own.find(
      (r) =>
        r.scope === "SOURCE_KIND" && (r.sourceKind === "GATE" || r.sourceKind === "ANY_CHANNEL"),
    );
    if (existing) {
      report.skippedExisting.push({ channelId: c.id, title: c.title, ruleId: existing.id });
      continue;
    }
    // Placée en tête des exceptions « type de provenance » sans renuméroter celles de l'équipe : les autres types
    // (pubs, liens de partage) ne concernent jamais une personne venue d'un canal obligatoire, l'ordre n'y change rien.
    const sameLevel = own.filter((r) => r.scope === "SOURCE_KIND").map((r) => r.sortOrder);
    const sortOrder = sameLevel.length > 0 ? Math.min(...sameLevel) - 10 : 10;
    const rule = await db.approvalRule.create({
      data: {
        channelId: c.id,
        name: GATE_EXCEPTION_LABEL,
        label: GATE_EXCEPTION_LABEL,
        isDefault: false,
        scope: "SOURCE_KIND",
        sourceKind: "GATE",
        sortOrder,
        mode: "IMMEDIATE",
        delaySeconds: 0,
        sendWelcome: false,
        sendAcceptedMessage: false,
        gateMode: "NONE",
        gateChannelIds: [],
        reminderAfterMinutes: [],
        maxReminders: 0,
        expireAfterHours: null,
        expireAction: "KEEP",
        isActive: true,
      },
      select: { id: true },
    });
    report.created.push({ channelId: c.id, title: c.title, ruleId: rule.id });
    report.rescheduled.push(...(await rescheduleWindowRequests(db, c, rule.id, now)));
  }

  const doneAt = new Date().toISOString();
  await db.setting.create({
    data: {
      key: GATE_EXCEPTIONS_KEY,
      value: {
        doneAt,
        created: report.created.map((r) => ({ channelId: r.channelId, ruleId: r.ruleId })),
        skippedExisting: report.skippedExisting.map((r) => ({
          channelId: r.channelId,
          ruleId: r.ruleId,
        })),
        rescheduled: report.rescheduled.map((r) => r.membershipId),
      },
    },
  });
  report.doneAt = doneAt;
  return report;
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const r = await createGateExceptions(db);
    if (r.alreadyDone) {
      console.log(`[phase11] déjà fait le ${r.doneAt} : aucune règle touchée.`);
      return;
    }
    console.log(`[phase11] ${r.candidates} canal(aux) à rejoindre avec une règle par défaut.`);
    for (const c of r.created)
      console.log(
        `[phase11] « ${c.title} » : exception créée (venu d'un canal obligatoire → tout de suite, sans message).`,
      );
    for (const c of r.skippedExisting)
      console.log(
        `[phase11] « ${c.title} » : une exception pour les personnes venues d'un de nos canaux existe déjà, non touchée.`,
      );
    for (const c of r.withoutDefault)
      console.log(
        c.title
          ? `[phase11] « ${c.title} » : aucune règle par défaut, entrée déjà tout de suite et sans message.`
          : `[phase11] canal ${c.channelId} supprimé : rien à faire.`,
      );
    for (const m of r.rescheduled)
      console.log(
        `[phase11] « ${m.title} » : demande ${m.membershipId} arrivée avant la reprise, replanifiée tout de suite.`,
      );
    console.log(
      `[phase11] terminé : ${r.created.length} exception(s) créée(s), ${r.skippedExisting.length} laissée(s) telle(s) quelle(s), ${r.rescheduled.length} demande(s) replanifiée(s).`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
