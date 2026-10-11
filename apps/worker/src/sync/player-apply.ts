import { cpaEvents, effectiveCpaDates, type CpaEvent, type CpaState } from "@linkaffipro/core";
import { chooseSubId, type PlayerInput, type SubIdSource } from "@linkaffipro/linkaffi";

/** Ce que l'on connaît déjà d'un joueur (lecture avant upsert). */
export type ExistingPlayer = {
  id: string;
  subId: string | null;
  subIdSource: SubIdSource;
  updatedAt: Date | null;
  registeredAt: Date | null;
  ftdAt: Date | null;
  depositCount: number;
  depositTotal: number;
  ngr: number;
  memberId: string | null;
  clickId: string | null;
};

export type PlayerChange = {
  data: {
    subId: string | null;
    subIdSource: SubIdSource;
    registeredAt: Date | null;
    ftdAt: Date | null;
    ftdAmount: number | null;
    depositCount: number;
    redepositCount: number;
    depositTotal: number;
    status: string | null;
    /** Commission CPA (phase 10) : statut et montant Link Affi, dates retenues (replis appliqués). */
    cpaStatus: string | null;
    cpaAmount: number | null;
    cpaCreditedAt: Date | null;
    cpaReversedAt: Date | null;
    lastEventAt: Date | null;
    raw: Record<string, unknown>;
  };
  /** Événements de commission voulus (CPA, CPA_REVERSAL), recalculés depuis l'état Link Affi : voir `diffCpaEvents`. */
  cpaEvents: CpaEvent[];
  /** Événements à émettre (changements réels seulement). */
  events: Array<{ type: "player.registered" | "player.ftd" | "player.deposit"; amount?: number }>;
  /** Le sub-ID a changé : il faut (re)faire le rattachement au clic. */
  subIdChanged: boolean;
};

/**
 * Calcule la mise à jour d'un joueur et les événements à émettre, sans accès base.
 * Règles : le sub-ID suit la précédence postback > time_match > plus récent ; les cumuls ne reculent pas
 * (une resynchro ne retire jamais un dépôt) ; un événement n'est émis que pour un changement réel.
 */
export function applyPlayerRow(existing: ExistingPlayer | null, mapped: PlayerInput): PlayerChange {
  const chosen = existing
    ? chooseSubId({ subId: existing.subId, subIdSource: existing.subIdSource, updatedAt: existing.updatedAt }, { subId: mapped.subId, subIdSource: mapped.subIdSource, updatedAt: mapped.updatedAt })
    : { subId: mapped.subId, subIdSource: mapped.subIdSource };
  const depositCount = Math.max(existing?.depositCount ?? 0, mapped.depositCount);
  const depositTotal = Math.max(existing?.depositTotal ?? 0, mapped.depositTotal);
  const events: PlayerChange["events"] = [];
  if (!existing && mapped.registeredAt) events.push({ type: "player.registered" });
  if (!existing?.ftdAt && mapped.ftdAt) events.push({ type: "player.ftd", amount: mapped.ftdAmount ?? undefined });
  if (existing && depositCount > existing.depositCount) events.push({ type: "player.deposit", amount: Math.max(0, depositTotal - existing.depositTotal) });
  const cpa: CpaState = {
    laPlayerId: mapped.externalId,
    status: mapped.cpaStatus,
    amount: mapped.cpaAmount,
    creditedAt: mapped.cpaCreditedAt,
    reversedAt: mapped.cpaReversedAt,
    qualifiedAt: mapped.qualifiedAt,
    disqualifiedAt: mapped.disqualifiedAt,
  };
  const cpaDates = effectiveCpaDates(cpa);
  return {
    data: {
      subId: chosen.subId,
      subIdSource: chosen.subIdSource,
      registeredAt: mapped.registeredAt ?? existing?.registeredAt ?? null,
      ftdAt: mapped.ftdAt ?? existing?.ftdAt ?? null,
      ftdAmount: mapped.ftdAmount,
      depositCount,
      redepositCount: mapped.redepositCount,
      depositTotal,
      status: mapped.status,
      cpaStatus: mapped.cpaStatus,
      cpaAmount: mapped.cpaAmount,
      cpaCreditedAt: cpaDates.creditedAt,
      cpaReversedAt: cpaDates.reversedAt,
      lastEventAt: mapped.lastEventAt,
      raw: mapped.raw,
    },
    cpaEvents: cpaEvents(cpa),
    events,
    subIdChanged: (chosen.subId ?? null) !== (existing?.subId ?? null),
  };
}

// Règle de diff partagée avec la reprise `db:phase10:gains` : voir @linkaffipro/core (commissions).
export { diffCpaEvents, type StoredCpaEvent } from "@linkaffipro/core";
