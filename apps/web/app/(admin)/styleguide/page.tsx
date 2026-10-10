import type { Metadata } from "next";
import Link from "next/link";
import { Download, Megaphone, Plus, Send, Users } from "lucide-react";
import { CopyField } from "@/components/admin/copy-field";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { HelpButton } from "@/components/admin/help-button";
import { HelpTip, Term } from "@/components/admin/help-tip";
import { PageHeader } from "@/components/admin/page-header";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { PeriodSelect } from "@/components/admin/period-select";
import { StatCard } from "@/components/admin/stat-card";
import { PILL_TONES, StatusPill, type PillTone } from "@/components/admin/status-pill";
import { Stepper } from "@/components/admin/stepper";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { resolvePeriod } from "@/lib/periods";
import { requireAdminPage } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { UNIVERSES } from "@/lib/universe";
import {
  CheckboxDemo,
  ConfirmDemos,
  DialogDemo,
  MenuDemo,
  SelectDemo,
  SidePanelDemo,
  StepperDemo,
} from "./demos";

export const metadata: Metadata = { title: "Guide de style" };

/** Sections de la page (sommaire et ancres). */
const SECTIONS = [
  { id: "couleurs", label: "Couleurs" },
  { id: "typographie", label: "Typographie" },
  { id: "boutons", label: "Boutons" },
  { id: "pastilles", label: "Pastilles" },
  { id: "en-tete", label: "En-tête de page" },
  { id: "chiffres", label: "Cartes de chiffres" },
  { id: "tableaux", label: "Tableaux" },
  { id: "formulaires", label: "Formulaires" },
  { id: "vides", label: "États vides" },
  { id: "aide", label: "Aide" },
  { id: "etapes", label: "Étapes" },
  { id: "confirmation", label: "Confirmation et volets" },
  { id: "messages", label: "Messages" },
  { id: "autres", label: "Autres éléments" },
] as const;

type Swatch = { cls: string; name: string; hex: string; usage: string; ring?: boolean };

const COLOR_GROUPS: Array<{ title: string; swatches: Swatch[] }> = [
  {
    title: "Marque",
    swatches: [
      {
        cls: "bg-brand",
        name: "brand",
        hex: "#FCA314",
        usage: "Bouton principal, élément actif, accents. Texte nuit dessus, jamais blanc.",
      },
      {
        cls: "bg-brand-ink",
        name: "brand-ink",
        hex: "#9A5B00",
        usage: "Orange lisible pour un texte ou un lien sur fond clair (AA).",
      },
      {
        cls: "bg-brand-soft",
        name: "brand-soft",
        hex: "#FFF4E0",
        usage: "Fond très pâle : rond des états vides, sélection, compteur.",
        ring: true,
      },
      {
        cls: "bg-night",
        name: "night",
        hex: "#020713",
        usage: "Barre de menu, en-têtes sombres, infobulles.",
      },
    ],
  },
  {
    title: "Fond et texte",
    swatches: [
      {
        cls: "bg-background",
        name: "background",
        hex: "#FAFAF7",
        usage: "Fond des pages (blanc cassé).",
        ring: true,
      },
      {
        cls: "bg-surface",
        name: "surface / card",
        hex: "#FFFFFF",
        usage: "Cartes, tableaux, volets, champs.",
        ring: true,
      },
      {
        cls: "bg-foreground",
        name: "foreground",
        hex: "#1A1F2B",
        usage: "Texte principal (anthracite).",
      },
      {
        cls: "bg-muted-foreground",
        name: "muted-foreground",
        hex: "#5B6474",
        usage: "Texte secondaire, aides, en-têtes de tableau.",
      },
      {
        cls: "bg-border",
        name: "border",
        hex: "#E4E6EB",
        usage: "Bordures 1 px des cartes et séparateurs.",
      },
      {
        cls: "bg-input",
        name: "input",
        hex: "#D5D9E0",
        usage: "Bordure des champs et boutons « outline ».",
      },
    ],
  },
  {
    title: "États",
    swatches: [
      {
        cls: "bg-success",
        name: "success",
        hex: "#15803D",
        usage: "Réussi, en ligne, variation favorable (fond : success-soft).",
      },
      {
        cls: "bg-warning",
        name: "warning",
        hex: "#854D0E",
        usage:
          "À surveiller, en attente : jaune-brun, distinct de la marque (fond : warning-soft).",
      },
      {
        cls: "bg-danger",
        name: "danger",
        hex: "#B91C1C",
        usage: "Échec, erreur, action destructive (fond : danger-soft).",
      },
      {
        cls: "bg-info",
        name: "info",
        hex: "#1D4ED8",
        usage: "En cours, programmé, information (fond : info-soft).",
      },
    ],
  },
  {
    title: "Univers (pastille, bordure ou étiquette, jamais en fond plein)",
    swatches: [
      {
        cls: "bg-casino",
        name: "casino",
        hex: "#7C3AED",
        usage: "Casino. Texte : casino-ink #6D28D9.",
      },
      {
        cls: "bg-sports",
        name: "sports",
        hex: "#059669",
        usage: "Paris sportifs. Texte : sports-ink #047857.",
      },
      {
        cls: "bg-dating",
        name: "dating",
        hex: "#DB2777",
        usage: "Rencontres. Texte : dating-ink #BE185D.",
      },
    ],
  },
];

