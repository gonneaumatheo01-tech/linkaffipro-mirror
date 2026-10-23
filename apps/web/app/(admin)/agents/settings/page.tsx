import type { Metadata } from "next";
import { AI_MODELS, AI_MODEL_IDS } from "@linkaffipro/ai";
import { AgentsNav } from "@/components/agents/agents-nav";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { centsToEurField } from "@/lib/agents/config";
import { loadAgentsGeneralSettings, loadPendingCounts, loadTeamConfigs } from "@/lib/agents/queries";
import { loadSecretRows } from "@/lib/agents/secrets";
import { PROVIDER_LABELS, TEAM_KEYS, TEAM_NAMES, TEAM_PROVIDERS } from "@/lib/agents/teams";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import {
  deleteSecretAction,
  saveAllBudgetsAction,
  saveGeneralSettingsAction,
  saveSecretAction,
  setPausedAllAction,
  verifySecretAction,
} from "./actions";

export const metadata: Metadata = { title: "Agents · Réglages" };
export const dynamic = "force-dynamic";

function ModelSelect({ id, value }: { id: string; value: string }) {
  return (
    <NativeSelect id={id} name={id} defaultValue={value} wrapperClassName="w-full">
      {AI_MODEL_IDS.map((m) => (
        <option key={m} value={m}>
          {AI_MODELS[m].label}
        </option>
      ))}
    </NativeSelect>
  );
}

/**
 * Réglages des agents (ADMIN seulement) : pause générale, clés des fournisseurs (chiffrées, jamais réaffichées ; la
 * voie principale reste le bot Telegram, qui les demande lui-même), modèles d'IA, canal Médiathèque, plafonds du mois
 * de chaque équipe.
 */
