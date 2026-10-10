import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus, Upload } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { CopyField } from "@/components/admin/copy-field";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { SidePanel } from "@/components/admin/side-panel";
import { DetailList, DetailRow } from "@/components/settings/detail-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { env } from "@/lib/env";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { ActiveBadge, StatusBadge, statusLabel } from "@/lib/status-badges";
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
import { eventOptionLabel, receivedSummary } from "./postback-view";

export const metadata: Metadata = { title: "Retours du casino (postbacks)" };

/** Route d'export (fichier CSV, pas une page : lien classique). */
const PLAYERS_EXPORT = "/members/players/export";

function safeMapping(raw: unknown) {
  try {
    return normalizeMapping(raw);
  } catch {
    return DEFAULT_MAPPING;
  }
}

/** Aide du champ JSON de correspondance (réglage technique, dans « Avancé »). */
function MappingHelp({ id }: { id: string }) {
  return (
    <p id={id} className="text-note text-muted-foreground">
      Clés sub_id, player_id, event, amount, currency, txid, date = noms des paramètres envoyés par
      le partenaire ; eventMap = valeur reçue → REGISTRATION (inscription), FTD (premier dépôt),
      DEPOSIT (dépôt), REDEPOSIT (nouveau dépôt), NGR (revenu net) ou OTHER.
    </p>
  );
}

