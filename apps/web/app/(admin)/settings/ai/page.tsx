import type { Metadata } from "next";
import Link from "next/link";
import { AI_LABELS, AI_MODELS, AI_MODEL_IDS, type AiKind, type AiSurface, type AiVertical } from "@linkaffipro/ai";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { loadAiConfigState } from "@/lib/ai/config";
import { monthUsage, recentSuggestions } from "@/lib/ai/usage";
import { requireUser } from "@/lib/session";
import { removeAiKeyAction, saveAiSettingsAction, verifyAiKeyAction } from "./actions";
import { AnthropicKeyGuide } from "./guide";

export const metadata: Metadata = { title: "Réglages · IA" };
export const dynamic = "force-dynamic";

const selectCls = "h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9";

function kindLabel(kind: string): string {
  return kind in AI_LABELS.kind ? AI_LABELS.kind[kind as AiKind] : kind;
}
function surfaceLabel(ctx: unknown): string {
  const s = (ctx as { surface?: string } | null)?.surface;
  return s && s in AI_LABELS.surface ? AI_LABELS.surface[s as AiSurface] : "—";
}
function verticalLabel(ctx: unknown): string {
  const v = (ctx as { vertical?: string } | null)?.vertical;
  return v && v in AI_LABELS.vertical ? AI_LABELS.vertical[v as AiVertical] : "—";
}
function modelLabel(id: string): string {
  return id in AI_MODELS ? AI_MODELS[id as keyof typeof AI_MODELS].label : id;
}

