import type { Metadata } from "next";
import Link from "next/link";
import { Download, MessageCircle, Users } from "lucide-react";
import { AgentsNav } from "@/components/agents/agents-nav";
import { DataTable } from "@/components/admin/data-table";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BOSS_PATH,
  MAX_BOSS_BUDGET_EUROS,
  TEAM_MEMBER_ROLE_LABELS,
  TURN_STATUS_LABELS,
  availabilityOf,
  bossBudgetGauge,
  responsibilitiesLabel,
  telegramLink,
  turnAuthor,
} from "@/lib/agents/boss";
import { loadBossPage } from "@/lib/agents/boss-queries";
import { ORDERS_PATH, groupUnmet } from "@/lib/agents/orders";
import { centsToEurField } from "@/lib/agents/config";
import { loadPendingCounts } from "@/lib/agents/queries";
import { fmtDate, fmtDateShort, fmtMoney, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { saveBossBudgetAction, saveBossNameAction } from "./actions";

export const metadata: Metadata = { title: "Agents · Kevin" };
export const dynamic = "force-dynamic";

const TONE_BAR = { success: "bg-success", warning: "bg-warning", danger: "bg-danger" } as const;

/**
 * Agents → Kevin (le Boss, phase 26) : le bot à qui l'on parle sur Telegram. État du bot (ou les 3 étapes pour le
 * créer), prénom (ADMIN), dépense de son IA ce mois et plafond (ADMIN), l'équipe qui lui a été présentée et le groupe
 * enregistré (lecture seule), ce qu'on lui a demandé et qu'il ne sait pas encore faire (export), derniers échanges.
 * ADMIN et MANAGER lisent ; seuls les ADMIN modifient. Rien ici n'appelle une IA ni n'envoie de message.
 */
export default async function AgentsBossPage({ searchParams }: PageProps<"/agents/boss">) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const isAdmin = user.role === "ADMIN";
  const [data, pending] = await Promise.all([loadBossPage(now), loadPendingCounts()]);
  const { name, bot } = data;
  const gauge = bossBudgetGauge(data.spentCents, data.capCents);
  const unmetGroups = groupUnmet(data.unmet);

  return (
    <>
      <AgentsNav current="boss" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title={name}
        description={`${name} est votre bot sur Telegram : parlez-lui comme à un collègue. Il répond avec les vrais chiffres, fait ce que vous demandez et vous demande « OUI » avant tout ce qui dépense ou publie.`}
        help={`Pour démarrer, écrivez « commencer » à ${name} : il dit ce qui manque et pose les questions une par une. « aide » liste tout ce qu'il sait faire.`}
        secondaryActions={
          <Link href={ORDERS_PATH} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
            Ses ordres aux équipes
          </Link>
        }
        meta={
          bot ? (
            <StatusPill tone={bot.isActive ? "success" : "muted"}>{bot.isActive ? "En service" : "Désactivé"}</StatusPill>
          ) : (
            <StatusPill tone="warning">Pas encore créé</StatusPill>
          )
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        <FormSection
          title="Le bot"
          description={bot ? `C'est à lui que vous écrivez ; les bots des canaux renvoient vers lui.` : `${name} n'existe pas encore : 3 étapes, 2 minutes.`}
        >
          {bot ? (
            <DetailList>
              <DetailRow label="Nom">{bot.name}</DetailRow>
              <DetailRow label="Sur Telegram">
                <a href={telegramLink(bot.username)} target="_blank" rel="noopener noreferrer" className="text-info underline">
                  @{bot.username}
                </a>
              </DetailRow>
              <DetailRow label="Dernier message reçu">{fmtDate(bot.lastWebhookAt)}</DetailRow>
              {bot.lastError ? (
                <DetailRow label="Dernier problème">
                  <span className="text-danger">{bot.lastError}</span>
                </DetailRow>
              ) : null}
            </DetailList>
          ) : (
            <ol className="list-decimal space-y-2 pl-5 text-body text-foreground">
              <li>
                Dans Telegram, ouvrez <span className="font-medium">@BotFather</span>, envoyez <code>/newbot</code>, nommez-le « {name} »
                puis choisissez un identifiant qui finit par « bot ». Copiez le jeton.
              </li>
              <li>
                Envoyez au bot actuel <code>jeton boss</code> suivi du jeton (il efface votre message), ou collez-le dans{" "}
                <Link href="/settings/bots" className="text-info underline">
                  Réglages → Bots
                </Link>{" "}
                → Ajouter un bot → Rôle « Boss ».
              </li>
              <li>
                Ouvrez le nouveau bot, appuyez sur <span className="font-medium">Démarrer</span>, puis écrivez <code>commencer</code>.
              </li>
            </ol>
          )}
        </FormSection>

        {isAdmin ? (
          <FormSection title="Prénom" description="Le nom que vous et votre équipe lui donnez dans les messages.">
            <form action={saveBossNameAction} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="boss-name">Prénom</Label>
                <Input id="boss-name" name="name" defaultValue={name} maxLength={40} autoComplete="off" />
              </div>
              <Button type="submit" variant="outline" className="max-md:h-10">
                Enregistrer le prénom
              </Button>
            </form>
          </FormSection>
        ) : null}

        <FormSection
          title="Ce que coûte son intelligence ce mois"
          description="Les commandes exactes (« agents », « pause casino », « ok 12 ») sont gratuites ; seules les phrases libres font appel à l'IA."
        >
          <div className="space-y-2">
            <p className="text-body text-foreground">
              <span className="text-figure font-semibold">{fmtMoney(data.spentCents / 100)}</span> sur {fmtMoney(data.capCents / 100)} ·{" "}
              {fmtNum(data.calls)} appel{data.calls > 1 ? "s" : ""}
            </p>
            <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className={cn("h-full rounded-full", TONE_BAR[gauge.tone])} style={{ width: `${gauge.percent}%` }} />
            </div>
            <p className="text-note text-muted-foreground">
              {gauge.percent} % du plafond.{" "}
              {data.spentCents >= data.capCents
                ? `Plafond atteint : ${name} ne comprend plus que les commandes exactes jusqu'au mois prochain.`
                : "Une alerte part sur Telegram à 80 %."}
            </p>
          </div>
          {isAdmin ? (
            <form action={saveBossBudgetAction} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="boss-budget">Plafond par mois (€)</Label>
                <Input
                  id="boss-budget"
                  name="euros"
                  inputMode="decimal"
                  defaultValue={centsToEurField(data.capCents)}
                  className="w-32"
                  aria-describedby="boss-budget-aide"
                />
                <p id="boss-budget-aide" className="text-note text-muted-foreground">
                  De 0 à {MAX_BOSS_BUDGET_EUROS} € ; 10 € suffisent en général.
                </p>
              </div>
              <Button type="submit" variant="outline" className="max-md:h-10">
                Enregistrer le plafond
              </Button>
            </form>
          ) : (
            <p className="text-note text-muted-foreground">Seuls les administrateurs peuvent changer le plafond.</p>
          )}
        </FormSection>

        <FormSection
          title="Équipe"
          description={`Les personnes présentées à ${name} dans le groupe de l'équipe. Il mentionne la bonne personne quand il a besoin d'elle.`}
        >
          <p className="text-body text-foreground">
            Groupe de l&apos;équipe :{" "}
            {data.groupChatId ? (
              <StatusPill tone="success">Enregistré</StatusPill>
            ) : (
              <StatusPill tone="muted">Aucun</StatusPill>
            )}
          </p>
          {data.members.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title="Personne n'est encore présenté"
              description={`Ajoutez ${name} au groupe Telegram de l'équipe, puis présentez chacun en une phrase : « ${name}, voici @lea, elle s'occupe des vidéos casino ».`}
            />
          ) : (
            <DataTable
              label="Équipe"
              columns={[
                { key: "name", header: "Prénom" },
                { key: "role", header: "Rôle" },
                { key: "resp", header: "S'occupe de", className: "whitespace-normal" },
                { key: "avail", header: "Disponibilité", hideOnMobile: true },
              ]}
              rows={data.members.map((m) => {
                const a = availabilityOf(m, now);
                return {
                  id: m.id,
                  cells: {
                    name: (
                      <span className="flex flex-col items-start gap-0.5">
                        <span>{m.firstName}</span>
                        {m.username ? <span className="text-note text-muted-foreground">@{m.username}</span> : null}
                      </span>
                    ),
                    role: TEAM_MEMBER_ROLE_LABELS[m.role] ?? m.role,
                    resp: (
                      <span className="flex flex-col items-start gap-0.5">
                        {m.roleLabel ? <span>{m.roleLabel}</span> : null}
                        <span className="text-note text-muted-foreground">{responsibilitiesLabel(m.responsibilities)}</span>
                      </span>
                    ),
                    avail: a.away ? (
                      <StatusPill tone="warning">{a.until ? `Absent jusqu'au ${fmtDateShort(a.until, now)}` : "Indisponible"}</StatusPill>
                    ) : (
                      <StatusPill tone="success">Disponible</StatusPill>
                    ),
                  },
                  sortValues: { name: m.firstName, role: m.role },
                };
              })}
            />
          )}
        </FormSection>

        <FormSection
          title="Ce qu'il ne sait pas encore faire"
          description="Chaque demande qu'il n'a pas su traiter, du plus demandé au moins demandé : c'est la liste des prochaines améliorations."
          actions={
            data.unmet.length ? (
              <Link href={`${BOSS_PATH}/export`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
                <Download aria-hidden />
                Exporter
              </Link>
            ) : undefined
          }
        >
          <DataTable
            label="Demandes pas encore prévues"
            columns={[
              { key: "text", header: "Demande", className: "whitespace-normal" },
              { key: "count", header: "Nombre de fois", align: "right" },
              { key: "lastAt", header: "Dernière fois", hideOnMobile: true },
            ]}
            rows={data.unmet.map((u) => ({
              id: u.id,
              cells: { text: u.text, count: fmtNum(u.count), lastAt: fmtDate(u.lastAt) },
              sortValues: { text: u.text, count: u.count, lastAt: u.lastAt.getTime() },
            }))}
            empty={{ title: "Rien pour l'instant", description: `Tout ce qu'on a demandé à ${name}, il a su le faire.` }}
          />
          {data.unmetTotal > data.unmet.length ? (
            <p className="text-note text-muted-foreground">
              Les {data.unmet.length} plus fréquentes sur {fmtNum(data.unmetTotal)} : l&apos;export les contient toutes.
            </p>
          ) : null}
        </FormSection>

        <FormSection
          title="Pas encore possible"
          description="Les mêmes demandes regroupées par équipe et par ce qu'il faudrait apprendre à Kevin : la liste de travail du développeur. Une demande qui vise une équipe à venir (Montage, Prospection…) y est rangée."
        >
          <DataTable
            label="Pas encore possible, par équipe"
            columns={[
              { key: "team", header: "Équipe" },
              { key: "capability", header: "Ce qu'il faudrait savoir faire", className: "whitespace-normal" },
              { key: "count", header: "Nombre de fois", align: "right" },
              { key: "examples", header: "Exemples de demandes", className: "whitespace-normal", hideOnMobile: true },
            ]}
            rows={unmetGroups.map((g) => ({
              id: g.key,
              cells: {
                team: g.team,
                capability: g.capability,
                count: fmtNum(g.count),
                examples: g.examples.map((t) => `« ${t} »`).join(" · "),
              },
              sortValues: { team: g.team, capability: g.capability, count: g.count },
            }))}
            empty={{ title: "Rien à apprendre pour l'instant", description: `Aucune demande à ${name} n'est restée sans solution.` }}
          />
        </FormSection>

        <FormSection
          title="Derniers échanges"
          description="Les 50 derniers messages, les plus récents d'abord. Une clé ou un mot de passe n'y apparaît jamais : il est remplacé par « [secret] »."
        >
          <DataTable
            label="Derniers échanges"
            columns={[
              { key: "at", header: "Quand" },
              { key: "who", header: "Qui" },
              { key: "text", header: "Message", className: "whitespace-normal" },
              { key: "status", header: "Résultat", hideOnMobile: true },
            ]}
            rows={data.turns.map((t) => ({
              id: t.id,
              cells: {
                at: fmtDate(t.createdAt),
                who: (
                  <span className="flex flex-col items-start gap-0.5">
                    <span>{turnAuthor(t.role, name)}</span>
                    {t.source === "voice" ? <span className="text-note text-muted-foreground">vocal</span> : null}
                  </span>
                ),
                text: t.text,
                status: t.status ? (TURN_STATUS_LABELS[t.status] ?? t.status) : "—",
              },
              sortValues: { at: t.createdAt.getTime() },
            }))}
            empty={{
              icon: <MessageCircle />,
              title: "Aucun échange encore",
              description: `Écrivez « commencer » à ${name} sur Telegram.`,
            }}
          />
        </FormSection>
      </div>
    </>
  );
}
