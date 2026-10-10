import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { CopyField } from "@/components/admin/copy-field";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { env } from "@/lib/env";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { ActiveBadge, StatusBadge } from "@/lib/status-badges";
import {
  DEFAULT_MAPPING,
  normalizeMapping,
  postbackUrlTemplate,
  summarizeParams,
} from "@/lib/postback/parse";
import {
  createEndpointAction,
  regenerateTokenAction,
  testPostbackAction,
  toggleEndpointAction,
  updateEndpointAction,
} from "./actions";

export const metadata: Metadata = { title: "Retour du casino (postbacks)" };

/** Route d'export (fichier CSV, pas une page : lien classique). */
const PLAYERS_EXPORT = "/members/players/export";

function safeMapping(raw: unknown) {
  try {
    return normalizeMapping(raw);
  } catch {
    return DEFAULT_MAPPING;
  }
}

export default async function PostbacksPage({ searchParams }: PageProps<"/settings/postbacks">) {
  await requireAdminPage();
  const sp = await searchParams;
  const openId = typeof sp.endpoint === "string" ? sp.endpoint : null;
  const [endpoints, programs, logs] = await Promise.all([
    prisma.postbackEndpoint.findMany({
      orderBy: { createdAt: "asc" },
      include: { program: { select: { name: true } }, _count: { select: { logs: true } } },
    }),
    prisma.affiliateProgram.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, source: true },
    }),
    prisma.postbackLog.findMany({
      orderBy: { receivedAt: "desc" },
      take: 50,
      include: { endpoint: { select: { name: true, mapping: true } } },
    }),
  ]);
  const base = env.appBaseUrl;

  return (
    <>
      <PageHeader
        title="Retour du casino (postbacks)"
        description="Un postback est un appel automatique qu'un partenaire envoie à notre site à chaque inscription, dépôt ou revenu. Une adresse par programme ; l'identifiant de suivi (sub-ID) relie le joueur au membre et au message."
        help="Créez une adresse pour le programme, copiez l'URL et donnez-la au partenaire. Les programmes Link Affi n'en ont pas besoin : ils sont lus automatiquement."
      >
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<a href={PLAYERS_EXPORT} />}
        >
          Exporter les joueurs (CSV)
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings/postbacks/import" />}
        >
          Importer un CSV de joueurs
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings" />}
        >
          ← Réglages
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-4">
        {endpoints.length === 0 ? (
          <EmptyState
            title="Aucune adresse de postback pour l'instant."
            description="Créez-en une ci-dessous pour chaque programme capable d'envoyer des postbacks. Les programmes Link Affi n'en ont pas besoin : ils sont synchronisés automatiquement."
          />
        ) : null}
        {endpoints.map((ep) => {
          const mapping = safeMapping(ep.mapping);
          const open = openId === ep.id;
          return (
            <Card key={ep.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="text-base">
                    {ep.name}{" "}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {ep.program.name}
                    </span>
                  </CardTitle>
                  <CardDescription>
                    <ActiveBadge active={ep.isActive} />
                    <span className="ml-2">
                      {ep._count.logs} postback{ep._count.logs > 1 ? "s" : ""} reçu
                      {ep._count.logs > 1 ? "s" : ""} · dernier : {fmtDate(ep.lastReceivedAt)}
                    </span>
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={toggleEndpointAction}>
                    <input type="hidden" name="endpointId" value={ep.id} />
                    {ep.isActive ? (
                      <ConfirmSubmit
                        size="sm"
                        variant="outline"
                        className="max-md:h-10"
                        message={`L'adresse « ${ep.name} » sera désactivée : les postbacks du partenaire seront refusés jusqu'à réactivation. Continuer ?`}
                      >
                        Désactiver
                      </ConfirmSubmit>
                    ) : (
                      <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                        Activer
                      </Button>
                    )}
                  </form>
                  <form action={regenerateTokenAction}>
                    <input type="hidden" name="endpointId" value={ep.id} />
                    <ConfirmSubmit
                      size="sm"
                      variant="ghost"
                      className="max-md:h-10"
                      message="Une nouvelle URL sera générée et l'ancienne cessera de fonctionner immédiatement : il faudra redonner la nouvelle URL au partenaire. Continuer ?"
                    >
                      Régénérer l&apos;URL
                    </ConfirmSubmit>
                  </form>
                  <Button
                    size="sm"
                    variant={open ? "secondary" : "ghost"}
                    className="max-md:h-10"
                    render={
                      <Link
                        href={
                          open ? "/settings/postbacks" : `/settings/postbacks?endpoint=${ep.id}`
                        }
                      />
                    }
                  >
                    {open ? "Fermer" : "Modifier / tester"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">
                    URL à donner au partenaire (il remplace les accolades par ses propres variables)
                  </Label>
                  <CopyField value={postbackUrlTemplate(base, ep.token, mapping)} />
                </div>
                {open ? (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <form action={updateEndpointAction} className="space-y-3">
                      <input type="hidden" name="endpointId" value={ep.id} />
                      <div className="space-y-1">
                        <Label htmlFor={`name-${ep.id}`}>Nom</Label>
                        <Input
                          id={`name-${ep.id}`}
                          name="name"
                          defaultValue={ep.name}
                          required
                          className="h-10 md:h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`mapping-${ep.id}`}>
                          Correspondance des paramètres (JSON, pour les cas particuliers)
                        </Label>
                        <textarea
                          id={`mapping-${ep.id}`}
                          name="mapping"
                          rows={10}
                          defaultValue={JSON.stringify(mapping, null, 2)}
                          className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                        />
                        <p className="text-xs text-muted-foreground">
                          Clés sub_id, player_id, event, amount, currency, txid, date = noms des
                          paramètres envoyés par le partenaire ; eventMap = valeur reçue →
                          REGISTRATION (inscription), FTD (premier dépôt), DEPOSIT, REDEPOSIT, NGR
                          (revenu net) ou OTHER.
                        </p>
                      </div>
                      <Button type="submit" size="sm" className="max-md:h-10">
                        Enregistrer
                      </Button>
                    </form>
                    <form action={testPostbackAction} className="space-y-3 rounded-md border p-3">
                      <input type="hidden" name="endpointId" value={ep.id} />
                      <p className="text-sm font-medium">Envoyer un postback de test</p>
                      <p className="text-xs text-muted-foreground">
                        Crée un joueur fictif (identifiant « test-… »). Avec un identifiant de suivi
                        existant, il sera rattaché au membre correspondant.
                      </p>
                      <div className="space-y-1">
                        <Label htmlFor={`sub-${ep.id}`}>
                          Identifiant de suivi (sub-ID), facultatif
                        </Label>
                        <Input
                          id={`sub-${ep.id}`}
                          name="subId"
                          placeholder="12 caractères"
                          className="h-10 md:h-9"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label htmlFor={`ev-${ep.id}`}>Événement</Label>
                          <select
                            id={`ev-${ep.id}`}
                            name="event"
                            defaultValue="registration"
                            className="h-10 w-full rounded-md border bg-background px-2 text-sm md:h-9"
                          >
                            {Object.keys(mapping.eventMap).map((k) => (
                              <option key={k} value={k}>
                                {k} → {mapping.eventMap[k]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`am-${ep.id}`}>Montant</Label>
                          <Input
                            id={`am-${ep.id}`}
                            name="amount"
                            placeholder="20"
                            className="h-10 md:h-9"
                          />
                        </div>
                      </div>
                      <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                        Envoyer le test
                      </Button>
                    </form>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6 max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Nouvelle adresse de postback</CardTitle>
          <CardDescription>
            Choisissez le programme. La correspondance par défaut convient à la plupart des
            partenaires ; ajustez-la seulement si leurs noms de paramètres diffèrent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createEndpointAction} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="programId">Programme</Label>
              <select
                id="programId"
                name="programId"
                required
                className="h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9"
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.source !== "LINKAFFI" ? ` (${p.source})` : ""}
                  </option>
                ))}
              </select>
              {programs.length === 0 ? (
                <p className="text-xs text-destructive">
                  Aucun programme : attendez la synchronisation Link Affi.
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">Nom</Label>
              <Input
                id="name"
                name="name"
                placeholder="ex. Celsius — postbacks"
                required
                className="h-10 md:h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mapping">Correspondance des paramètres (JSON, facultatif)</Label>
              <textarea
                id="mapping"
                name="mapping"
                rows={6}
                placeholder={JSON.stringify(DEFAULT_MAPPING, null, 2)}
                className="w-full rounded-md border bg-background p-2 font-mono text-xs"
              />
            </div>
            <Button type="submit" className="max-md:h-10" disabled={programs.length === 0}>
              Créer l&apos;adresse
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Derniers postbacks reçus</CardTitle>
          <CardDescription>
            Les 50 derniers, toutes adresses confondues. L&apos;identifiant joueur est tronqué.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Rien reçu pour l&apos;instant. Utilisez « Modifier / tester » sur une adresse pour
              envoyer un postback de test.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead className="hidden md:table-cell">Adresse</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="hidden lg:table-cell">Paramètres</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtDate(l.receivedAt)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{l.endpoint.name}</TableCell>
                    <TableCell>
                      <StatusBadge kind="postback" value={l.status} />
                    </TableCell>
                    <TableCell className="hidden font-mono text-[11px] text-muted-foreground lg:table-cell">
                      {summarizeParams(l.raw, safeMapping(l.endpoint.mapping))}
                    </TableCell>
                    <TableCell className="whitespace-normal text-xs">{l.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
