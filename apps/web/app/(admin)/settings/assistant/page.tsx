import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { StatCard } from "@/components/admin/stat-card";
import { StatusPill } from "@/components/admin/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { fmtMoney, fmtNum } from "@/lib/format";
import { loadAssistantConfigState } from "@/lib/assistant/config";
import { monthUsage } from "@/lib/assistant/usage";
import { requireAdminPage } from "@/lib/session";
import { aiCostFigure } from "../ai/ai-view";
import {
  removeAssistantKeyAction,
  saveAssistantSettingsAction,
  verifyAssistantKeyAction,
} from "./actions";
import {
  ACTIVATION_OPTIONS,
  activationView,
  assistantCapUsage,
  assistantKeyView,
  modelOptions,
  modelsFetchedLabel,
} from "./assistant-view";
import { VeniceKeyGuide } from "./guide";

export const metadata: Metadata = { title: "Réglages · IA de conversation" };
export const dynamic = "force-dynamic";

const BAR_TONES = { brand: "bg-brand-ink", warning: "bg-warning", danger: "bg-danger" } as const;

function ModelSelect({
  id,
  options,
  value,
  describedBy,
}: {
  id: string;
  options: ReturnType<typeof modelOptions>;
  value: string;
  describedBy: string;
}) {
  return (
    <NativeSelect
      id={id}
      name={id}
      defaultValue={value}
      wrapperClassName="w-full"
      aria-describedby={describedBy}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

/**
 * Réglages → IA de conversation (ADMIN seulement) : l'IA (Venice) de l'assistant qui discute en privé sur le bot de
 * conversation. Clé (jamais renvoyée au navigateur), « Vérifier » (gratuit : solde, limites et liste des modèles),
 * activation (désactivé par défaut), limites, modèles dans « Avancé », dépense du mois, guide de création de la clé.
 * Un seul bouton orange : « Enregistrer ». Contrat : docs/ASSISTANT-CONVERSATION.md § 2 et § 6.
 */
export default async function AssistantSettingsPage({
  searchParams,
}: PageProps<"/settings/assistant">) {
  await requireAdminPage();
  const sp = await searchParams;
  const [state, usage] = await Promise.all([loadAssistantConfigState(), monthUsage()]);
  const key = assistantKeyView(state);
  const activation = activationView(state.activation);
  const cap = assistantCapUsage(usage.costEur, state.monthlyCapEur);
  const monthCost = aiCostFigure(usage.costEur);
  const defaultOptions = modelOptions(state.models, state.defaultModel);
  const fallbackOptions = modelOptions(state.models, state.fallbackModel);

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="IA de conversation"
        meta={<StatusPill tone={activation.tone}>{activation.pill}</StatusPill>}
        description="L'assistant qui discute en privé avec les personnes qui écrivent d'elles-mêmes au bot de conversation (Rencontres), et leur présente l'offre au bon moment."
        help="Première fois : créez la clé Venice (guide en bas de page), collez-la puis cliquez sur « Vérifier » (la clé collée est enregistrée et testée). Essayez d'abord avec « Seulement l'équipe (essai) »."
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        <form action={saveAssistantSettingsAction} className="space-y-10">
          <FormSection
            title="Clé Venice"
            description="Chiffrée en base et jamais réaffichée. Elle sert seulement à l'assistant de conversation."
          >
            <Alert variant={key.alert} role="status" className="max-w-xl">
              <AlertTitle>{key.title}</AlertTitle>
              <AlertDescription>{key.sentence}</AlertDescription>
            </Alert>
            <div className="max-w-xl space-y-2">
              <Label htmlFor="apiKey">Clé Venice</Label>
              <Input
                id="apiKey"
                name="apiKey"
                type="password"
                autoComplete="new-password"
                placeholder={
                  state.hasKey ? "Laisser vide pour garder la clé actuelle" : "Collez la clé Venice"
                }
                className="font-mono"
                aria-describedby="apiKey-aide"
              />
              <p id="apiKey-aide" className="text-note text-muted-foreground">
                {state.hasKey
                  ? `Clé actuelle : ${state.keyHint ?? "enregistrée"}. Collez-en une autre seulement pour la remplacer.`
                  : "Collez-la entièrement, sans espace (guide en bas de page)."}
              </p>
            </div>
          </FormSection>

          <FormSection
            title="Qui reçoit une réponse"
            description="Désactivé par défaut. L'assistant ne répond qu'aux personnes qui lui ont écrit d'elles-mêmes, jamais à froid."
          >
            <div className="max-w-xl space-y-2">
              <Label htmlFor="activation">L&apos;assistant répond à</Label>
              <NativeSelect
                id="activation"
                name="activation"
                defaultValue={state.activation}
                wrapperClassName="w-full"
                aria-describedby="activation-aide"
              >
                {ACTIVATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
              <p id="activation-aide" className="text-note text-muted-foreground">
                {activation.sentence}
              </p>
            </div>
          </FormSection>

          <FormSection
            title="Limites"
            description="Le plafond arrête l'assistant quand le coût estimé du mois est atteint ; la limite par conversation évite qu'une seule personne coûte trop cher."
          >
            <div className="grid max-w-xl gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="monthlyCapEur">Plafond mensuel (€)</Label>
                <Input
                  id="monthlyCapEur"
                  name="monthlyCapEur"
                  type="number"
                  min={0}
                  max={100000}
                  step="1"
                  required
                  defaultValue={state.monthlyCapEur}
                  aria-describedby="monthlyCapEur-aide"
                />
                <p id="monthlyCapEur-aide" className="text-note text-muted-foreground">
                  0 € : aucune réponse.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="perConversationDailyLimit">
                  Réponses par jour et par conversation
                </Label>
                <Input
                  id="perConversationDailyLimit"
                  name="perConversationDailyLimit"
                  type="number"
                  min={1}
                  max={1000}
                  step="1"
                  required
                  defaultValue={state.perConversationDailyLimit}
                />
              </div>
            </div>
          </FormSection>

          <AdvancedSection
            title="Avancé : modèles, créativité et longueur"
            description="Les valeurs par défaut conviennent. Le modèle de repli sert quand le modèle par défaut est surchargé."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="defaultModel">Modèle par défaut</Label>
                <ModelSelect
                  id="defaultModel"
                  options={defaultOptions}
                  value={state.defaultModel}
                  describedBy="models-aide"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fallbackModel">Modèle de repli</Label>
                <ModelSelect
                  id="fallbackModel"
                  options={fallbackOptions}
                  value={state.fallbackModel}
                  describedBy="models-aide"
                />
              </div>
              <p id="models-aide" className="text-note text-muted-foreground md:col-span-2">
                Prix de Venice en dollars, du moins cher au plus cher.{" "}
                {modelsFetchedLabel(state.modelsFetchedAt)}
              </p>
              <div className="space-y-2">
                <Label htmlFor="temperature">Créativité des réponses</Label>
                <Input
                  id="temperature"
                  name="temperature"
                  type="number"
                  min={0}
                  max={2}
                  step="0.05"
                  required
                  defaultValue={state.temperature}
                  aria-describedby="temperature-aide"
                />
                <p id="temperature-aide" className="text-note text-muted-foreground">
                  De 0 (toujours la même réponse) à 2 (très libre). Conseillé : 0,85.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxTokens">Longueur maximale des réponses</Label>
                <Input
                  id="maxTokens"
                  name="maxTokens"
                  type="number"
                  min={64}
                  max={2000}
                  step="1"
                  required
                  defaultValue={state.maxTokens}
                  aria-describedby="maxTokens-aide"
                />
                <p id="maxTokens-aide" className="text-note text-muted-foreground">
                  En jetons (un jeton vaut environ trois quarts de mot), de 64 à 2 000. Conseillé :
                  400.
                </p>
              </div>
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
              formAction={verifyAssistantKeyAction}
              formNoValidate
              title="Vérification de la clé collée dans le champ, sinon de la clé enregistrée"
            >
              Vérifier
            </Button>
            {state.hasKey ? (
              <ConfirmSubmit
                variant="ghost"
                className="text-danger max-md:h-10 sm:ml-auto"
                formAction={removeAssistantKeyAction}
                formNoValidate
                destructive
                confirmTitle={"Retirer la clé Venice ?"}
                confirmLabel="Retirer la clé"
                message="L'assistant sera désactivé et ne répondra plus à personne jusqu'à ce qu'une clé soit recollée. Les conversations et l'historique des coûts restent."
              >
                Retirer la clé
              </ConfirmSubmit>
            ) : null}
          </div>
        </form>

        <FormSection
          title="Dépense du mois"
          description="Coût estimé d'après les prix de Venice (1 $ = 0,92 €), compté depuis le 1er du mois. La facture réelle est dans votre compte Venice."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Coût estimé ce mois"
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
            <StatCard
              label="Conversations ce mois"
              value={fmtNum(usage.conversations)}
              hint={`${fmtNum(usage.calls)} appel${usage.calls > 1 ? "s" : ""} à l'IA${usage.failed ? `, dont ${fmtNum(usage.failed)} en échec` : ""}`}
            />
          </div>
        </FormSection>

        {state.hasKey ? (
          <AdvancedSection
            title="Guide : créer une nouvelle clé Venice"
            description="Seulement pour remplacer ou révoquer la clé actuelle."
          >
            <VeniceKeyGuide />
          </AdvancedSection>
        ) : (
          <FormSection
            title="Créer la clé Venice (une seule fois, 5 minutes)"
            description="L'assistant utilise les modèles de Venice : il faut un compte Venice avec du crédit, puis une clé à coller ci-dessus."
          >
            <VeniceKeyGuide />
          </FormSection>
        )}
      </div>
    </>
  );
}
