import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { fmtDate, fmtDateShort, fmtNum } from "@/lib/format";
import { StatusBadge, statusLabel, type SyncStatus } from "@/lib/status-badges";
import { DetailList, DetailRow } from "@/components/admin/detail-list";

type ConnectionStatus = "ACTIVE" | "NEEDS_RECONNECT" | "DISABLED";

export type AdAccountRun = {
  id: string;
  startedAt: Date;
  dateFrom: Date;
  dateTo: Date;
  rows: number;
  status: string;
  error: string | null;
};

export type AdAccount = {
  id: string;
  name: string;
  externalId: string;
  currency: string;
  timezone: string | null;
  businessName: string | null;
  status: ConnectionStatus;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  lastSyncAt: Date | null;
  lastSyncRows: number;
  lastError: string | null;
  createdAt: Date;
  connectedBy: { name: string } | null;
  runs: AdAccountRun[];
};

type FormAction = (formData: FormData) => void | Promise<void>;

function runStatus(status: string): SyncStatus {
  return status === "ok" || status === "error" || status === "running" ? status : "never";
}

const WEEK_MS = 7 * 86_400_000;

/**
 * Comptes publicitaires d'une plateforme (Meta ou TikTok) : tableau de 4 colonnes, détail dans le volet latéral
 * (identifiant, devise, connexion, dernières synchronisations) avec les actions de toujours : synchroniser,
 * resynchroniser 28 jours, reconnecter, déconnecter (administrateurs). Composant serveur : les actions serveur
 * de la plateforme sont passées en props. `now` sert aussi de clé du tableau : renouvelé à chaque rendu de la page, il
 * ferme le volet ouvert après une action (« Synchroniser », « Déconnecter ») au lieu de montrer l'état d'avant.
 */
