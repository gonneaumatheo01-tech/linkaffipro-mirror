import type { Metadata } from "next";
import { AI_MODELS, AI_MODEL_IDS } from "@linkaffipro/ai";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { StatCard } from "@/components/admin/stat-card";
import { StatusPill } from "@/components/admin/status-pill";
import { DetailList, DetailRow } from "@/components/settings/detail-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { loadAiConfigState } from "@/lib/ai/config";
import { monthUsage, recentSuggestions } from "@/lib/ai/usage";
import { requireUser } from "@/lib/session";
import { removeAiKeyAction, saveAiSettingsAction, verifyAiKeyAction } from "./actions";
import {
  aiCostFigure,
  aiKeyView,
  aiKindLabel,
  aiModelLabel,
  aiSurfaceLabel,
  aiTokensLabel,
  aiUniverseLabel,
  aiUsedLabel,
  capUsage,
} from "./ai-view";
import { AnthropicKeyGuide } from "./guide";

export const metadata: Metadata = { title: "Réglages · IA" };
export const dynamic = "force-dynamic";

const BAR_TONES = { brand: "bg-brand-ink", warning: "bg-warning", danger: "bg-danger" } as const;

function ModelOptions() {
  return AI_MODEL_IDS.map((id) => (
    <option key={id} value={id}>
      {AI_MODELS[id].label}
    </option>
  ));
}

/**
 * Réglages → IA : l'assistant d'écriture des messages. Clé et limites visibles, modèles et mentions des risques dans
 * « Avancé » (un seul formulaire, mêmes champs qu'avant), usage du mois en cartes, historique en tableau de 5 colonnes
 * avec le détail au clic, guide de création de la clé. Lecture seule pour un MANAGER.
 */
