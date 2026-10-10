import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadPending } from "@/lib/connectors/common";
import { requireAdminPage } from "@/lib/session";
import { cancelPendingAction, connectChosenAccountsAction } from "../actions";

export const metadata: Metadata = { title: "Connexions — TikTok — choix des comptes" };

/** Après le retour de TikTok : l'administrateur coche les comptes publicitaires à suivre. */
export default async function TikTokChoosePage({
  searchParams,
}: PageProps<"/settings/connectors/tiktok/choose">) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const pending = await loadPending("TIKTOK", admin.id);
  if (!pending) {
    redirect(
      `/settings/connectors/tiktok?${new URLSearchParams({ error: "Aucune connexion en attente (ou délai de 15 minutes dépassé) : cliquez sur « Connecter un compte TikTok »." })}`,
    );
  }
  const existing = await prisma.adAccountConnection.findMany({
    where: { platform: "TIKTOK", externalId: { in: pending.accounts.map((a) => a.externalId) } },
    select: { externalId: true, status: true },
  });
  const existingById = new Map(existing.map((e) => [e.externalId, e.status]));

  return (
    <>
      <PageHeader
        title="Choisir les comptes TikTok à connecter"
        description={`TikTok a accepté la connexion : ${pending.accounts.length} compte${pending.accounts.length > 1 ? "s sont visibles" : " est visible"}. Cochez ceux dont vous voulez suivre les dépenses.`}
        help="Les comptes déjà connectés sont mis à jour avec le nouveau jeton (utile pour « Reconnecter »). Vous pourrez en ajouter d'autres plus tard."
      >
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings/connectors/tiktok" />}
        >
          ← TikTok
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comptes publicitaires visibles</CardTitle>
          <CardDescription>
            Nom, identifiant d&apos;annonceur, devise et statut chez TikTok. Un compte désactivé
            peut être connecté mais ne rapportera rien.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={connectChosenAccountsAction} className="space-y-4">
            <ul className="divide-y rounded-md border">
              {pending.accounts.map((a) => {
                const already = existingById.get(a.externalId);
                return (
                  <li key={a.externalId}>
                    <label className="flex cursor-pointer items-start gap-3 p-3 text-sm hover:bg-muted/40">
                      <input
                        type="checkbox"
                        name="accounts"
                        value={a.externalId}
                        defaultChecked={a.active}
                        className="mt-0.5 size-4 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{a.name}</span>
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {a.externalId}
                          {a.businessName ? ` · ${a.businessName}` : ""}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {a.currency}
                          {a.timezone ? ` · ${a.timezone}` : ""}
                          {a.statusLabel ? ` · ${a.statusLabel}` : ""}
                          {already
                            ? ` · déjà connecté (${already === "ACTIVE" ? "actif" : already === "NEEDS_RECONNECT" ? "à reconnecter" : "déconnecté"}) : sera mis à jour`
                            : ""}
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
                variant="ghost"
                className="max-md:h-10"
                formAction={cancelPendingAction}
              >
                Annuler
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
