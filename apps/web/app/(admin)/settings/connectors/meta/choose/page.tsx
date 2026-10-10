import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <>
      <PageHeader
        title="Choisir les comptes Meta"
        description="Cochez les comptes publicitaires à suivre dans LinkAffi Pro. Les comptes déjà connectés sont pré-cochés : les laisser cochés renouvelle leur connexion."
        help="Vous avez 15 minutes pour valider. Les comptes fermés ou désactivés chez Meta peuvent être connectés mais ne renverront rien."
      >
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings/connectors/meta" />}
        >
          ← Meta Ads
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      {!pending ? (
        <EmptyState
          title="Aucune connexion Meta en attente"
          description="Le délai de 15 minutes est passé, ou vous n'avez pas encore lancé la connexion. Cliquez sur « Connecter un compte Meta » depuis la page Meta Ads."
          action={{
            href: "/settings/connectors/meta",
            label: "Retour à Meta Ads",
            variant: "outline",
          }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {pending.accounts.length} compte{pending.accounts.length > 1 ? "s" : ""} visible
              {pending.accounts.length > 1 ? "s" : ""} par votre profil Facebook
            </CardTitle>
            <CardDescription>
              Jeton Meta obtenu le {fmtDateShort(new Date(pending.createdAt), now)}
              {pending.tokens.expiresAt
                ? `, valable jusqu'au ${fmtDateShort(pending.tokens.expiresAt, now)} (renouvelé automatiquement avant expiration)`
                : ""}
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={connectChosenMetaAccountsAction} className="space-y-4">
              <ul className="divide-y rounded-lg border">
                {pending.accounts.map((a) => {
                  const already = existingById.get(a.externalId);
                  return (
                    <li key={a.externalId}>
                      <label className="flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/40">
                        <input
                          type="checkbox"
                          name="accounts"
                          value={a.externalId}
                          defaultChecked={Boolean(already) || a.active}
                          className="mt-1 size-4 accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{a.name}</span>
                            {a.statusLabel ? (
                              <span
                                className={`text-xs ${a.active ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}
                              >
                                {a.statusLabel}
                              </span>
                            ) : null}
                            {already ? (
                              <StatusBadge
                                kind="connection"
                                value={already}
                                title="Déjà connecté dans LinkAffi Pro"
                              />
                            ) : null}
                          </span>
                          <span className="block text-xs text-muted-foreground">
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
          </CardContent>
        </Card>
      )}
    </>
  );
}