export default async function AiSettingsPage({ searchParams }: PageProps<"/settings/ai">) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const sp = await searchParams;
  const [state, usage, history] = await Promise.all([
    loadAiConfigState(),
    monthUsage(),
    recentSuggestions(50),
  ]);
  const key = aiKeyView(state, { readOnly: !isAdmin });
  const cap = capUsage(usage.costEur, state.monthlyCapEur);
  const monthCost = aiCostFigure(usage.costEur);

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Assistant d'écriture (IA)"
        meta={<StatusPill tone={key.tone}>{key.pill}</StatusPill>}
        description="Il propose 3 versions de vos messages en respectant les règles du secteur : pas de promesse de gains, mention des risques, pas d'offre inventée."
        help={
          isAdmin
            ? "Première fois : créez la clé Anthropic (guide en bas de page, 5 minutes), collez-la ici, « Enregistrer » puis « Vérifier »."
            : "Lecture seule : seuls les administrateurs peuvent coller la clé ou changer les limites."
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        {isAdmin ? (
          <form action={saveAiSettingsAction} className="space-y-10">
            <FormSection
              title="Clé Anthropic"
              description="Chiffrée en base et jamais réaffichée. Sans clé, le bouton « Améliorer avec l'IA » explique où la coller."
            >
              <Alert variant={key.alert} role="status">
                <AlertTitle>{key.title}</AlertTitle>
                <AlertDescription>{key.sentence}</AlertDescription>
              </Alert>
              <div className="max-w-xl space-y-2">
                <Label htmlFor="apiKey">Clé API Anthropic</Label>
                <Input
                  id="apiKey"
                  name="apiKey"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    state.hasKey
                      ? "Laisser vide pour garder la clé actuelle"
                      : "Collez la clé sk-ant-…"
                  }
                  className="font-mono"
                  aria-describedby="apiKey-aide"
                />
                <p id="apiKey-aide" className="text-note text-muted-foreground">
                  {state.hasKey
                    ? `Clé actuelle : ${state.keyHint ?? "enregistrée"}. Collez-en une autre seulement pour la remplacer.`
                    : "Elle commence par « sk-ant- ». Collez-la entièrement, sans espace."}
                </p>
              </div>
            </FormSection>

            <FormSection
              title="Limites"
              description="Le plafond bloque l'assistant quand le coût estimé du mois est atteint."
            >
              <div className="grid max-w-xl gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="monthlyCapEur">Plafond mensuel (€)</Label>
                  <Input
                    id="monthlyCapEur"
                    name="monthlyCapEur"
                    type="number"
                    min={0}
                    step="1"
                    defaultValue={state.monthlyCapEur}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="perUserDailyLimit">Suggestions par personne et par jour</Label>
                  <Input
                    id="perUserDailyLimit"
                    name="perUserDailyLimit"
                    type="number"
                    min={1}
                    step="1"
                    defaultValue={state.perUserDailyLimit}
                  />
                </div>
              </div>
            </FormSection>

            <AdvancedSection
              title="Avancé : modèles et mention des risques"
              description="Les valeurs par défaut conviennent : le modèle rapide pour tout, la mention des risques des modèles installés."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="defaultModel">Modèle par défaut</Label>
                  <NativeSelect
                    id="defaultModel"
                    name="defaultModel"
                    defaultValue={state.defaultModel}
                    wrapperClassName="w-full"
                    aria-describedby="defaultModel-aide"
                  >
                    <ModelOptions />
                  </NativeSelect>
                  <p id="defaultModel-aide" className="text-note text-muted-foreground">
                    Utilisé pour toutes les suggestions. Haiku répond en quelques secondes pour une
                    fraction de centime.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="qualityModel">Modèle « qualité supérieure »</Label>
                  <NativeSelect
                    id="qualityModel"
                    name="qualityModel"
                    defaultValue={state.qualityModel}
                    wrapperClassName="w-full"
                    aria-describedby="qualityModel-aide"
                  >
                    <ModelOptions />
                  </NativeSelect>
                  <p id="qualityModel-aide" className="text-note text-muted-foreground">
                    Proposé par la case « Qualité supérieure » de l&apos;assistant, environ 20 fois
                    plus cher par suggestion.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="riskCasino">Mention des risques : Casino</Label>
                  <Textarea
                    id="riskCasino"
                    name="riskCasino"
                    rows={2}
                    defaultValue={state.riskNotice.casino}
                    aria-describedby="risk-aide"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="riskSports">Mention des risques : Paris sportifs</Label>
                  <Textarea
                    id="riskSports"
                    name="riskSports"
                    rows={2}
                    defaultValue={state.riskNotice.sports}
                    aria-describedby="risk-aide"
                  />
                </div>
                <p id="risk-aide" className="text-note text-muted-foreground md:col-span-2">
                  Ajoutée en fin de message (avec « 18+ ») quand elle manque. Même texte que les
                  modèles installés.
                </p>
              </div>
            </AdvancedSection>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-6">
              <Button type="submit" className="max-md:h-10">
                Enregistrer
              </Button>
              <Button
                type="submit"
                variant="outline"
                className="max-md:h-10"
                formAction={verifyAiKeyAction}
                formNoValidate
                disabled={!state.hasKey}
                title={state.hasKey ? undefined : "Collez d'abord une clé, puis enregistrez."}
              >
                Vérifier
              </Button>
              {state.hasKey ? (
                <ConfirmSubmit
                  variant="ghost"
                  className="text-danger max-md:h-10 sm:ml-auto"
                  formAction={removeAiKeyAction}
                  formNoValidate
                  destructive
                  confirmTitle={"Retirer la clé Anthropic\u00a0?"}
                  confirmLabel="Retirer la clé"
                  message="L'assistant sera désactivé pour toute l'équipe jusqu'à ce qu'une clé soit recollée. L'historique des suggestions reste."
                >
                  Retirer la clé
                </ConfirmSubmit>
              ) : null}
            </div>
          </form>
        ) : (
          <FormSection title="Réglages actuels">
            <Alert variant={key.alert} role="status">
              <AlertTitle>{key.title}</AlertTitle>
              <AlertDescription>{key.sentence}</AlertDescription>
            </Alert>
            <DetailList className="max-w-2xl">
              <DetailRow label="Clé">
                {state.hasKey ? `Enregistrée (${state.keyHint})` : "Aucune"}
              </DetailRow>
              <DetailRow label="Modèle par défaut">{aiModelLabel(state.defaultModel)}</DetailRow>
              <DetailRow label="Qualité supérieure">{aiModelLabel(state.qualityModel)}</DetailRow>
              <DetailRow label="Plafond mensuel">{fmtMoney(state.monthlyCapEur)}</DetailRow>
              <DetailRow label="Par personne et par jour">
                {fmtNum(state.perUserDailyLimit)} suggestions
              </DetailRow>
              <DetailRow label="Mention : Casino">{state.riskNotice.casino}</DetailRow>
              <DetailRow label="Mention : Paris sportifs">{state.riskNotice.sports}</DetailRow>
            </DetailList>
          </FormSection>
        )}

        <FormSection
          title="Usage du mois"
          description="Coût estimé d'après les prix publics d'Anthropic (1 $ = 0,92 €). La facture réelle est dans la console Anthropic."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Suggestions ce mois" value={fmtNum(usage.count)} />
            <StatCard
              label="Coût estimé"
              value={
                monthCost.lessThan ? (
                  <>
                    <span className="text-body font-normal text-muted-foreground">moins de </span>
                    {monthCost.amount}
                  </>
                ) : (
                  monthCost.amount
                )
              }
            />
            <StatCard
              label="Plafond mensuel"
              value={fmtMoney(state.monthlyCapEur)}
              hint={
                <span className="block space-y-1.5">
                  <span
                    className="block h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Part du plafond mensuel utilisée"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={cap.pct}
                  >
                    <span
                      className={cn("block h-full rounded-full", BAR_TONES[cap.tone])}
                      style={{ width: `${cap.pct}%` }}
                    />
                  </span>
                  <span className="block">{cap.sentence}</span>
                </span>
              }
            />
          </div>
          {usage.byUser.length ? (
            <DataTable
              className="max-w-2xl"
              label="Usage du mois par personne"
              columns={[
                { key: "name", header: "Personne" },
                { key: "count", header: "Suggestions", align: "right", hideOnMobile: true },
                { key: "cost", header: "Coût estimé", align: "right" },
              ]}
              rows={usage.byUser.map((u) => ({
                id: u.userId,
                cells: {
                  name: u.name,
                  count: fmtNum(u.count),
                  cost: aiCostFigure(u.costEur).text,
                },
                sortValues: { count: u.count, cost: u.costEur },
              }))}
            />
          ) : null}
        </FormSection>

        <FormSection
          title="Historique"
          description="Les 50 dernières demandes : qui, quoi, combien, et si une version a été utilisée. Les textes ne sont pas affichés."
        >
          <DataTable
            label="Historique des suggestions"
            columns={[
              { key: "when", header: "Quand" },
              { key: "who", header: "Qui", hideOnMobile: true },
              { key: "kind", header: "Demande" },
              { key: "cost", header: "Coût", align: "right", hideOnMobile: true },
              { key: "used", header: "Utilisée", hideOnMobile: true },
            ]}
            rows={history.map((h) => {
              const cost = fmtMoney(Number(h.costEur), "EUR", { digits: 4 });
              return {
                id: h.id,
                cells: {
                  when: fmtDate(h.createdAt),
                  who: h.user.name,
                  kind: aiKindLabel(h.kind),
                  cost,
                  used: aiUsedLabel(h),
                },
                sortValues: { when: h.createdAt, cost: Number(h.costEur) },
                detailTitle: aiKindLabel(h.kind),
                detailDescription: `${h.user.name} · ${fmtDate(h.createdAt)}`,
                detail: (
                  <DetailList>
                    <DetailRow label="Écran">{aiSurfaceLabel(h.context)}</DetailRow>
                    <DetailRow label="Univers">{aiUniverseLabel(h.context)}</DetailRow>
                    <DetailRow label="Modèle">{aiModelLabel(h.model)}</DetailRow>
                    <DetailRow label="Jetons">{aiTokensLabel(h)}</DetailRow>
                    <DetailRow label="Coût estimé">{cost}</DetailRow>
                    <DetailRow label="Version utilisée">{aiUsedLabel(h)}</DetailRow>
                  </DetailList>
                ),
              };
            })}
            empty={{
              title: "Aucune suggestion pour l'instant",
              description:
                "Dès qu'un membre de l'équipe cliquera sur « Améliorer avec l'IA », ses demandes apparaîtront ici.",
            }}
          />
        </FormSection>

        {isAdmin ? (
          state.hasKey ? (
            <AdvancedSection
              title="Guide : créer une nouvelle clé Anthropic"
              description="Seulement pour remplacer ou révoquer la clé actuelle."
            >
              <AnthropicKeyGuide />
            </AdvancedSection>
          ) : (
            <FormSection
              title="Créer la clé Anthropic (une seule fois, 5 minutes)"
              description="L'assistant utilise les modèles Claude d'Anthropic : il faut un compte sur leur console, un moyen de paiement, puis une clé à coller ci-dessus."
            >
              <AnthropicKeyGuide />
            </FormSection>
          )
        ) : null}
      </div>
    </>
  );
}