export default async function AgentsSettingsPage({ searchParams }: PageProps<"/agents/settings">) {
  await requireAdminPage();
  const sp = await searchParams;
  const [general, secrets, configs, pending] = await Promise.all([
    loadAgentsGeneralSettings(),
    loadSecretRows(),
    loadTeamConfigs(),
    loadPendingCounts(),
  ]);

  return (
    <>
      <AgentsNav current="settings" isAdmin pending={pending.validations + pending.requests} />
      <PageHeader
        title="Réglages des agents"
        description="Les clés des fournisseurs, les modèles d'IA, le canal Médiathèque et les plafonds de chaque équipe."
        help="Le bot vous demandera lui-même sur Telegram chaque clé utile, au moment voulu. Cette page sert de secours."
        meta={general.pausedAll ? <StatusPill tone="danger">Pause générale</StatusPill> : null}
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        <FormSection
          title="Pause générale"
          description={
            general.pausedAll
              ? "Toutes les équipes sont arrêtées : aucune mission ne démarre ni ne continue."
              : "Arrête toutes les équipes d'un coup ; les missions en cours attendent la reprise."
          }
        >
          <form action={setPausedAllAction}>
            <input type="hidden" name="paused" value={general.pausedAll ? "0" : "1"} />
            {general.pausedAll ? (
              <Button type="submit" variant="outline" className="max-md:h-10">
                Tout reprendre
              </Button>
            ) : (
              <ConfirmSubmit
                variant="outline"
                className="max-md:h-10"
                destructive
                confirmTitle="Mettre toutes les équipes en pause ?"
                confirmLabel="Tout mettre en pause"
                message="Plus aucune équipe ne crée ni ne poursuit de mission, jusqu'à ce que vous cliquiez sur « Tout reprendre »."
              >
                Tout mettre en pause
              </ConfirmSubmit>
            )}
          </form>
        </FormSection>

        <FormSection
          title="Clés des fournisseurs"
          description="Chiffrées en base et jamais réaffichées : seuls les 4 derniers caractères sont montrés."
        >
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {secrets.map((s) => {
              const id = `secret-${s.key.replace(/[^a-z0-9]/gi, "-")}`;
              return (
                <li key={s.key} className="space-y-3 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{s.info.label}</span>
                    {s.summary === null ? (
                      <StatusPill tone="warning">État illisible</StatusPill>
                    ) : s.summary.set ? (
                      <StatusPill tone="success">Enregistrée{s.summary.last4 ? ` (…${s.summary.last4})` : ""}</StatusPill>
                    ) : (
                      <StatusPill tone="muted">Absente</StatusPill>
                    )}
                    {s.summary?.updatedAt ? (
                      <span className="text-note text-muted-foreground">le {fmtDate(s.summary.updatedAt)}</span>
                    ) : null}
                  </div>
                  {s.info.usage ? <p className="text-note text-muted-foreground">{s.info.usage}</p> : null}
                  <form action={saveSecretAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="key" value={s.key} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <Label htmlFor={id}>{s.summary?.set ? "Remplacer la clé" : "Coller la clé"}</Label>
                      <Input
                        id={id}
                        name="value"
                        type="password"
                        autoComplete="new-password"
                        className="font-mono"
                        aria-describedby={s.info.createUrl ? `${id}-aide` : undefined}
                      />
                      {s.info.createUrl ? (
                        <p id={`${id}-aide`} className="text-note text-muted-foreground">
                          Créez-la ici :{" "}
                          <a href={s.info.createUrl} target="_blank" rel="noopener noreferrer" className="text-info underline">
                            {s.info.createUrl.replace(/^https:\/\//, "")}
                          </a>
                        </p>
                      ) : null}
                    </div>
                    <Button type="submit" variant="outline" className="max-md:h-10">
                      Enregistrer
                    </Button>
                  </form>
                  {s.summary?.set ? (
                    <div className="flex flex-wrap gap-2">
                      <form action={verifySecretAction}>
                        <input type="hidden" name="key" value={s.key} />
                        <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                          Vérifier
                        </Button>
                      </form>
                      <form action={deleteSecretAction}>
                        <input type="hidden" name="key" value={s.key} />
                        <ConfirmSubmit
                          variant="ghost"
                          size="sm"
                          className="text-danger max-md:h-10"
                          destructive
                          confirmTitle={`Retirer la clé ${s.info.label} ?`}
                          confirmLabel="Retirer la clé"
                          message="Les agents qui s'en servent repassent en simulation jusqu'à ce qu'une clé soit recollée."
                        >
                          Retirer la clé
                        </ConfirmSubmit>
                      </form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </FormSection>

        <form action={saveGeneralSettingsAction} className="space-y-6">
          <FormSection
            title="Modèles d'IA et médiathèque"
            description="La clé de l'IA est celle de Réglages → IA. Le modèle rapide sert aux contrôles, le plus fort à l'écriture."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="modelFast">IA rapide (contrôles)</Label>
                <ModelSelect id="modelFast" value={general.models.fast} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="modelStrong">IA d&apos;écriture (Rédaction)</Label>
                <ModelSelect id="modelStrong" value={general.models.strong} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="libraryChannelId">Canal Médiathèque (facultatif)</Label>
                <NativeSelect
                  id="libraryChannelId"
                  name="libraryChannelId"
                  defaultValue={general.libraryChannelId ?? ""}
                  wrapperClassName="w-full"
                  aria-describedby="libraryChannelId-aide"
                >
                  <option value="">Aucun : les médias restent seulement dans le site</option>
                  {general.channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                      {c.isTest ? " (canal Test)" : ""}
                    </option>
                  ))}
                </NativeSelect>
                <p id="libraryChannelId-aide" className="text-note text-muted-foreground">
                  Un canal privé où le bot recopie chaque média rangé dans la médiathèque. Le bot doit y être administrateur.
                </p>
              </div>
            </div>
          </FormSection>
          <Button type="submit" className="max-md:h-10">
            Enregistrer
          </Button>
        </form>

        <form action={saveAllBudgetsAction} className="space-y-6">
          <FormSection
            title="Plafonds du mois par équipe"
            description="En euros. Au-delà, les missions sont refusées proprement ; alerte à 80 % et à 100 %. Champ vide : aucun plafond saisi."
          >
            <div className="space-y-6">
              {TEAM_KEYS.map((t) => (
                <fieldset key={t} className="space-y-2">
                  <legend className="text-body font-medium text-foreground">Équipe {TEAM_NAMES[t]}</legend>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {TEAM_PROVIDERS[t].map((p) => (
                      <div key={p} className="space-y-1.5">
                        <Label htmlFor={`${t}.budget_${p}`}>{PROVIDER_LABELS[p]} (€)</Label>
                        <Input
                          id={`${t}.budget_${p}`}
                          name={`${t}.budget_${p}`}
                          inputMode="decimal"
                          defaultValue={centsToEurField(configs[t].budgets[p])}
                        />
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </FormSection>
          <Button type="submit" variant="outline" className="max-md:h-10">
            Enregistrer les plafonds
          </Button>
        </form>
      </div>
    </>
  );
}
