import {
  AUTOMATION_TRIGGERS,
  AUTOMATION_TRIGGER_LABELS,
  AUTOMATION_ACTION_LABELS,
  MAX_ACTIONS,
  SPEND_LEVELS,
  SPEND_LEVEL_LABELS,
  type AutomationAction,
  type AutomationConditions,
} from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { statusLabel } from "@/lib/status-badges";

const SEQ = [
  "JOIN_REQUEST",
  "GATE_REMINDER",
  "GATE_SATISFIED",
  "APPROVED",
  "START",
  "OFFER_REPLY",
] as const;
const ACTION_TYPES = Object.keys(AUTOMATION_ACTION_LABELS) as Array<AutomationAction["type"]>;

export type RuleFormValues = {
  ruleId?: string;
  name: string;
  trigger: string;
  conditions: AutomationConditions;
  actions: AutomationAction[];
  oncePerMember: boolean;
};

/** Formulaire serveur d'une règle (création ou modification). */
export async function RuleForm({
  values,
  action,
  submitLabel,
}: {
  values: RuleFormValues;
  action: (fd: FormData) => Promise<void>;
  submitLabel: string;
}) {
  const [channels, campaigns, categories, bots, media] = await Promise.all([
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    prisma.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.messageCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.bot.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, username: true },
    }),
    prisma.mediaAsset.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, filename: true },
    }),
  ]);
  const c = values.conditions;
  const sel = "h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9";
  const rows = Array.from({ length: MAX_ACTIONS }, (_, i) => values.actions[i] ?? null);
  const text = (a: AutomationAction | null) => (a && "text" in a ? (a.text ?? "") : "");
  return (
    <form action={action} className="space-y-6">
      {values.ruleId ? <input type="hidden" name="ruleId" value={values.ruleId} /> : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Si…</CardTitle>
          <CardDescription>
            L&apos;événement qui lance la règle et, si vous voulez, des conditions (toutes doivent
            être vraies). Sans condition, la règle s&apos;applique à tous les membres concernés.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Nom de la règle</Label>
              <Input
                id="name"
                name="name"
                defaultValue={values.name}
                required
                minLength={2}
                maxLength={80}
                className="h-10 md:h-9"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="trigger">Déclencheur</Label>
              <select id="trigger" name="trigger" defaultValue={values.trigger} className={sel}>
                {AUTOMATION_TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {AUTOMATION_TRIGGER_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <fieldset className="space-y-1 text-sm">
              <legend className="mb-1 font-medium">Canaux</legend>
              {channels.map((ch) => (
                <label key={ch.id} className="flex min-h-8 items-center gap-2">
                  <input
                    type="checkbox"
                    name="channelIds"
                    value={ch.id}
                    defaultChecked={c.channelIds?.includes(ch.id)}
                    className="size-4"
                  />{" "}
                  {ch.title}
                </label>
              ))}
              {channels.length === 0 ? (
                <span className="text-muted-foreground">aucun canal</span>
              ) : null}
            </fieldset>
            <fieldset className="space-y-1 text-sm">
              <legend className="mb-1 font-medium">Pubs</legend>
              {campaigns.map((p) => (
                <label key={p.id} className="flex min-h-8 items-center gap-2">
                  <input
                    type="checkbox"
                    name="campaignIds"
                    value={p.id}
                    defaultChecked={c.campaignIds?.includes(p.id)}
                    className="size-4"
                  />{" "}
                  {p.name}
                </label>
              ))}
              {campaigns.length === 0 ? (
                <span className="text-muted-foreground">aucune pub</span>
              ) : null}
            </fieldset>
            <fieldset className="space-y-1 text-sm">
              <legend className="mb-1 font-medium">Niveau de dépense</legend>
              {SPEND_LEVELS.map((l) => (
                <label key={l} className="flex min-h-8 items-center gap-2">
                  <input
                    type="checkbox"
                    name="spendLevels"
                    value={l}
                    defaultChecked={c.spendLevels?.includes(l)}
                    className="size-4"
                  />{" "}
                  {SPEND_LEVEL_LABELS[l]}
                </label>
              ))}
            </fieldset>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="languages">
                Langues (codes séparés par des virgules, ex. fr, en)
              </Label>
              <Input
                id="languages"
                name="languages"
                defaultValue={(c.languages ?? []).join(", ")}
                className="h-10 md:h-9"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inactiveDays">
                Jours sans activité (obligatoire pour le déclencheur « Inactivité »)
              </Label>
              <Input
                id="inactiveDays"
                name="inactiveDays"
                type="number"
                min={1}
                max={3650}
                defaultValue={c.inactiveDays ?? ""}
                className="h-10 md:h-9"
              />
            </div>
            <fieldset className="space-y-1 text-sm">
              <legend className="mb-1 font-medium">Catégorie du message cliqué (offres)</legend>
              {categories.map((k) => (
                <label key={k.id} className="flex min-h-8 items-center gap-2">
                  <input
                    type="checkbox"
                    name="categoryIds"
                    value={k.id}
                    defaultChecked={c.categoryIds?.includes(k.id)}
                    className="size-4"
                  />{" "}
                  {k.name}
                </label>
              ))}
            </fieldset>
          </div>
          <label className="flex min-h-8 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="oncePerMember"
              defaultChecked={values.oncePerMember}
              className="size-4"
            />{" "}
            Une seule fois par membre (recommandé : évite de relancer plusieurs fois la même
            personne)
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alors…</CardTitle>
          <CardDescription>
            Jusqu&apos;à {MAX_ACTIONS} actions, exécutées dans l&apos;ordre. Mots remplacés
            automatiquement : {"{prenom}"}, {"{canal}"}, {"{bot}"}. Mise en forme Telegram autorisée
            (b, i, u, s, a, code). Remplissez seulement les champs utiles à chaque action.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.map((a, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 md:grid-cols-[180px_1fr]">
              <div className="space-y-1">
                <Label htmlFor={`a${i}_type`}>Action {i + 1}</Label>
                <select
                  id={`a${i}_type`}
                  name={`a${i}_type`}
                  defaultValue={a?.type ?? ""}
                  className={sel}
                >
                  <option value="">— aucune —</option>
                  {ACTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {AUTOMATION_ACTION_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor={`a${i}_text`}>
                    Texte (pour « envoyer un message », « proposer un canal » ou « prévenir
                    l&apos;équipe »)
                  </Label>
                  <textarea
                    id={`a${i}_text`}
                    name={`a${i}_text`}
                    defaultValue={text(a)}
                    rows={2}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`a${i}_buttons`}>
                    Boutons du message (une ligne par bouton : Libellé | https://…)
                  </Label>
                  <textarea
                    id={`a${i}_buttons`}
                    name={`a${i}_buttons`}
                    defaultValue={
                      a?.type === "send_message"
                        ? (a.buttons ?? [])
                            .map((r) => r.map((b) => `${b.text} | ${b.url}`).join("\n"))
                            .join("\n")
                        : ""
                    }
                    rows={2}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`a${i}_hours`}>Attendre (heures, pour « attendre »)</Label>
                    <Input
                      id={`a${i}_hours`}
                      name={`a${i}_hours`}
                      type="number"
                      step="0.5"
                      min={0.1}
                      defaultValue={a?.type === "wait" ? a.hours : ""}
                      className="h-10 md:h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`a${i}_tag`}>Étiquette (pour « étiqueter »)</Label>
                    <Input
                      id={`a${i}_tag`}
                      name={`a${i}_tag`}
                      defaultValue={a?.type === "tag" ? a.tag : ""}
                      maxLength={40}
                      className="h-10 md:h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`a${i}_channelId`}>
                      Canal à proposer (pour « proposer un canal »)
                    </Label>
                    <select
                      id={`a${i}_channelId`}
                      name={`a${i}_channelId`}
                      defaultValue={a?.type === "suggest_channel" ? a.channelId : ""}
                      className={sel}
                    >
                      <option value="">—</option>
                      {channels.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`a${i}_trigger`}>
                      Séquence du canal à envoyer (pour « envoyer une séquence »)
                    </Label>
                    <select
                      id={`a${i}_trigger`}
                      name={`a${i}_trigger`}
                      defaultValue={a?.type === "send_sequence" ? a.trigger : ""}
                      className={sel}
                    >
                      <option value="">—</option>
                      {SEQ.map((t) => (
                        <option key={t} value={t}>
                          {statusLabel("sequenceTrigger", t)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`a${i}_botId`}>
                      Bot expéditeur (pour « envoyer un message »)
                    </Label>
                    <select
                      id={`a${i}_botId`}
                      name={`a${i}_botId`}
                      defaultValue={a?.type === "send_message" ? (a.botId ?? "") : ""}
                      className={sel}
                    >
                      <option value="">bot du canal</option>
                      {bots.map((b) => (
                        <option key={b.id} value={b.id}>
                          @{b.username}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`a${i}_mediaAssetId`}>
                      Média joint (pour « envoyer un message »)
                    </Label>
                    <select
                      id={`a${i}_mediaAssetId`}
                      name={`a${i}_mediaAssetId`}
                      defaultValue={a?.type === "send_message" ? (a.mediaAssetId ?? "") : ""}
                      className={sel}
                    >
                      <option value="">aucun</option>
                      {media.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.filename}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Button type="submit" className="max-md:h-10">
        {submitLabel}
      </Button>
    </form>
  );
}
