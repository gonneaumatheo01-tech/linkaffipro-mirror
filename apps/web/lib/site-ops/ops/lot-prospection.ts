/**
 * Phase 31 — cœurs des opérations de l'équipe Prospection (page Agents → Prospection), appelés par le site et par
 * Kevin (règle de la phase 34). Métadonnées pour Kevin : `packages/agents/src/site/ops/lot-prospection.ts` ;
 * correspondance : `packages/agents/src/site/parity/lot-prospection.ts`. Cœurs : `./lot-prospection/cores.ts`.
 * Aucune de ces opérations ne contacte un canal ou une personne.
 */
import type { SiteOpImpl } from "@linkaffipro/agents";
import type { CoreRun, Fail } from "./lot-d/kit";

type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };
type In = Record<string, unknown>;
type Cores = typeof import("./lot-prospection/cores");
type Advanced = typeof import("./lot-prospection/advanced");

function op(key: string, pick: (m: Cores) => { prepare: (input: In) => Promise<Prepared>; core: CoreRun }): SiteOpImpl {
  return {
    key,
    async run(input, actor, opts) {
      const { prepare, core } = pick(await import("./lot-prospection/cores"));
      const p = await prepare(input ?? {});
      if (!p.ok) return p.result;
      return core(p.fd, actor, opts ?? {});
    },
  };
}

/** Phase 32 : cœurs des pages avancées (alertes, réseaux, valeur, affiliés signés, recherche par compte réel). */
function opAdvanced(key: string, pick: (m: Advanced) => { prepare: (input: In) => Promise<Prepared>; core: CoreRun }): SiteOpImpl {
  return {
    key,
    async run(input, actor, opts) {
      const { prepare, core } = pick(await import("./lot-prospection/advanced"));
      const p = await prepare(input ?? {});
      if (!p.ok) return p.result;
      return core(p.fd, actor, opts ?? {});
    },
  };
}

export const LOT_PROSPECTION_IMPL: SiteOpImpl[] = [
  op("agents.prospection_statut", (m) => ({ prepare: m.kevinStatusForm, core: m.runProspectStatus })),
  op("agents.prospection_statut_lot", (m) => ({ prepare: m.kevinBulkForm, core: m.runBulkProspectStatus })),
  op("agents.prospection_note", (m) => ({ prepare: m.kevinNoteForm, core: m.runProspectNote })),
  op("agents.prospection_ajouter", (m) => ({ prepare: m.kevinAddForm, core: m.runAddManualProspect })),
  op("agents.prospection_offre", (m) => ({ prepare: m.kevinOfferForm, core: m.runSaveOffer })),
  op("agents.prospection_offre_activer", (m) => ({ prepare: m.kevinToggleOfferForm, core: m.runToggleOffer })),
  op("agents.prospection_repere_proposer", (m) => ({ prepare: m.kevinProposeForm, core: m.runProposeDict })),
  op("agents.prospection_repere_valider", (m) => ({ prepare: m.kevinDecideForm, core: m.runDecideDict })),
  op("agents.prospection_source_pause", (m) => ({ prepare: m.kevinSourceForm, core: m.runSourcePause })),
  op("agents.prospection_reglages", (m) => ({ prepare: m.kevinSettingsForm, core: m.runSaveSettings })),
  // Phase 32
  opAdvanced("agents.prospection_alerte_vue", (m) => ({ prepare: m.kevinAlertSeenForm, core: m.runAlertSeen })),
  opAdvanced("agents.prospection_alertes_canal", (m) => ({ prepare: m.kevinAlertsChannelForm, core: m.runAlertsChannel })),
  opAdvanced("agents.prospection_alertes_type", (m) => ({ prepare: m.kevinAlertsKindForm, core: m.runAlertsKind })),
  opAdvanced("agents.prospection_reseau_fusionner", (m) => ({ prepare: m.kevinNetworkMergeForm, core: m.runNetworkMerge })),
  opAdvanced("agents.prospection_reseau_separer", (m) => ({ prepare: m.kevinNetworkSplitForm, core: m.runNetworkSplit })),
  opAdvanced("agents.prospection_affilie_rattacher", (m) => ({ prepare: m.kevinAffiliateLinkForm, core: m.runAffiliateLink })),
  opAdvanced("agents.prospection_calibrage_appliquer", (m) => ({ prepare: m.kevinCalibrationApplyForm, core: m.runCalibrationApply })),
  opAdvanced("agents.prospection_calibrage_annuler", (m) => ({ prepare: m.kevinEmptyForm, core: m.runCalibrationUndo })),
  opAdvanced("agents.prospection_recherche_compte_couper", (m) => ({ prepare: m.kevinEmptyForm, core: m.runAccountSearchStop })),
];
