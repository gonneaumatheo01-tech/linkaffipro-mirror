import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { loadPending } from "@/lib/connectors/common";
import { fmtDateShort } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { cancelPendingMetaAction, connectChosenMetaAccountsAction } from "../actions";

export const metadata: Metadata = { title: "Choisir les comptes Meta" };
export const dynamic = "force-dynamic";

/** Après le retour de Facebook Login : liste des comptes publicitaires visibles, à cocher (15 minutes pour choisir). */
export default async function ChooseMetaAccountsPage({
  searchParams,
}: PageProps<"/settings/connectors/meta/choose">) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const pending = await loadPending("META", admin.id);
  const existing = pending
    ? await prisma.adAccountConnection.findMany({
        where: { platform: "META", externalId: { in: pending.accounts.map((a) => a.externalId) } },
        select: { externalId: true, status: true },
      })
    : [];
  const existingById = new Map(existing.map((e) => [e.externalId, e.status]));
  const now = new Date();
  const n = pending?.accounts.length ?? 0;

  return (
    <>
      <PageHeader
        backHref="/settings/connectors/meta"
        backLabel="Meta Ads"
        title="Choisir les comptes Meta"
        description="Cochez les comptes publicitaires à suivre. Les comptes déjà connectés sont cochés : les laisser cochés renouvelle leur connexion."
        help="Vous avez 15 minutes pour valider. Un compte fermé ou désactivé chez Meta peut être connecté mais ne renverra rien."
      />
      <Flash ok={sp.ok} error={sp.error} />

      {!pending ? (
        <EmptyState
          title="Aucune connexion Meta en attente"
          description="Le délai de 15 minutes est passé, ou la connexion n'a pas encore été lancée. Cliquez sur « Connecter un compte Meta » depuis la page Meta Ads."
          action={{
            href: "/settings/connectors/meta",
            label: "Retour à Meta Ads",
            variant: "outline",
          }}
        />
      ) : (
        <FormSection
          title={`${n} compte${n > 1 ? "s" : ""} visible${n > 1 ? "s" : ""} par votre profil Facebook`}
          description={`Accès Meta obtenu le ${fmtDateShort(new Date(pending.createdAt), now)}${
            pending.tokens.expiresAt
              ? `, valable jusqu'au ${fmtDateShort(pending.tokens.expiresAt, now)} (renouvelé automatiquement avant la fin)`
              : ""
          }.`}
        >
          <form action={connectChosenMetaAccountsAction} className="space-y-4">
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {pending.accounts.map((a) => {
                const already = existingById.get(a.externalId);
                return (
                  <li key={a.externalId}>
                    <label className="flex min-h-12 cursor-pointer items-start gap-3 p-3 hover:bg-muted/40">
                      <Checkbox
                        name="accounts"
                        value={a.externalId}
                        defaultChecked={Boolean(already) || a.active}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{a.name}</span>
                          {a.statusLabel ? (
                            <StatusPill tone={a.active ? "success" : "muted"}>
                              {a.statusLabel}
                            </StatusPill>
                          ) : null}
                          {already ? (
                            <StatusBadge
                              kind="connection"
                              value={already}
                              title="Déjà connecté dans LinkAffi Pro"
                            />
                          ) : null}
                        </span>
                        <span className="block text-note text-muted-foreground">
                          <span className="font-mono">{a.externalId}</span> · {a.currency}
                          {a.timezone ? ` · ${a.timezone}` : ""}
                          {a.businessName ? ` · ${a.businessName}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="max-md:h-10">
                Connecter les comptes cochés
              </Button>
              <Button
                type="submit"
                variant="outline"
                className="max-md:h-10"
                formAction={cancelPendingMetaAction}
              >
                Annuler
              </Button>
            </div>
          </form>
        </FormSection>
      )}
    </>
  );
}
