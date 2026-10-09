import { prisma } from "@linkaffipro/db";
import { PLACEHOLDERS, SEQUENCE_TRIGGERS, TRIGGER_HELP, TRIGGER_LABELS, ensureDefaultSequences, previewText } from "@linkaffipro/telegram";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addSequenceLangAction, removeSequenceLangAction, saveSequenceTextAction, sendSequenceTestAction, toggleSequenceAction  } from "./actions";
import { SEQUENCE_LANGS } from "./langs";

const LANG_LABELS: Record<string, string> = { fr: "Français", en: "Anglais", es: "Espagnol", pt: "Portugais", de: "Allemand", it: "Italien", ar: "Arabe", tr: "Turc", nl: "Néerlandais", pl: "Polonais", ro: "Roumain", ru: "Russe" };

/** Rendu simplifié du HTML Telegram pour l'aperçu (balises déjà validées à l'enregistrement). */
function previewHtml(text: string): string {
  return text.replace(/\n/g, "<br/>");
}

export async function SequencesTab({ channelId, channelTitle, open, telegramLinked }: { channelId: string; channelTitle: string; open: string | undefined; telegramLinked: boolean }) {
  await ensureDefaultSequences(channelId);
  const sequences = await prisma.sequence.findMany({ where: { channelId }, include: { steps: { orderBy: { order: "asc" }, take: 1 } } });
  const byTrigger = new Map(sequences.map((s) => [s.trigger as string, s]));
  const openKey = open ?? "JOIN_REQUEST";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          <p>Ces messages sont envoyés en privé par le bot du canal. Le français est obligatoire ; ajoutez une langue pour les membres dont Telegram est dans cette langue (sinon le français est utilisé).</p>
          <p className="mt-2">Mots magiques : {PLACEHOLDERS.map((p) => <span key={p.key} className="mr-2 font-mono text-xs">{p.key}</span>)} — remplacés automatiquement (prénom, nom du canal, canaux à rejoindre, délai, bot). Mise en forme : &lt;b&gt;gras&lt;/b&gt;, &lt;i&gt;italique&lt;/i&gt;, &lt;a href=&quot;…&quot;&gt;lien&lt;/a&gt;.</p>
          {!telegramLinked ? <p className="mt-2 text-amber-700">Pour « Envoyer un test », liez votre Telegram dans Mon compte (menu en haut à droite).</p> : null}
        </CardContent>
      </Card>

      {SEQUENCE_TRIGGERS.map((trigger) => {
        const seq = byTrigger.get(trigger);
        const step = seq?.steps[0];
        const texts = (step?.texts && typeof step.texts === "object" ? (step.texts as Record<string, string>) : {}) as Record<string, string>;
        const langs = ["fr", ...Object.keys(texts).filter((l) => l !== "fr").sort()];
        const missing = SEQUENCE_LANGS.filter((l) => !(l in texts) && l !== "fr");
        const isOpen = openKey === trigger;
        return (
          <Card key={trigger} id={trigger}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">
                  {TRIGGER_LABELS[trigger]} {seq && !seq.isActive ? <Badge variant="secondary" className="ml-2">désactivée</Badge> : <Badge variant="outline" className="ml-2">{langs.length} langue{langs.length > 1 ? "s" : ""}</Badge>}
                </CardTitle>
                <CardDescription>{TRIGGER_HELP[trigger]}</CardDescription>
              </div>
              <div className="flex shrink-0 gap-2">
                {!isOpen ? (
                  <Button variant="outline" size="sm" render={<a href={`/channels/${channelId}?tab=sequences&open=${trigger}#${trigger}`} />}>Modifier</Button>
                ) : null}
                <form action={toggleSequenceAction}>
                  <input type="hidden" name="channelId" value={channelId} />
                  <input type="hidden" name="trigger" value={trigger} />
                  <Button type="submit" variant="ghost" size="sm">{seq?.isActive === false ? "Activer" : "Désactiver"}</Button>
                </form>
              </div>
            </CardHeader>
            {isOpen ? (
              <CardContent className="space-y-6">
                {langs.map((lang) => (
                  <div key={lang} className="grid gap-4 lg:grid-cols-2">
                    <form action={saveSequenceTextAction} className="space-y-2">
                      <input type="hidden" name="channelId" value={channelId} />
                      <input type="hidden" name="trigger" value={trigger} />
                      <input type="hidden" name="lang" value={lang} />
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`${trigger}-${lang}`}>{LANG_LABELS[lang] ?? lang.toUpperCase()}{lang === "fr" ? " (obligatoire)" : ""}</Label>
                        {lang !== "fr" ? (
                          <Button type="submit" formAction={removeSequenceLangAction} variant="ghost" size="sm" className="text-destructive">Retirer cette langue</Button>
                        ) : null}
                      </div>
                      <Textarea id={`${trigger}-${lang}`} name="text" defaultValue={texts[lang] ?? ""} rows={6} className="font-mono text-xs" required={lang === "fr"} />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm">Enregistrer</Button>
                        <Button type="submit" formAction={sendSequenceTestAction} size="sm" variant="outline" disabled={!telegramLinked}>Envoyer un test</Button>
                      </div>
                    </form>
                    <div className="space-y-1">
                      <Label>Aperçu ({LANG_LABELS[lang] ?? lang})</Label>
                      <div className="rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: previewHtml(previewText(texts[lang] ?? "", { canal: channelTitle })) }} />
                      {trigger === "JOIN_REQUEST" ? <p className="text-xs text-muted-foreground">+ boutons « Rejoindre … » et « ✅ J&apos;ai rejoint » ajoutés par le bot si la règle prévoit des canaux à rejoindre.</p> : null}
                      {trigger === "OFFER_REPLY" ? <p className="text-xs text-muted-foreground">+ bouton « Ouvrir l&apos;offre » ajouté par le bot.</p> : null}
                    </div>
                  </div>
                ))}
                {missing.length > 0 ? (
                  <form action={addSequenceLangAction} className="flex items-end gap-2">
                    <input type="hidden" name="channelId" value={channelId} />
                    <input type="hidden" name="trigger" value={trigger} />
                    <div className="space-y-1">
                      <Label htmlFor={`${trigger}-add`}>Ajouter une langue</Label>
                      <select id={`${trigger}-add`} name="lang" className="h-9 rounded-md border bg-background px-3 text-sm">
                        {missing.map((l) => <option key={l} value={l}>{LANG_LABELS[l] ?? l}</option>)}
                      </select>
                    </div>
                    <Button type="submit" size="sm" variant="outline">Ajouter</Button>
                  </form>
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