const TONE_EXAMPLES: Record<PillTone, string> = {
  neutral: "Canal",
  muted: "Terminée",
  info: "Programmé",
  success: "Envoyé",
  warning: "En attente",
  danger: "Échec",
  brand: "Nouveau",
};

const TABLE_COLUMNS: DataTableColumn[] = [
  { key: "name", header: "Campagne" },
  { key: "universe", header: "Univers", hideOnMobile: true },
  { key: "members", header: "Membres", align: "right" },
  { key: "ftd", header: "Premiers dépôts", term: "FTD", align: "right" },
  { key: "profit", header: "Bénéfice", align: "right" },
];

const SAMPLE = [
  {
    id: "c1",
    name: "Casino octobre",
    universe: "CASINO",
    members: 1240,
    ftd: 86,
    profit: 3120.5,
    spend: 950,
  },
  {
    id: "c2",
    name: "Ligue des champions",
    universe: "SPORTS",
    members: 860,
    ftd: 41,
    profit: -180,
    spend: 1200,
  },
  {
    id: "c3",
    name: "Rencontres été",
    universe: "DATING",
    members: 312,
    ftd: 9,
    profit: 410.2,
    spend: 150,
  },
  {
    id: "c4",
    name: "Casino week-end",
    universe: "CASINO",
    members: 97,
    ftd: 3,
    profit: 12,
    spend: 60,
  },
];

const eur = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="scroll-mt-20 space-y-4">
      <div>
        <h2 id={`${id}-titre`} className="text-title text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-body text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Demo({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-4 md:p-6", className)}>
      {title ? <p className="mb-3 text-note font-medium text-muted-foreground">{title}</p> : null}
      {children}
    </div>
  );
}

