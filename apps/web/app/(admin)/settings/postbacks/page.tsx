import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { CopyField } from "@/components/admin/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { env } from "@/lib/env";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { DEFAULT_MAPPING, normalizeMapping, postbackUrlTemplate, summarizeParams } from "@/lib/postback/parse";
import { createEndpointAction, regenerateTokenAction, testPostbackAction, toggleEndpointAction, updateEndpointAction } from "./actions";

export const metadata: Metadata = { title: "Postbacks" };

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
    prisma.postbackEndpoint.findMany({ orderBy: { createdAt: "asc" }, include: { program: { select: { name: true } }, _count: { select: { logs: true } } } }),
    prisma.affiliateProgram.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, source: true } }),
    prisma.postbackLog.findMany({ orderBy: { receivedAt: "desc" }, take: 50, include: { endpoint: { select: { name: true, mapping: true } } } }),
  ]);
  const base = env.appBaseUrl;

  return (
    <>
      <PageHeader title="Postbacks directs" description="Un endpoint par programme : le programme appelle cette URL à chaque inscription, dépôt ou revenu. Le sub-ID relie le joueur au membre et au message.">
        <Button variant="outline" size="sm" render={<Link href="/settings/postbacks/import" />}>Importer un CSV de joueurs</Button>
        <Button variant="outline" size="sm" render={<Link href="/settings" />}>Retour aux réglages</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-4">
        {endpoints.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">Aucun endpoint. Créez-en un ci-dessous pour chaque programme qui sait envoyer des postbacks (les programmes Link Affi n&apos;en ont pas besoin : ils sont synchronisés automatiquement).</CardContent>
          </Card>
        ) : null}
        {endpoints.map((ep) => {
          const mapping = safeMapping(ep.mapping);
          const open = openId === ep.id;
          return (
            <Card key={ep.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="text-base">
                    {ep.name} <span className="ml-2 text-sm font-normal text-muted-foreground">{ep.program.name}</span>
                  </CardTitle>
                  <CardDescription>
                    {ep.isActive ? <Badge>actif</Badge> : <Badge variant="secondary">désactivé</Badge>}
                    <span className="ml-2">{ep._count.logs} postback(s) reçu(s) · dernier : {fmtDate(ep.lastReceivedAt)}</span>
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={toggleEndpointAction}>
                    <input type="hidden" name="endpointId" value={ep.id} />
                    <Button type="submit" size="sm" variant="outline">{ep.isActive ? "Désactiver" : "Activer"}</Button>
                  </form>
                  <form action={regenerateTokenAction}>
                    <input type="hidden" name="endpointId" value={ep.id} />
                    <Button type="submit" size="sm" variant="ghost">Régénérer le jeton</Button>
                  </form>
                  <Button size="sm" variant={open ? "secondary" : "ghost"} render={<Link href={open ? "/settings/postbacks" : `/settings/postbacks?endpoint=${ep.id}`} />}>{open ? "Fermer" : "Modifier / tester"}</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">URL à donner au programme (remplacez les accolades par ses macros)</Label>
                  <CopyField value={postbackUrlTemplate(base, ep.token, mapping)} />
                </div>
                {open ? (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <form action={updateEndpointAction} className="space-y-3">
                      <input type="hidden" name="endpointId" value={ep.id} />
                      <div className="space-y-1">
                        <Label htmlFor={`name-${ep.id}`}>Nom</Label>
                        <Input id={`name-${ep.id}`} name="name" defaultValue={ep.name} required />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`mapping-${ep.id}`}>Mapping des paramètres (JSON)</Label>
                        <textarea id={`mapping-${ep.id}`} name="mapping" rows={10} defaultValue={JSON.stringify(mapping, null, 2)} className="w-full rounded-md border bg-background p-2 font-mono text-xs" />
                        <p className="text-xs text-muted-foreground">Clés : sub_id, player_id, event, amount, currency, txid, date = noms des paramètres envoyés par le programme ; eventMap = valeur reçue → REGISTRATION, FTD, DEPOSIT, REDEPOSIT, NGR ou OTHER.</p>
                      </div>
                      <Button type="submit" size="sm">Enregistrer</Button>
                    </form>
                    <form action={testPostbackAction} className="space-y-3 rounded-md border p-3">
                      <input type="hidden" name="endpointId" value={ep.id} />
                      <p className="text-sm font-medium">Envoyer un postback de test</p>
                      <p className="text-xs text-muted-foreground">Crée un joueur fictif (identifiant « test-… »). Avec un sub-ID existant, il sera rattaché au membre correspondant.</p>
                      <div className="space-y-1">
                        <Label htmlFor={`sub-${ep.id}`}>sub_id (optionnel)</Label>
                        <Input id={`sub-${ep.id}`} name="subId" placeholder="12 caractères" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label htmlFor={`ev-${ep.id}`}>Événement</Label>
                          <select id={`ev-${ep.id}`} name="event" defaultValue="registration" className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                            {Object.keys(mapping.eventMap).map((k) => (
                              <option key={k} value={k}>{k} → {mapping.eventMap[k]}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`am-${ep.id}`}>Montant</Label>
                          <Input id={`am-${ep.id}`} name="amount" placeholder="20" />
                        </div>
                      </div>
                      <Button type="submit" size="sm" variant="outline">Envoyer le test</Button>
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
          <CardTitle className="text-base">Nouvel endpoint</CardTitle>
          <CardDescription>Choisissez le programme. Le mapping par défaut convient à la plupart des programmes ; ajustez-le si leurs noms de paramètres diffèrent.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createEndpointAction} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="programId">Programme</Label>
              <select id="programId" name="programId" required className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.source !== "LINKAFFI" ? ` (${p.source})` : ""}</option>
                ))}
              </select>
              {programs.length === 0 ? <p className="text-xs text-destructive">Aucun programme : attendez la synchronisation Link Affi ou créez-en un.</p> : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">Nom</Label>
              <Input id="name" name="name" placeholder="ex. Celsius — postbacks" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mapping">Mapping (JSON, optionnel)</Label>
              <textarea id="mapping" name="mapping" rows={6} placeholder={JSON.stringify(DEFAULT_MAPPING, null, 2)} className="w-full rounded-md border bg-background p-2 font-mono text-xs" />
            </div>
            <Button type="submit" disabled={programs.length === 0}>Créer l&apos;endpoint</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Derniers postbacks reçus</CardTitle>
          <CardDescription>Les 50 derniers, tous endpoints confondus. L&apos;identifiant joueur est tronqué.</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Rien reçu pour l&apos;instant.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Paramètres</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(l.receivedAt)}</TableCell>
                    <TableCell>{l.endpoint.name}</TableCell>
                    <TableCell>
                      {l.status === "ACCEPTED" ? <Badge>accepté</Badge> : l.status === "IGNORED" ? <Badge variant="secondary">ignoré</Badge> : <Badge variant="destructive">erreur</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{summarizeParams(l.raw, safeMapping(l.endpoint.mapping))}</TableCell>
                    <TableCell className="text-xs">{l.message}</TableCell>
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
