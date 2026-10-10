import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { loadPending } from "@/lib/connectors/common";
import { requireAdminPage } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
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
  const n = pending.accounts.length;

  return (
    <>
      <PageHeader
        backHref="/settings/connectors/tiktok"
        backLabel="TikTok"
        title="Choisir les comptes TikTok"
        description={`TikTok a accepté la connexion : ${n} compte${n > 1 ? "s sont visibles" : " est visible"}. Cochez ceux dont vous voulez suivre les dépenses.`}
        help="Un compte déjà connecté est mis à jour avec le nouvel accès (utile pour « Reconnecter »). Vous pourrez en ajouter d'autres plus tard."
      />
      <Flash ok={sp.ok} error={sp.error} />
      <FormSection
        title="Comptes publicitaires visibles"
        description="Nom, identifiant d'annonceur, devise et statut chez TikTok. Un compte désactivé peut être connecté mais ne rapportera rien."
      >
        <form action={connectChosenAccountsAction} className="space-y-4">
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {pending.accounts.map((a) => {
              const already = existingById.get(a.externalId);
              return (
                <li key={a.externalId}>
                  <label className="flex min-h-12 cursor-pointer items-start gap-3 p-3 hover:bg-muted/40">
                    <Checkbox
                      name="accounts"
                      value={a.externalId}
                      defaultChecked={a.active}
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
                            title="Déjà connecté : sera mis à jour"
                          />
                        ) : null}
                      </span>
                      <span className="block text-note text-muted-foreground">
                        <span className="font-mono">{a.externalId}</span>
                        {a.businessName ? ` · ${a.businessName}` : ""} · {a.currency}
                        {a.timezone ? ` · ${a.timezone}` : ""}
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
              formAction={cancelPendingAction}
            >
              Annuler
            </Button>
          </div>
        </form>
      </FormSection>
    </>
  );
}
