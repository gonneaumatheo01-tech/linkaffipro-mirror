import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { isAccountSessionActive, listAccountChannels } from "@/lib/channels/account-import";
import { canaux } from "@/lib/channels/rights-message";
import { importChannelsFromAccountAction } from "../actions";

export const metadata: Metadata = { title: "Importer mes canaux" };
export const dynamic = "force-dynamic";

export default async function ImportChannelsPage({ searchParams }: PageProps<"/channels/import">) {
  await requireUser();
  const sp = await searchParams;
  const active = await isAccountSessionActive().catch(() => false);
  const listing = active ? await listAccountChannels() : null;
  const rows = listing?.ok ? listing.rows : [];
  const firstBot = listing?.ok ? listing.firstBot : null;
  const toImport = rows.filter((r) => !r.known);
  const prechecked = toImport.filter((r) => r.botAdmins.length > 0).length;

  return (
    <>
      <PageHeader
        title="Importer mes canaux"
        description="Les canaux et groupes dont votre compte Telegram connecté est administrateur ou créateur. Cochez ceux à ajouter à la plateforme."
        help="Les canaux où l'un de nos bots est déjà administrateur sont pré-cochés. Pour les autres, ajoutez d'abord le bot comme administrateur dans Telegram (rien n'est modifié automatiquement)."
      >
        <Button variant="outline" size="sm" className="max-md:h-10" render={<Link href="/channels" />}>
          ← Tous les canaux
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      {!active ? (
        <EmptyState
          title="Compte Telegram non connecté"
          description="Cette fonction lit la liste de vos canaux avec votre compte Telegram (le propriétaire des canaux). Connectez-le d'abord dans Réglages → Connexions → Telegram, puis revenez ici."
          action={{ href: "/settings/connectors/telegram", label: "Connecter mon compte Telegram", variant: "outline" }}
        />
      ) : listing && !listing.ok ? (
        <EmptyState
          title="Lecture des canaux impossible pour le moment"
          description={listing.error}
          action={{ href: "/channels/import", label: "Réessayer", variant: "outline" }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Aucun canal trouvé"
          description="Votre compte Telegram n'est administrateur ou créateur d'aucun canal parmi ses 500 derniers échanges."
          action={{ href: "/channels", label: "Retour aux canaux", variant: "outline" }}
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <form action={importChannelsFromAccountAction}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>
                  {canaux(rows.length)} trouvé{rows.length > 1 ? "s" : ""} · {fmtNum(toImport.length)} à importer ·{" "}
                  {fmtNum(prechecked)} pré-coché{prechecked > 1 ? "s" : ""}{" "}
                  <HelpTip label="Pourquoi certains ne sont pas cochés ?">
                    Un canal est pré-coché quand l&apos;un de nos bots en est déjà administrateur. Sinon, ajoutez le bot dans Telegram
                    (Canal → Administrateurs → Ajouter → @{firstBot ?? "votre_bot"}) ; vous pouvez quand même cocher le canal : il sera
                    ajouté sans bot administrateur.
                  </HelpTip>
                </span>
                <Button type="submit" className="max-md:h-10" disabled={toImport.length === 0}>
                  Importer les canaux cochés
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <span className="sr-only">Importer</span>
                    </TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead className="hidden md:table-cell">Membres</TableHead>
                    <TableHead>Nos bots administrateurs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const id = r.telegramChatId;
                    const cid = `imp-${id}`;
                    return (
                      <TableRow key={id}>
                        <TableCell className="align-top">
                          {r.known ? (
                            <span className="sr-only">Déjà ajouté</span>
                          ) : (
                            <>
                              <input
                                type="checkbox"
                                id={cid}
                                name="ids"
                                value={id}
                                defaultChecked={r.botAdmins.length > 0}
                                aria-label={`Importer ${r.title}`}
                                className="size-4"
                              />
                              <input type="hidden" name={`title_${id}`} value={r.title} />
                              <input type="hidden" name={`username_${id}`} value={r.username ?? ""} />
                              <input type="hidden" name={`broadcast_${id}`} value={r.isBroadcast ? "1" : "0"} />
                            </>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <label htmlFor={r.known ? undefined : cid} className="font-medium">
                            {r.title}
                          </label>
                          <div className="text-xs text-muted-foreground">
                            {r.username ? `@${r.username} · ` : ""}
                            {r.isBroadcast ? "canal" : "groupe"} · {r.isCreator ? "vous êtes le créateur" : "vous êtes administrateur"} · identifiant {id}
                          </div>
                          {r.known ? (
                            <Badge variant="outline" className="mt-1">
                              <Link href={`/channels/${r.known.id}`} className="hover:underline">
                                déjà ajouté
                              </Link>
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="hidden align-top text-sm md:table-cell">{r.memberCount === null ? "—" : fmtNum(r.memberCount)}</TableCell>
                        <TableCell className="align-top">
                          {r.botAdmins.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {r.botAdmins.map((u) => (
                                <Badge key={u} variant="outline">
                                  @{u}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-destructive">
                              {r.checkNote ?? "aucun"} : ajoutez @{firstBot ?? "votre_bot"} comme administrateur dans Telegram
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  );
}