export default async function AiSettingsPage({ searchParams }: PageProps<"/settings/ai">) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const sp = await searchParams;
  const [state, usage, history] = await Promise.all([loadAiConfigState(), monthUsage(), recentSuggestions(50)]);
  const capRatio = state.monthlyCapEur > 0 ? Math.min(1, usage.costEur / state.monthlyCapEur) : 0;

  return (
    <>
      <PageHeader
        title="Réglages · IA"
        description="Assistant d'écriture des messages : il propose 3 versions d'un brouillon (canaux, bot, envois groupés, modèles, automatisations) en respectant les règles du secteur (pas de promesse de gains, mention des risques, pas d'offre inventée)."
        help={
          isAdmin
            ? "Première fois : créez la clé API Anthropic (guide en bas de page, 5 minutes), collez-la ici, Enregistrer puis Vérifier."
            : "Lecture seule : seuls les administrateurs peuvent coller la clé ou changer les limites."
        }
      >
        <Button variant="ghost" size="sm" className="max-md:h-10" render={<Link href="/settings" />}>
          ← Réglages
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clé API Anthropic, modèles et limites</CardTitle>
            <CardDescription>La clé est chiffrée en base et jamais réaffichée. Le plafond mensuel bloque l&apos;assistant quand le coût estimé du mois est atteint.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.hasKey ? (
              <Alert variant={state.lastError ? "destructive" : "default"}>
                <AlertTitle>
                  {state.verifiedAt ? `Clé vérifiée le ${fmtDate(new Date(state.verifiedAt))}` : state.lastError ? "Clé refusée" : "Clé enregistrée, pas encore vérifiée"}
                </AlertTitle>
                <AlertDescription>
                  {state.lastError
                    ? state.lastError
                    : state.verifiedAt
                      ? `Anthropic accepte la clé (${state.keyHint}). L'assistant est actif.`
                      : `Clé ${state.keyHint} enregistrée. Cliquez sur « Vérifier » pour la tester (un appel de quelques jetons).`}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertTitle>Aucune clé enregistrée</AlertTitle>
                <AlertDescription>L&apos;assistant est désactivé : le bouton « ✨ Améliorer avec l&apos;IA » explique où coller la clé. Suivez le guide en bas de page.</AlertDescription>
              </Alert>
            )}

            {isAdmin ? (
              <form action={saveAiSettingsAction} className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="apiKey">Clé API Anthropic</Label>
                  <Input
                    id="apiKey"
                    name="apiKey"
                    type="password"
                    autoComplete="new-password"
                    placeholder={state.hasKey ? "•••••••• (laisser vide = inchangée)" : "Collez la clé sk-ant-…"}
                    className="h-10 font-mono md:h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="defaultModel" className="flex items-center gap-1">
                    Modèle par défaut
                    <HelpTip>Utilisé pour toutes les suggestions. Haiku : réponse en quelques secondes pour une fraction de centime.</HelpTip>
                  </Label>
                  <select id="defaultModel" name="defaultModel" defaultValue={state.defaultModel} className={selectCls}>
                    {AI_MODEL_IDS.map((id) => (
                      <option key={id} value={id}>
                        {AI_MODELS[id].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="qualityModel" className="flex items-center gap-1">
                    Modèle « qualité supérieure »
                    <HelpTip>Proposé en option dans le panneau de l&apos;assistant (case « Qualité supérieure »), environ 20 fois plus cher par suggestion.</HelpTip>
                  </Label>
                  <select id="qualityModel" name="qualityModel" defaultValue={state.qualityModel} className={selectCls}>
                    {AI_MODEL_IDS.map((id) => (
                      <option key={id} value={id}>
                        {AI_MODELS[id].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="monthlyCapEur">Plafond mensuel (€)</Label>
                  <Input id="monthlyCapEur" name="monthlyCapEur" type="number" min={0} step="1" defaultValue={state.monthlyCapEur} className="h-10 md:h-9" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="perUserDailyLimit">Suggestions par personne et par jour</Label>
                  <Input id="perUserDailyLimit" name="perUserDailyLimit" type="number" min={1} step="1" defaultValue={state.perUserDailyLimit} className="h-10 md:h-9" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="riskCasino" className="flex items-center gap-1">
                    Mention des risques — casino
                    <HelpTip>Ajoutée automatiquement en fin de message (avec « 18+ ») si elle manque. Même texte que les modèles installés.</HelpTip>
                  </Label>
                  <Textarea id="riskCasino" name="riskCasino" rows={2} defaultValue={state.riskNotice.casino} className="text-sm" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="riskSports">Mention des risques — paris sportifs</Label>
                  <Textarea id="riskSports" name="riskSports" rows={2} defaultValue={state.riskNotice.sports} className="text-sm" />
                </div>
                <div className="flex flex-wrap gap-2 md:col-span-2">
                  <Button type="submit" className="max-md:h-10">
                    Enregistrer
                  </Button>
                  <Button type="submit" variant="outline" className="max-md:h-10" formAction={verifyAiKeyAction} disabled={!state.hasKey}>
                    Vérifier
                  </Button>
                </div>
              </form>
            ) : (
              <dl className="grid gap-2 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Clé API</dt>
                  <dd>{state.hasKey ? `Enregistrée (${state.keyHint})` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Modèles</dt>
                  <dd>
                    {modelLabel(state.defaultModel)} · qualité supérieure : {modelLabel(state.qualityModel)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Plafond mensuel</dt>
                  <dd>{fmtMoney(state.monthlyCapEur)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Limite par personne et par jour</dt>
                  <dd>{fmtNum(state.perUserDailyLimit)} suggestions</dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-muted-foreground">Mention des risques (casino / paris)</dt>
                  <dd>
                    {state.riskNotice.casino} / {state.riskNotice.sports}
                  </dd>
                </div>
              </dl>
            )}
            {isAdmin && state.hasKey ? (
              <form action={removeAiKeyAction}>
                <ConfirmSubmit variant="outline" size="sm" message="Retirer la clé ? L'assistant sera désactivé jusqu'à ce qu'une clé soit recollée.">
                  Retirer la clé
                </ConfirmSubmit>
              </form>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage du mois</CardTitle>
            <CardDescription>Coût estimé d&apos;après les prix publics d&apos;Anthropic (taux fixe 1 $ = 0,92 €). La facture réelle est dans la console Anthropic.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Suggestions ce mois</div>
                <div className="text-2xl font-semibold">{fmtNum(usage.count)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Coût estimé</div>
                <div className="text-2xl font-semibold">{fmtMoney(usage.costEur, "EUR", { digits: usage.costEur < 1 ? 4 : 2 })}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Plafond</div>
                <div className="text-2xl font-semibold">{fmtMoney(state.monthlyCapEur)}</div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-label="Part du plafond mensuel utilisée" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(capRatio * 100)}>
                  <div className={`h-full ${capRatio >= 0.9 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.round(capRatio * 100)}%` }} />
                </div>
              </div>
            </div>
            {usage.byUser.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Personne</TableHead>
                    <TableHead className="text-right">Suggestions</TableHead>
                    <TableHead className="text-right">Coût estimé</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.byUser.map((u) => (
                    <TableRow key={u.userId}>
                      <TableCell>{u.name}</TableCell>
                      <TableCell className="text-right">{fmtNum(u.count)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(u.costEur, "EUR", { digits: 4 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune suggestion ce mois-ci.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historique (50 dernières suggestions)</CardTitle>
            <CardDescription>Qui a demandé quoi, pour quel écran, à quel coût, et si une version a été utilisée. Les textes ne sont pas affichés ici.</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <EmptyState title="Aucune suggestion pour l'instant" description="Dès qu'un membre de l'équipe cliquera sur « ✨ Améliorer avec l'IA », les demandes apparaîtront ici." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quand</TableHead>
                    <TableHead>Qui</TableHead>
                    <TableHead>Demande</TableHead>
                    <TableHead>Écran</TableHead>
                    <TableHead>Univers</TableHead>
                    <TableHead>Modèle</TableHead>
                    <TableHead className="text-right">Jetons</TableHead>
                    <TableHead className="text-right">Coût</TableHead>
                    <TableHead>Utilisée</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap">{fmtDate(h.createdAt)}</TableCell>
                      <TableCell>{h.user.name}</TableCell>
                      <TableCell>{kindLabel(h.kind)}</TableCell>
                      <TableCell>{surfaceLabel(h.context)}</TableCell>
                      <TableCell>{verticalLabel(h.context)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{h.model}</TableCell>
                      <TableCell className="text-right text-xs">
                        {fmtNum(h.inputTokens)} / {fmtNum(h.outputTokens)}
                        {h.cachedTokens ? ` (${fmtNum(h.cachedTokens)} en cache)` : ""}
                      </TableCell>
                      <TableCell className="text-right">{fmtMoney(Number(h.costEur), "EUR", { digits: 4 })}</TableCell>
                      <TableCell>{h.usedIndex === null ? "Non" : `Oui (version ${h.usedIndex + 1})`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {isAdmin ? <AnthropicKeyGuide /> : null}
      </div>
    </>
  );
}
