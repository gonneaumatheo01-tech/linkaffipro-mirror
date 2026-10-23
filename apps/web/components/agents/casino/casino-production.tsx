import { AgentMediaPreview } from "@/components/agents/agent-media-preview";
import { CasinoUpload } from "@/components/agents/casino/casino-upload";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  addCasinoThemeAction,
  classifyCasinoMediaAction,
  createCasinoTestPostAction,
  removeCasinoThemeAction,
  renameCasinoThemeAction,
} from "@/app/(admin)/agents/[equipe]/casino-actions";
import {
  CASINO_TEST_FORMATS,
  STOCK_STATE,
  groupStock,
  themeHashtags,
  themeLabel,
  type CasinoSettings,
  type MediaRequestView,
  type StockRow,
} from "@/lib/agents/casino";
import type { CasinoUsageView, ToClassifyView } from "@/lib/agents/casino-queries";
import { fmtDateShort, fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

function labelsOf(settings: CasinoSettings) {
  return (key: string) => settings.themes.find((t) => t.key === key)?.label ?? themeLabel(key);
}

/** Stock par canal et par thème : vert (assez), orange (sous le seuil), rouge (plus rien). */
export function CasinoStock({
  rows,
  settings,
}: {
  rows: StockRow[] | null;
  settings: CasinoSettings;
}) {
  const label = labelsOf(settings);
  const groups = rows ? groupStock(rows) : [];
  return (
    <FormSection
      id="stock"
      title="Stock de vidéos par canal"
      description={`Vidéos fournies par vous et pas encore publiées sur le canal depuis ${settings.rotationDays} jours. Sous ${settings.lowStock}, l'équipe vous en redemande par Telegram (un message par jour au plus).`}
      className="scroll-mt-24"
    >
      {rows === null ? (
        <p className="text-body text-muted-foreground">
          Le stock ne peut pas être calculé pour l&apos;instant : rechargez la page dans quelques
          minutes.
        </p>
      ) : groups.length === 0 ? (
        <EmptyState
          title="Aucun canal Casino avec des thèmes"
          description="Choisissez les thèmes de chaque canal dans le plan par canal, plus bas : le stock s'affiche ici."
        />
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li
              key={g.channelId}
              className="space-y-2 rounded-xl border border-border bg-card px-4 py-3"
            >
              <p className="font-medium text-foreground">{g.channelTitle}</p>
              <ul className="flex flex-wrap gap-2">
                {g.rows.map((r) => (
                  <li key={r.theme}>
                    <StatusPill tone={STOCK_STATE[r.state].tone} title={STOCK_STATE[r.state].label}>
                      {label(r.theme)} : {fmtNum(r.unused)}
                      <span className="sr-only"> ({STOCK_STATE[r.state].label})</span>
                    </StatusPill>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </FormSection>
  );
}

/** Médias reçus sans thème : aperçu et classement en ligne (cases des thèmes). */
export function CasinoToClassify({
  items,
  total,
  settings,
  now,
}: {
  items: ToClassifyView[];
  total: number;
  settings: CasinoSettings;
  now: Date;
}) {
  return (
    <FormSection
      id="a-classer"
      title="Médias à classer"
      description="Reçus sans thème (sans #roulette, #bonus… dans la légende). Cochez leurs thèmes : ils rejoignent le stock."
      className="scroll-mt-24"
    >
      {items.length === 0 ? (
        <p className="text-note text-muted-foreground">
          Rien à classer : tous les médias reçus ont un thème.
        </p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => {
              const what = a.mimeType.startsWith("video/") ? "Vidéo" : "Image";
              return (
                <li key={a.id} className="space-y-2 rounded-xl border border-border bg-card p-3">
                  <AgentMediaPreview
                    id={a.id}
                    mimeType={a.mimeType}
                    label={`${what} reçue le ${fmtDateShort(a.createdAt, now)}, à classer`}
                    className="max-h-72"
                  />
                  <p className="text-note text-muted-foreground">
                    {what}, reçue le {fmtDateShort(a.createdAt, now)}
                  </p>
                  <form action={classifyCasinoMediaAction} className="space-y-2">
                    <input type="hidden" name="assetId" value={a.id} />
                    <fieldset>
                      <legend className="sr-only">Thèmes de ce média</legend>
                      <ul className="flex flex-wrap gap-x-4 gap-y-1">
                        {settings.themes.map((t) => (
                          <li key={t.key}>
                            <label className="flex min-h-9 items-center gap-2 text-body">
                              <Checkbox
                                name="theme"
                                value={t.key}
                                defaultChecked={a.themes.includes(t.key)}
                              />
                              {t.label}
                            </label>
                          </li>
                        ))}
                      </ul>
                    </fieldset>
                    <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                      Ranger
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
          {total > items.length ? (
            <p className="text-note text-muted-foreground">
              Les {items.length} plus anciens sur {fmtNum(total)} : rangez-les, les suivants
              s&apos;affichent ensuite.
            </p>
          ) : null}
        </>
      )}
    </FormSection>
  );
}

/** Demandes de vidéos envoyées par l'équipe (Telegram) : thème, date, état. */
export function CasinoRequests({
  requests,
  settings,
  channelTitles,
  now,
}: {
  requests: MediaRequestView[];
  settings: CasinoSettings;
  channelTitles: Record<string, string>;
  now: Date;
}) {
  const label = labelsOf(settings);
  return (
    <FormSection
      id="demandes"
      title="Demandes de vidéos"
      description="Ce que l'équipe vous a demandé sur Telegram. Pour répondre, envoyez les vidéos au bot avec le mot-clé indiqué : la demande se ferme toute seule."
      className="scroll-mt-24"
    >
      {requests.length === 0 ? (
        <p className="text-note text-muted-foreground">Aucune demande pour l&apos;instant.</p>
      ) : (
        <ul className="space-y-2">
          {requests.map((r) => {
            const channels = r.channelIds.map((id) => channelTitles[id]).filter(Boolean);
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3"
              >
                <StatusBadge kind="humanRequest" value={r.status} />
                <span className="font-medium text-foreground">
                  {r.themes.length ? r.themes.map(label).join(", ") : "Vidéos"}
                </span>
                {channels.length ? (
                  <span className="text-note text-muted-foreground">
                    pour {channels.join(", ")}
                  </span>
                ) : null}
                <span className="text-note text-muted-foreground">
                  {r.count !== null
                    ? `${fmtNum(Math.min(r.received, r.count))} reçue${r.received > 1 ? "s" : ""} sur ${fmtNum(r.count)}`
                    : null}
                </span>
                <span className="text-note text-muted-foreground">
                  {r.answeredAt
                    ? `complète le ${fmtDateShort(r.answeredAt, now)}`
                    : `demandée le ${fmtDateShort(r.askedAt ?? r.createdAt, now)}`}
                </span>
                {r.themes.length ? (
                  <span className="text-note text-foreground">
                    Mot-clé :{" "}
                    {r.themes.length === 1
                      ? themeHashtags(r.themes[0]!)
                      : `#casino ${r.themes.map((t) => `#${t}`).join(" ")}`}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </FormSection>
  );
}

/** Post de test, dernières publications de médias et dépôt de fichiers. */
export function CasinoProduction({
  usages,
  settings,
  simulation,
  now,
}: {
  usages: CasinoUsageView[];
  settings: CasinoSettings;
  simulation: boolean;
  now: Date;
}) {
  const label = labelsOf(settings);
  return (
    <FormSection
      id="production"
      title="Vidéos et images"
      description="L'équipe Casino n'utilise que les vidéos et images que vous fournissez : rien n'est inventé ni fabriqué par l'IA."
      className="scroll-mt-24"
    >
      <form
        action={createCasinoTestPostAction}
        className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-end"
      >
        <div className="space-y-1.5">
          <Label htmlFor="casino-test-format">Type de post</Label>
          <NativeSelect
            id="casino-test-format"
            name="format"
            defaultValue="video"
            wrapperClassName="w-full sm:w-40"
          >
            {CASINO_TEST_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" className="max-md:h-10">
          Produire un post de test
        </Button>
        <p className="text-note text-muted-foreground sm:basis-full">
          {simulation
            ? "En simulation : il part sur le canal Test après votre validation. Sans vidéo en stock, il devient une image, puis un texte."
            : "Toujours en simulation : un post de test part sur le canal Test, jamais sur un vrai canal."}
        </p>
      </form>

      {usages.length ? (
        <div className="space-y-1.5">
          <p className="text-note font-medium text-foreground">Dernières publications</p>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {usages.map((u) => {
              const what = u.asset.mimeType.startsWith("video/") ? "Vidéo" : "Image";
              const themes = u.asset.themes.map(label).join(", ");
              return (
                <li key={u.id} className="space-y-1">
                  <AgentMediaPreview
                    id={u.asset.id}
                    mimeType={u.asset.mimeType}
                    label={`${what} publiée sur ${u.channelTitle} le ${fmtDateShort(u.usedAt, now)}`}
                  />
                  <p className="text-note text-muted-foreground">
                    {u.channelTitle}, {fmtDateShort(u.usedAt, now)}
                    {themes ? ` (${themes})` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-note text-muted-foreground">
          Aucune vidéo ni image publiée pour l&apos;instant.
        </p>
      )}

      <div className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-body font-medium text-foreground">Déposer des vidéos ou des images</p>
        <CasinoUpload themes={settings.themes} />
      </div>
    </FormSection>
  );
}

/** Liste des thèmes de l'équipe : ajout, renommage, retrait (administrateurs) ; lecture seule sinon. */
export function CasinoThemes({
  settings,
  counts,
  isAdmin,
}: {
  settings: CasinoSettings;
  counts: Record<string, number>;
  isAdmin: boolean;
}) {
  return (
    <FormSection
      id="themes"
      title="Thèmes de l'équipe"
      description="Chaque vidéo ou image porte un ou plusieurs thèmes ; chaque canal choisit les siens dans son plan. Le mot-clé à mettre en légende ne change jamais, même si vous renommez le thème."
      className="scroll-mt-24"
    >
      <ul className="space-y-2">
        {settings.themes.map((t) => {
          const n = counts[t.key] ?? 0;
          return (
            <li
              key={t.key}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 md:flex-row md:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{t.label}</p>
                <p className="text-note text-muted-foreground">
                  {themeHashtags(t.key)} · {fmtNum(n)} média{n > 1 ? "s" : ""}
                </p>
              </div>
              {isAdmin ? (
                <div className="flex flex-wrap items-end gap-2">
                  <form action={renameCasinoThemeAction} className="flex items-end gap-2">
                    <input type="hidden" name="key" value={t.key} />
                    <Label htmlFor={`theme-${t.key}`} className="sr-only">
                      Nouveau nom du thème {t.label}
                    </Label>
                    <Input
                      id={`theme-${t.key}`}
                      name="label"
                      defaultValue={t.label}
                      maxLength={40}
                      className="w-44"
                    />
                    <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                      Renommer
                    </Button>
                  </form>
                  {n === 0 ? (
                    <form action={removeCasinoThemeAction}>
                      <input type="hidden" name="key" value={t.key} />
                      <Button type="submit" variant="ghost" size="sm" className="max-md:h-10">
                        Retirer
                      </Button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {isAdmin ? (
        <form
          action={addCasinoThemeAction}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-theme">Nouveau thème</Label>
            <Input
              id="new-theme"
              name="label"
              maxLength={40}
              placeholder="Poker"
              required
              className="sm:w-56"
            />
          </div>
          <Button type="submit" variant="outline" className="max-md:h-10">
            Ajouter le thème
          </Button>
        </form>
      ) : (
        <p className="text-note text-muted-foreground">
          Ajouter, renommer ou retirer un thème est réservé aux administrateurs.
        </p>
      )}
      <p className="text-note text-muted-foreground">
        Un thème inconnu envoyé au bot (par exemple #casino #poker) est créé après votre
        confirmation sur Telegram. Seul un thème sans aucun média peut être retiré.
      </p>
    </FormSection>
  );
}