export default async function StyleguidePage({ searchParams }: PageProps<"/styleguide">) {
  await requireAdminPage();
  const sp = await searchParams;
  const page = pageOf(sp);
  const period = resolvePeriod({
    range: typeof sp.range === "string" ? sp.range : "7d",
    from: sp.from,
    to: sp.to,
  });

  const rows: DataTableRow[] = SAMPLE.map((c) => ({
    id: c.id,
    cells: {
      name: c.name,
      universe: <UniverseDot universe={c.universe} withLabel />,
      members: c.members.toLocaleString("fr-FR"),
      ftd: c.ftd,
      profit: <span className={c.profit < 0 ? "text-danger" : undefined}>{eur(c.profit)}</span>,
    },
    sortValues: { universe: c.universe, members: c.members, profit: c.profit },
    detailTitle: c.name,
    detailDescription: "Exemple de volet de détail : tout ce qui ne tient pas dans 5 colonnes.",
    detail: (
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
        <dt className="text-muted-foreground">Univers</dt>
        <dd>
          <UniverseDot universe={c.universe} variant="pill" />
        </dd>
        <dt className="text-muted-foreground">Dépensé</dt>
        <dd className="tabular-nums">{eur(c.spend)}</dd>
        <dt className="text-muted-foreground">Membres</dt>
        <dd className="tabular-nums">{c.members.toLocaleString("fr-FR")}</dd>
        <dt className="text-muted-foreground">
          <Term term="FTD">Premiers dépôts</Term>
        </dt>
        <dd className="tabular-nums">{c.ftd}</dd>
        <dt className="text-muted-foreground">
          <Term term="CPL">Coût par membre</Term>
        </dt>
        <dd className="tabular-nums">{eur(c.spend / Math.max(1, c.members))}</dd>
        <dt className="text-muted-foreground">Bénéfice</dt>
        <dd className="tabular-nums">{eur(c.profit)}</dd>
      </dl>
    ),
  }));

  const linkRows: DataTableRow[] = SAMPLE.slice(0, 2).map((c) => ({
    id: `l-${c.id}`,
    cells: {
      name: c.name,
      universe: <UniverseDot universe={c.universe} withLabel />,
      members: c.members.toLocaleString("fr-FR"),
    },
    // « 1 240 » (texte formaté) se trie comme un nombre : pas besoin de sortValues pour cette colonne.
    sortValues: { universe: c.universe },
    href: "/styleguide#tableaux",
  }));

  return (
    <>
      <PageHeader
        title="Guide de style"
        description="Couleurs, textes et composants de l'interface, en situation. Page interne, hors menu."
        help="L'en-tête ci-dessus est lui-même un PageHeader : lien Retour, pastille, actions secondaires et un seul bouton principal."
        backHref="/settings"
        backLabel="Réglages"
        meta={<StatusPill tone="brand">Interne</StatusPill>}
        secondaryActions={
          <Link href="/help" className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}>
            Guide d&apos;utilisation
          </Link>
        }
        primaryAction={{ label: "Voir les composants", href: "#boutons" }}
      />

      <nav aria-label="Sommaire du guide de style" className="mb-8 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="inline-flex h-8 items-center rounded-full border border-border bg-surface px-3 text-note font-medium text-foreground hover:bg-muted max-md:h-10"
          >
            {s.label}
          </a>
        ))}
      </nav>

      <div className="space-y-12">
        <Section
          id="couleurs"
          title="Couleurs"
          description="Une couleur de marque (orange du logo), le fond nuit pour le menu, un contenu clair. Classes Tailwind : bg-<nom>, text-<nom>, border-<nom>."
        >
          {COLOR_GROUPS.map((g) => (
            <div key={g.title} className="space-y-3">
              <h3 className="text-body font-semibold">{g.title}</h3>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {g.swatches.map((sw) => (
                  <li
                    key={sw.name}
                    className="overflow-hidden rounded-xl border border-border bg-surface"
                  >
                    <div
                      className={cn("h-16", sw.cls, sw.ring && "border-b border-border")}
                      aria-hidden
                    />
                    <div className="space-y-1 p-3">
                      <p className="flex items-baseline justify-between gap-2">
                        <code className="font-mono text-note font-semibold">{sw.name}</code>
                        <span className="font-mono text-note text-muted-foreground">{sw.hex}</span>
                      </p>
                      <p className="text-note text-muted-foreground">{sw.usage}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>

        <Section
          id="typographie"
          title="Typographie"
          description="Inter, trois tailles seulement, plus le gros chiffre des cartes. Chiffres tabulaires dans les tableaux et cartes."
        >
          <Demo>
            <dl className="divide-y divide-border">
              {[
                {
                  cls: "text-title",
                  name: "text-title",
                  spec: "20 px · semi-gras",
                  sample: "Campagnes actives",
                },
                {
                  cls: "text-body",
                  name: "text-body",
                  spec: "14 px · normal",
                  sample: "Les membres arrivés aujourd'hui apparaissent ici.",
                },
                {
                  cls: "text-note",
                  name: "text-note",
                  spec: "12 px · normal",
                  sample: "Mis à jour il y a 2 min",
                },
                {
                  cls: "text-figure tabular-nums",
                  name: "text-figure",
                  spec: "28 px · semi-gras · tabulaire",
                  sample: "1 240,50 €",
                },
              ].map((t) => (
                <div
                  key={t.name}
                  className="grid gap-1 py-3 sm:grid-cols-[180px_1fr] sm:items-baseline"
                >
                  <dt>
                    <code className="font-mono text-note font-semibold">{t.name}</code>
                    <span className="block text-note text-muted-foreground">{t.spec}</span>
                  </dt>
                  <dd className={t.cls}>{t.sample}</dd>
                </div>
              ))}
            </dl>
          </Demo>
        </Section>

        <Section
          id="boutons"
          title="Boutons"
          description="Un seul bouton principal orange par écran ; les autres actions sont sobres. 36 px par défaut, 32 px en petit, 40 px en grand ; au moins 40 px sur téléphone."
        >
          <Demo title="Variantes">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Programmer</Button>
              <Button variant="outline">Enregistrer en brouillon</Button>
              <Button variant="secondary">Dupliquer</Button>
              <Button variant="ghost">Annuler</Button>
              <Button variant="destructive">Supprimer</Button>
              <Button variant="danger">Confirmer la suppression</Button>
              <Button variant="link">Voir le détail</Button>
            </div>
          </Demo>
          <Demo title="Tailles, icônes et états">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="xs" variant="outline">
                Très petit
              </Button>
              <Button size="sm" variant="outline">
                Petit
              </Button>
              <Button variant="outline">Normal</Button>
              <Button size="lg" variant="outline">
                Grand
              </Button>
              <Button>
                <Plus aria-hidden />
                Nouveau message
              </Button>
              <Button variant="outline">
                <Download aria-hidden />
                Exporter
              </Button>
              <Button size="icon" variant="outline" aria-label="Envoyer">
                <Send aria-hidden />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Membres">
                <Users aria-hidden />
              </Button>
              <Button disabled>Indisponible</Button>
            </div>
          </Demo>
          <Demo title="Lien qui ressemble à un bouton : buttonVariants() sur <Link>">
            <Link href="#boutons" className={cn(buttonVariants(), "max-md:h-10")}>
              <Megaphone aria-hidden />
              Créer une campagne
            </Link>
          </Demo>
        </Section>

        <Section
          id="pastilles"
          title="Pastilles"
          description="StatusPill pour un état (fond doux, point coloré, texte AA) ; StatusBadge choisit le libellé et la nuance d'un statut de la base ; UniverseDot pour l'univers."
        >
          <Demo title="StatusPill : nuances">
            <div className="flex flex-wrap items-center gap-2">
              {PILL_TONES.map((t) => (
                <StatusPill key={t} tone={t} title={`tone="${t}"`}>
                  {TONE_EXAMPLES[t]}
                </StatusPill>
              ))}
            </div>
          </Demo>
          <Demo title="StatusBadge : statuts réels">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="post" value="SENT" />
              <StatusBadge kind="post" value="SCHEDULED" />
              <StatusBadge kind="membership" value="REQUESTED" />
              <StatusBadge kind="post" value="FAILED" />
              <StatusBadge kind="campaign" value="ENDED" />
              <StatusBadge kind="post" value="DRAFT" />
              <StatusBadge kind="connection" value="NEEDS_RECONNECT" />
              <StatusBadge kind="vertical" value="SPORTS" />
            </div>
          </Demo>
          <Demo title="UniverseDot : point seul, avec libellé, étiquette">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                {UNIVERSES.map((u) => (
                  <UniverseDot key={u} universe={u} />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-4">
                {UNIVERSES.map((u) => (
                  <UniverseDot key={u} universe={u} withLabel />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {UNIVERSES.map((u) => (
                  <UniverseDot key={u} universe={u} variant="pill" />
                ))}
                <UniverseDot universe={null} variant="pill" />
              </div>
            </div>
          </Demo>
          <Demo title="Badge : étiquettes courtes (compteurs, mots-clés)">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Nouveau</Badge>
              <Badge variant="secondary">12</Badge>
              <Badge variant="outline">VIP</Badge>
              <Badge variant="success">+3</Badge>
              <Badge variant="warning">Test A/B</Badge>
              <Badge variant="info">Bot principal</Badge>
              <Badge variant="destructive">Bloqué</Badge>
            </div>
          </Demo>
        </Section>

        <Section
          id="en-tete"
          title="En-tête de page"
          description="PageHeader : titre (le seul h1), une ligne d'aide, un bouton principal orange, actions secondaires discrètes, lien Retour facultatif. Voir le haut de cette page."
        >
          <Demo>
            <pre className="rounded-lg bg-muted p-3 font-mono text-note whitespace-pre-wrap [overflow-wrap:anywhere]">{`<PageHeader
  title="Campagnes"
  description="Ce que vous promouvez et ce que ça rapporte."
  backHref="/" backLabel="Accueil"
  meta={<UniverseDot universe="CASINO" variant="pill" />}
  secondaryActions={<Link className={buttonVariants({ variant: "outline" })} href="/campaigns/links">Tous les liens</Link>}
  primaryAction={{ label: "Nouvelle campagne", href: "/campaigns/new" }}
/>`}</pre>
          </Demo>
        </Section>

        <Section
          id="chiffres"
          title="Cartes de chiffres"
          description="StatCard : libellé, gros chiffre, variation colorée selon le sens favorable, mini-courbe, carte cliquable. Le terme technique est au survol du libellé."
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Membres arrivés aujourd'hui"
              value="128"
              delta={12.5}
              comparison="vs hier"
              trend={[60, 72, 68, 90, 84, 101, 128]}
              href="#chiffres"
            />
            <StatCard
              label="Premiers dépôts aujourd'hui"
              term="FTD"
              value="14"
              delta={-6.7}
              comparison="vs hier"
              trend={[9, 12, 15, 11, 18, 15, 14]}
            />
            <StatCard
              label="Bénéfice du jour"
              value={eur(1240.5)}
              delta={3.2}
              comparison="vs hier"
              hint="Dépôts et revenus moins dépense pub."
            />
            <StatCard
              label="Dépense pub"
              value={eur(320)}
              delta={8}
              favorable="down"
              comparison="vs hier"
              hint="Un coût qui monte s'affiche en rouge."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Revenu net"
              term="NGR"
              value={eur(0)}
              delta={null}
              comparison="vs hier"
            />
            <StatCard
              label="Retour sur dépense pub"
              term="ROAS"
              value="2,4"
              delta={0}
              comparison="vs la semaine dernière"
            />
          </div>
        </Section>

        <Section
          id="tableaux"
          title="Tableaux"
          description="DataTable : 5 colonnes au plus, tri au clic sur l'en-tête, détail dans un volet latéral (ou lien de ligne), état vide. En-têtes en note grise, lignes de 48 px."
        >
          <Card>
            <CardHeader>
              <CardTitle>Campagnes actives</CardTitle>
              <CardDescription>
                Cliquez une ligne pour ouvrir son détail ; triez par colonne.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                label="Campagnes actives (exemple)"
                columns={TABLE_COLUMNS}
                rows={rows}
                defaultSort={{ key: "members", direction: "desc" }}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Tableau large (Table)
                <HelpTip label="Aide : tableau large">
                  Plus large que l&apos;écran : faites défiler la zone (au clavier : Tab puis
                  flèches). Le dégradé du bord montre qu&apos;il reste des colonnes.
                </HelpTip>
              </CardTitle>
              <CardDescription>
                Cellules de chiffres alignées à droite, en chiffres tabulaires ; les noms et les
                identifiants gardent leurs tirets normaux.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table label="Canaux (exemple de tableau large)" className="min-w-7xl">
                <TableHeader>
                  <TableRow>
                    <TableHead>Canal</TableHead>
                    <TableHead>Identifiant Telegram</TableHead>
                    <TableHead>Campagne</TableHead>
                    <TableHead numeric>Membres</TableHead>
                    <TableHead numeric>Arrivés (7 j)</TableHead>
                    <TableHead numeric>Premiers dépôts</TableHead>
                    <TableHead numeric>Revenu net</TableHead>
                    <TableHead numeric>Dépense pub</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SAMPLE.map((c, i) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name} – VIP</TableCell>
                      <TableCell className="font-mono text-note">-100{1111 + i * 2222}</TableCell>
                      <TableCell>{c.name}</TableCell>
                      <TableCell numeric>{c.members.toLocaleString("fr-FR")}</TableCell>
                      <TableCell numeric>{Math.round(c.members / 7)}</TableCell>
                      <TableCell numeric>{c.ftd}</TableCell>
                      <TableCell numeric>{eur(c.profit)}</TableCell>
                      <TableCell numeric>{eur(c.spend)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Demo title="Lien de ligne (href)">
              <DataTable
                label="Liens de ligne (exemple)"
                columns={TABLE_COLUMNS.slice(0, 3)}
                rows={linkRows}
              />
            </Demo>
            <Demo title="Tableau vide">
              <DataTable
                label="Tableau vide (exemple)"
                columns={TABLE_COLUMNS}
                rows={[]}
                empty={{
                  title: "Aucune campagne pour l'instant",
                  description: "Créez une campagne : ses chiffres apparaîtront ici, jour par jour.",
                  action: { href: "#tableaux", label: "Nouvelle campagne" },
                  icon: <Megaphone />,
                }}
              />
            </Demo>
          </div>
        </Section>

        <Section
          id="formulaires"
          title="Formulaires"
          description="Trois niveaux : visible (ce qu'il faut pour que ça marche), un clic (médias, boutons, test A/B), « Avancé » replié (réglages rares, valeurs par défaut sensées). Chaque champ a son libellé relié."
        >
          <Demo>
            <form className="max-w-2xl space-y-8" action="/styleguide" method="get">
              <FormSection
                title="Le message"
                description="Ce que les membres vont lire, et où."
                actions={
                  <Button type="button" variant="ghost" size="sm">
                    <Plus aria-hidden />
                    Nouvelle catégorie
                  </Button>
                }
              >
                <div className="space-y-1.5">
                  <Label htmlFor="sg-title">Titre interne</Label>
                  <Input id="sg-title" name="title" placeholder="Ex. Bonus du vendredi" />
                  <p className="text-note text-muted-foreground">
                    Visible seulement par l&apos;équipe.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sg-text">Texte</Label>
                  <Textarea id="sg-text" name="text" placeholder="Bonjour ! Ce week-end…" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectDemo />
                  <div className="space-y-1.5">
                    <Label htmlFor="sg-when">Date et heure</Label>
                    <Input id="sg-when" name="when" type="datetime-local" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sg-native">Canal (liste native, filtre GET)</Label>
                    <NativeSelect id="sg-native" name="channel" defaultValue="vip">
                      <option value="">Tous les canaux</option>
                      <option value="vip">Casino – VIP</option>
                      <option value="foot">Paris sportifs – Foot</option>
                    </NativeSelect>
                  </div>
                </div>
              </FormSection>
              <AdvancedSection
                description="Épingler, envoi silencieux, contenu protégé…"
                modifiedCount={2}
              >
                <CheckboxDemo />
                <div className="space-y-1.5">
                  <Label htmlFor="sg-delete">Supprimer après (minutes)</Label>
                  <Input
                    id="sg-delete"
                    name="deleteAfter"
                    type="number"
                    min={0}
                    className="w-40"
                    defaultValue={0}
                  />
                </div>
              </AdvancedSection>
              <div className="flex flex-wrap gap-2">
                <Button type="button">Programmer</Button>
                <Button type="button" variant="outline">
                  Enregistrer en brouillon
                </Button>
              </div>
            </form>
          </Demo>
        </Section>

        <Section
          id="vides"
          title="États vides"
          description="EmptyState : une icône dans un rond orange pâle, une phrase, un bouton principal."
        >
          <EmptyState
            icon={<Send />}
            title="Aucun message programmé"
            description="Programmez un premier message : il apparaîtra dans le calendrier de la semaine."
            action={{ href: "#vides", label: "Programmer un message" }}
          />
        </Section>

        <Section
          id="aide"
          title="Aide"
          description="Le terme technique apparaît au survol, au toucher et au focus clavier (Term) ; le bouton « ? » ouvre l'aide de la page dans un volet ; les infobulles (HelpTip) restent courtes et ne sont jamais coupées par une carte."
        >
          <Demo>
            <div className="flex flex-wrap items-center gap-6">
              <p>
                <Term term="FTD">Premiers dépôts</Term> · <Term term="NGR">revenu net</Term> ·{" "}
                <Term term="sub-ID">identifiant de suivi</Term>
              </p>
              <span className="inline-flex items-center gap-2">
                Coût par membre
                <HelpTip label="Aide : coût par membre">
                  Dépense pub divisée par le nombre de membres entrés (CPL).
                </HelpTip>
              </span>
              <span className="inline-flex items-center gap-2">
                <HelpButton description="Exemple d'aide contextuelle.">
                  <h3>À quoi sert cette page ?</h3>
                  <p>
                    Elle montre tous les composants de l&apos;interface, avec leurs couleurs et
                    leurs états.
                  </p>
                  <h3>Que faire ici ?</h3>
                  <ul>
                    <li>Vérifier qu&apos;un écran respecte les règles.</li>
                    <li>Copier un exemple d&apos;usage.</li>
                  </ul>
                </HelpButton>
                <span className="text-note text-muted-foreground">
                  Bouton d&apos;aide de la page
                </span>
              </span>
            </div>
          </Demo>
        </Section>

        <Section
          id="etapes"
          title="Étapes"
          description="Stepper : étapes numérotées, en cours en orange, faites cochées, à venir en gris ; sur téléphone « Étape 2 sur 4 · Offres »."
        >
          <Demo title="Statique (composant serveur)">
            <Stepper
              steps={[
                { title: "Nom et univers" },
                { title: "Offres", help: "Choisissez la ou les offres Link Affi à promouvoir." },
                { title: "Canaux" },
                { title: "Pubs" },
              ]}
              current={1}
            />
          </Demo>
          <Demo title="Interactif (retour aux étapes faites)">
            <StepperDemo />
          </Demo>
        </Section>

        <Section
          id="confirmation"
          title="Confirmation et volets"
          description="ConfirmDialog dit ce qui va se passer ; le bouton est rouge si l'action est destructive ; « Annuler » a le focus. ConfirmSubmit fait la même chose pour un bouton de formulaire. SidePanel : détail à droite, plein écran sur téléphone."
        >
          <Demo>
            <ConfirmDemos />
          </Demo>
          <Demo title="Volet latéral">
            <SidePanelDemo />
          </Demo>
        </Section>

        <Section
          id="messages"
          title="Messages"
          description="Alert dans la page ; Flash pour le retour d'une action (paramètres ok / error de l'adresse)."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <Alert role="status">
              <AlertTitle>Information neutre</AlertTitle>
              <AlertDescription>Les chiffres sont recalculés chaque heure.</AlertDescription>
            </Alert>
            <Alert variant="info" role="status">
              <AlertTitle>Bon à savoir</AlertTitle>
              <AlertDescription>
                Le meilleur créneau pour ce canal est le vendredi à 19 h.
              </AlertDescription>
            </Alert>
            <Alert variant="warning" role="status">
              <AlertTitle>À vérifier</AlertTitle>
              <AlertDescription>La connexion Meta expire dans 5 jours.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTitle>Envoi en échec</AlertTitle>
              <AlertDescription>
                3 messages n&apos;ont pas pu partir : le bot n&apos;est plus administrateur du
                canal.
              </AlertDescription>
            </Alert>
          </div>
          <Flash
            ok="Message programmé pour vendredi 19 h."
            error="Le canal « VIP » n'a pas pu être importé."
          />
        </Section>

        <Section
          id="autres"
          title="Autres éléments"
          description="Boîte de dialogue, menu, case à cocher, pagination, copie, période, séparateur."
        >
          <Demo>
            <div className="flex flex-wrap items-center gap-3">
              <DialogDemo />
              <MenuDemo />
            </div>
            <Separator className="my-6" />
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-note font-medium text-muted-foreground">Copier une adresse</p>
                <CopyField value="https://go.goolink.eu/ab12cd" label="Lien de la pub" />
              </div>
              <div className="space-y-2">
                <p className="text-note font-medium text-muted-foreground">Période</p>
                <PeriodSelect period={period} compare={sp.compare === "1"} action="/styleguide" />
              </div>
            </div>
            <Separator className="my-6" />
            <Pagination
              page={page}
              pages={8}
              total={384}
              noun="membre"
              hrefFor={(n) => `${pageHref("/styleguide", sp, n)}#autres`}
            />
          </Demo>
        </Section>
      </div>
    </>
  );
}