export function AdAccountsTable({
  platform,
  accounts,
  isAdmin,
  now,
  syncAction,
  disconnectAction,
  reconnect,
  syncWhen,
  disconnectMessage,
  empty,
}: {
  platform: "META" | "TIKTOK";
  accounts: readonly AdAccount[];
  isAdmin: boolean;
  now: Date;
  syncAction: FormAction;
  disconnectAction: FormAction;
  /** Lien de reconnexion, ou raison pour laquelle il est indisponible. */
  reconnect: { href: string } | { disabledReason: string };
  /** Comptes qu'on peut synchroniser à la main : actifs seulement (TikTok) ou tous sauf déconnectés (Meta). */
  syncWhen: "active" | "notDisabled";
  disconnectMessage: (name: string) => string;
  empty: { title: string; description: string };
}) {
  const label = platform === "META" ? "Comptes Meta connectés" : "Comptes TikTok connectés";
  const soon = new Date(now.getTime() + WEEK_MS);
  return (
    <DataTable
      key={`${platform}-${now.getTime()}`}
      label={label}
      columns={[
        { key: "name", header: "Compte", className: "min-w-40 whitespace-normal" },
        { key: "status", header: "État" },
        platform === "META"
          ? { key: "token", header: "Accès valable jusqu'au", hideOnMobile: true }
          : { key: "currency", header: "Devise", hideOnMobile: true },
        { key: "sync", header: "Dernière synchro", hideOnMobile: true },
      ]}
      rows={accounts.map((c) => {
        const expiring =
          c.status === "ACTIVE" && c.tokenExpiresAt !== null && c.tokenExpiresAt < soon;
        const canSync = syncWhen === "active" ? c.status === "ACTIVE" : c.status !== "DISABLED";
        const tokenText = c.status === "DISABLED" ? "—" : fmtDateShort(c.tokenExpiresAt, now);
        return {
          id: c.id,
          cells: {
            name: c.name,
            status: <StatusBadge kind="connection" value={c.status} />,
            token: <span className={expiring ? "text-warning" : undefined}>{tokenText}</span>,
            currency: c.currency,
            sync: c.lastSyncAt ? fmtDate(c.lastSyncAt) : "—",
          },
          sortValues: {
            status: statusLabel("connection", c.status),
            token: c.tokenExpiresAt && c.status !== "DISABLED" ? c.tokenExpiresAt.getTime() : null,
          },
          detailTitle: c.name,
          detailDescription: `${c.externalId} · ${c.currency}`,
          detail: (
            <div className="space-y-6">
              <DetailList>
                <DetailRow label="État">
                  <StatusBadge kind="connection" value={c.status} />
                </DetailRow>
                <DetailRow label="Identifiant" mono>
                  {c.externalId}
                </DetailRow>
                <DetailRow label="Devise">
                  {c.currency}
                  {c.timezone ? ` · ${c.timezone}` : ""}
                </DetailRow>
                {c.businessName ? (
                  <DetailRow label="Business Manager">{c.businessName}</DetailRow>
                ) : null}
                <DetailRow label="Connecté">
                  le {fmtDate(c.createdAt)}
                  {c.connectedBy ? ` par ${c.connectedBy.name}` : ""}
                  {c.scopes === "sandbox" ? " · bac à sable" : ""}
                </DetailRow>
                {platform === "META" ? (
                  <DetailRow label="Accès valable jusqu'au">
                    <span className={expiring ? "text-warning" : undefined}>{tokenText}</span>
                    {expiring ? " (renouvellement automatique)" : ""}
                  </DetailRow>
                ) : null}
                <DetailRow label="Dernière synchro">
                  {c.lastSyncAt
                    ? `${fmtDate(c.lastSyncAt)} · ${fmtNum(c.lastSyncRows)} lignes`
                    : "Jamais"}
                </DetailRow>
                {c.lastError ? (
                  <DetailRow label="Dernière erreur">
                    <span className="text-danger">{c.lastError}</span>
                  </DetailRow>
                ) : null}
              </DetailList>

              {c.runs.length > 0 ? (
                <section aria-labelledby={`runs-${c.id}`} className="space-y-2">
                  <h3 id={`runs-${c.id}`} className="text-body font-semibold text-foreground">
                    {c.runs.length > 1
                      ? `${c.runs.length} dernières synchronisations`
                      : "Dernière synchronisation"}
                  </h3>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {c.runs.map((r) => (
                      <li key={r.id} className="space-y-1 px-3 py-2 text-note">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge kind="sync" value={runStatus(r.status)} />
                          <span className="text-muted-foreground">{fmtDate(r.startedAt)}</span>
                        </div>
                        <div className="text-foreground">
                          Du {fmtDateShort(r.dateFrom, now)} au {fmtDateShort(r.dateTo, now)} ·{" "}
                          {fmtNum(r.rows)} lignes
                        </div>
                        {r.error ? (
                          <p className={r.status === "error" ? "text-danger" : "text-warning"}>
                            {r.error}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {isAdmin ? (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  {canSync ? (
                    <>
                      <form action={syncAction}>
                        <input type="hidden" name="connectionId" value={c.id} />
                        <input type="hidden" name="mode" value="recent" />
                        <Button type="submit" variant="outline" className="max-md:h-10">
                          Synchroniser maintenant
                        </Button>
                      </form>
                      <form action={syncAction}>
                        <input type="hidden" name="connectionId" value={c.id} />
                        <input type="hidden" name="mode" value="full" />
                        <Button type="submit" variant="outline" className="max-md:h-10">
                          Resynchroniser 28 jours
                        </Button>
                      </form>
                    </>
                  ) : null}
                  {"href" in reconnect ? (
                    <a
                      href={reconnect.href}
                      className={cn(
                        buttonVariants({
                          variant: c.status === "NEEDS_RECONNECT" ? "default" : "outline",
                        }),
                        "max-md:h-10",
                      )}
                    >
                      Reconnecter
                    </a>
                  ) : (
                    <Button
                      variant="outline"
                      className="max-md:h-10"
                      disabled
                      title={reconnect.disabledReason}
                    >
                      Reconnecter
                    </Button>
                  )}
                  {c.status !== "DISABLED" ? (
                    <form action={disconnectAction}>
                      <input type="hidden" name="connectionId" value={c.id} />
                      <ConfirmSubmit
                        variant="destructive"
                        className="max-md:h-10"
                        confirmTitle="Déconnecter ce compte ?"
                        confirmLabel="Déconnecter"
                        message={disconnectMessage(c.name)}
                      >
                        Déconnecter
                      </ConfirmSubmit>
                    </form>
                  ) : null}
                  {"disabledReason" in reconnect ? (
                    <p className="w-full text-note text-muted-foreground">
                      {reconnect.disabledReason}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ),
        };
      })}
      empty={empty}
    />
  );
}