/**
 * Réglages → Avancé → Retours du casino (postbacks) : une adresse par programme partenaire, à copier et à lui donner.
 * Chaque adresse montre son lien et ses compteurs ; « Modifier et tester » ouvre un volet (état, nom, correspondance
 * des paramètres dans « Avancé », retour de test). Les 50 derniers retours sont dans un tableau de 4 colonnes avec le
 * détail des paramètres au clic. Mêmes champs et mêmes actions serveur qu'avant (`?endpoint=` rouvre le volet).
 */
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
  const openEndpoint = endpoints.find((e) => e.id === openId) ?? null;
  // Après une action, les volets repartent de zéro (celui de l'adresse modifiée se rouvre avec le résultat).
  const flashKey = JSON.stringify([sp.ok ?? null, sp.error ?? null]);

  const createPanel = (
    <SidePanel
      key={`create-${flashKey}`}
      title="Nouvelle adresse de retour"
      description="Une adresse par programme partenaire. Vous la copierez ensuite pour la donner au partenaire."
      size="lg"
      trigger={
        <Button className="max-md:h-10">
          <Plus aria-hidden />
          Nouvelle adresse
        </Button>
      }
    >
      <form action={createEndpointAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="programId">Programme</Label>
          <NativeSelect id="programId" name="programId" required wrapperClassName="w-full">
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.source !== "LINKAFFI" ? ` (${p.source})` : ""}
              </option>
            ))}
          </NativeSelect>
          {programs.length === 0 ? (
            <p className="text-note text-danger">
              Aucun programme : attendez la synchronisation Link Affi.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Nom</Label>
          <Input id="name" name="name" placeholder="Ex. Celsius : retours" required />
        </div>
        <AdvancedSection
          title="Avancé : correspondance des paramètres"
          description="Seulement si le partenaire nomme ses paramètres autrement. Vide = réglage par défaut."
        >
          <div className="space-y-2">
            <Label htmlFor="mapping">Correspondance des paramètres (JSON, facultatif)</Label>
            <Textarea
              id="mapping"
              name="mapping"
              rows={8}
              placeholder={JSON.stringify(DEFAULT_MAPPING, null, 2)}
              className="font-mono md:text-note"
              aria-describedby="mapping-aide"
            />
            <MappingHelp id="mapping-aide" />
          </div>
        </AdvancedSection>
        <Button type="submit" className="max-md:h-10" disabled={programs.length === 0}>
          Créer l&apos;adresse
        </Button>
      </form>
    </SidePanel>
  );

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Retours du casino (postbacks)"
        description={
          <>
            Un <Term term="postback">retour du casino</Term> est un appel automatique que le
            partenaire envoie au site à chaque inscription, dépôt ou revenu. Le joueur est alors
            relié au membre et au message par son <Term term="sub-ID">identifiant de suivi</Term>.
          </>
        }
        help="Créez une adresse pour le programme, copiez-la et donnez-la au partenaire. Les programmes Link Affi n'en ont pas besoin : ils sont lus tout seuls."
        primaryAction={createPanel}
      />
      {openEndpoint ? null : <Flash ok={sp.ok} error={sp.error} />}

      <div className="space-y-10">
        <FormSection
          title="Adresses"
          description="Une par programme. Le partenaire remplace les accolades de l'adresse par ses propres valeurs."
        >
          {endpoints.length === 0 ? (
            <EmptyState
              title="Aucune adresse pour l'instant"
              description="Créez-en une pour chaque programme capable d'envoyer ses retours (bouton « Nouvelle adresse »). Les programmes Link Affi n'en ont pas besoin."
            />
          ) : (
            <ul className="space-y-3">
              {endpoints.map((ep) => {
                const mapping = safeMapping(ep.mapping);
                const url = postbackUrlTemplate(base, ep.token, mapping);
                const open = openEndpoint?.id === ep.id;
                return (
                  <li key={ep.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">{ep.name}</span>
                          <ActiveBadge active={ep.isActive} />
                        </div>
                        <p className="text-note text-muted-foreground">
                          {ep.program.name} · {receivedSummary(ep._count.logs, ep.lastReceivedAt)}
                        </p>
                      </div>
                      <SidePanel
                        key={`ep-${ep.id}-${open ? flashKey : "closed"}`}
                        defaultOpen={open}
                        size="lg"
                        title={ep.name}
                        description={`${ep.program.name} · ${receivedSummary(ep._count.logs, ep.lastReceivedAt)}`}
                        trigger={
                          <Button variant="outline" size="sm" className="max-md:h-10">
                            Modifier et tester
                          </Button>
                        }
                      >
                        <div className="space-y-8">
                          {open ? <Flash ok={sp.ok} error={sp.error} /> : null}

                          <section className="space-y-3">
                            <h3 className="text-body font-semibold text-foreground">
                              Adresse à donner au partenaire
                            </h3>
                            <CopyField value={url} label={`Adresse de retour pour ${ep.name}`} />
                            <div className="flex flex-wrap items-center gap-2">
                              <form action={toggleEndpointAction}>
                                <input type="hidden" name="endpointId" value={ep.id} />
                                {ep.isActive ? (
                                  <ConfirmSubmit
                                    variant="outline"
                                    className="max-md:h-10"
                                    confirmTitle={`Désactiver « ${ep.name} »\u00a0?`}
                                    confirmLabel="Désactiver"
                                    destructive
                                    message="Les retours de ce partenaire seront refusés jusqu'à la réactivation de l'adresse."
                                  >
                                    Désactiver
                                  </ConfirmSubmit>
                                ) : (
                                  <Button type="submit" variant="outline" className="max-md:h-10">
                                    Activer
                                  </Button>
                                )}
                              </form>
                              <form action={regenerateTokenAction}>
                                <input type="hidden" name="endpointId" value={ep.id} />
                                <ConfirmSubmit
                                  variant="ghost"
                                  className="max-md:h-10"
                                  confirmTitle={"Changer l'adresse\u00a0?"}
                                  confirmLabel="Changer l'adresse"
                                  destructive
                                  message="Une nouvelle adresse est créée et l'ancienne cesse de fonctionner tout de suite : il faudra donner la nouvelle au partenaire."
                                >
                                  Changer l&apos;adresse
                                </ConfirmSubmit>
                              </form>
                            </div>
                          </section>

                          <form
                            action={updateEndpointAction}
                            className="space-y-4 border-t border-border pt-6"
                          >
                            <input type="hidden" name="endpointId" value={ep.id} />
                            <h3 className="text-body font-semibold text-foreground">Modifier</h3>
                            <div className="space-y-2">
                              <Label htmlFor={`name-${ep.id}`}>Nom</Label>
                              <Input
                                id={`name-${ep.id}`}
                                name="name"
                                defaultValue={ep.name}
                                required
                              />
                            </div>
                            <AdvancedSection
                              title="Avancé : correspondance des paramètres"
                              description="Pour les partenaires qui nomment leurs paramètres autrement."
                            >
                              <div className="space-y-2">
                                <Label htmlFor={`mapping-${ep.id}`}>
                                  Correspondance des paramètres (JSON)
                                </Label>
                                <Textarea
                                  id={`mapping-${ep.id}`}
                                  name="mapping"
                                  rows={10}
                                  defaultValue={JSON.stringify(mapping, null, 2)}
                                  className="font-mono md:text-note"
                                  aria-describedby={`mapping-${ep.id}-aide`}
                                />
                                <MappingHelp id={`mapping-${ep.id}-aide`} />
                              </div>
                            </AdvancedSection>
                            <Button type="submit" className="max-md:h-10">
                              Enregistrer
                            </Button>
                          </form>

                          <form
                            action={testPostbackAction}
                            className="space-y-4 border-t border-border pt-6"
                          >
                            <input type="hidden" name="endpointId" value={ep.id} />
                            <div className="space-y-1">
                              <h3 className="text-body font-semibold text-foreground">
                                Envoyer un retour de test
                              </h3>
                              <p className="text-note text-muted-foreground">
                                Crée un joueur fictif (identifiant « test-… »). Avec un identifiant
                                de suivi existant, il est rattaché au membre correspondant.
                              </p>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`sub-${ep.id}`}>
                                <span>
                                  <Term term="sub-ID">Identifiant de suivi</Term> (facultatif)
                                </span>
                              </Label>
                              <Input
                                id={`sub-${ep.id}`}
                                name="subId"
                                placeholder="12 caractères"
                                autoComplete="off"
                              />
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="space-y-2">
                                <Label htmlFor={`ev-${ep.id}`}>Événement</Label>
                                <NativeSelect
                                  id={`ev-${ep.id}`}
                                  name="event"
                                  defaultValue="registration"
                                  wrapperClassName="w-full"
                                >
                                  {Object.keys(mapping.eventMap).map((k) => (
                                    <option key={k} value={k}>
                                      {eventOptionLabel(k, mapping.eventMap[k]!)}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`am-${ep.id}`}>Montant</Label>
                                <Input
                                  id={`am-${ep.id}`}
                                  name="amount"
                                  placeholder="20"
                                  inputMode="decimal"
                                />
                              </div>
                            </div>
                            <Button type="submit" variant="outline" className="max-md:h-10">
                              Envoyer le test
                            </Button>
                          </form>
                        </div>
                      </SidePanel>
                    </div>
                    <CopyField value={url} label={`Adresse de retour pour ${ep.name}`} />
                  </li>
                );
              })}
            </ul>
          )}
        </FormSection>

        <FormSection
          title="Fichiers de joueurs"
          description="Pour un partenaire qui n'envoie rien tout seul : importez son fichier de joueurs. L'export donne tous les joueurs connus."
        >
          <div className="flex flex-wrap gap-2">
            <Link
              href="/settings/postbacks/import"
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              <Upload aria-hidden />
              Importer des joueurs (CSV)
            </Link>
            <a
              href={PLAYERS_EXPORT}
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              <Download aria-hidden />
              Exporter les joueurs (CSV)
            </a>
          </div>
        </FormSection>

        <FormSection
          title="Derniers retours reçus"
          description="Les 50 derniers, toutes adresses confondues. Cliquez sur une ligne pour voir ses paramètres."
        >
          <DataTable
            label="Derniers retours reçus"
            columns={[
              { key: "when", header: "Reçu le" },
              { key: "endpoint", header: "Adresse", hideOnMobile: true },
              { key: "status", header: "Statut" },
              {
                key: "message",
                header: "Résultat",
                hideOnMobile: true,
                className: "min-w-48 whitespace-normal",
              },
            ]}
            rows={logs.map((l) => {
              const params = summarizeParams(l.raw, safeMapping(l.endpoint.mapping));
              return {
                id: l.id,
                cells: {
                  when: fmtDate(l.receivedAt),
                  endpoint: l.endpoint.name,
                  status: <StatusBadge kind="postback" value={l.status} />,
                  message: <span className="line-clamp-2">{l.message}</span>,
                },
                sortValues: {
                  when: l.receivedAt,
                  status: statusLabel("postback", l.status),
                  message: l.message ?? "",
                },
                detailTitle: `Retour du ${fmtDate(l.receivedAt)}`,
                detailDescription: l.endpoint.name,
                detail: (
                  <DetailList>
                    <DetailRow label="Statut">
                      <StatusBadge kind="postback" value={l.status} />
                    </DetailRow>
                    <DetailRow label="Résultat">{l.message ?? "—"}</DetailRow>
                    <DetailRow label="Adresse">{l.endpoint.name}</DetailRow>
                    <DetailRow label="Paramètres" mono>
                      {params || "—"}
                    </DetailRow>
                  </DetailList>
                ),
              };
            })}
            empty={{
              title: "Rien reçu pour l'instant",
              description:
                "Ouvrez une adresse (« Modifier et tester ») pour envoyer un retour de test.",
            }}
          />
        </FormSection>
      </div>
    </>
  );
}
