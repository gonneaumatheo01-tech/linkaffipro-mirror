import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { ROLE_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { ACTIVE_CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { CopyField } from "@/components/admin/copy-field";
import { FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { restartTourAction } from "@/lib/onboarding/actions";
import { requireUser } from "@/lib/session";
import { changePasswordAction, generateTelegramLinkAction, unlinkTelegramAction } from "./actions";
import { accountPrimaryAction } from "./account-view";

export const metadata: Metadata = { title: "Mon compte" };

/** Surface blanche des blocs de la page (formulaires). */
const BOX = "rounded-xl border border-border bg-card p-4 md:p-6";

/**
 * Mon compte : mot de passe, lien avec Telegram (alertes, rapports, « Tester sur moi ») et « Revoir la visite ».
 * Un seul bouton orange : « Générer un lien » tant que Telegram n'est pas lié (c'est la chose à faire), sinon
 * « Modifier le mot de passe ». Mêmes champs et mêmes actions serveur qu'avant.
 */
export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const me = await requireUser();
  const sp = await searchParams;
  const [user, bots] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: me.id },
      select: { telegramLinkToken: true, telegramUserId: true },
    }),
    // Liens « Lier votre Telegram » : bots normaux seulement (phase 17 : un bot assistant de conversation est réservé
    // à ses conversations privées).
    prisma.bot.findMany({
      where: ACTIVE_CHANNEL_BOT_WHERE,
      orderBy: { createdAt: "asc" },
      select: { username: true, name: true },
    }),
  ]);
  const linked = Boolean(user.telegramUserId);
  const telegramFirst =
    accountPrimaryAction({
      linked,
      activeBots: bots.length,
      hasLinkToken: Boolean(user.telegramLinkToken),
    }) === "telegram";

  return (
    <>
      <PageHeader
        title="Mon compte"
        meta={<StatusPill tone="neutral">{ROLE_LABELS[me.role]}</StatusPill>}
        description={`${me.name} · ${me.email}`}
        help="Liez votre Telegram : il sert aux alertes, aux rapports et aux tests (« Envoyer un test sur mon Telegram », « Tester sur moi »)."
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid gap-x-6 gap-y-10 lg:grid-cols-2">
        <FormSection
          title="Telegram"
          description="Le bot vous reconnaît comme membre de l'équipe : vous recevez les alertes, les rapports et les tests."
          actions={
            linked ? (
              <StatusPill tone="success">Lié</StatusPill>
            ) : (
              <StatusPill tone="muted">Non lié</StatusPill>
            )
          }
        >
          <div className={`space-y-4 ${BOX}`}>
            {linked ? (
              <>
                <p className="text-body text-muted-foreground">
                  Compte Telegram lié (identifiant {user.telegramUserId!.toString()}).
                </p>
                <form action={unlinkTelegramAction}>
                  <ConfirmSubmit
                    variant="outline"
                    className="max-md:h-10"
                    confirmTitle={"Délier votre Telegram\u00a0?"}
                    confirmLabel="Délier"
                    destructive
                    message="Vous ne recevrez plus les alertes, les rapports ni les tests. Vous pourrez le relier ensuite."
                  >
                    Délier
                  </ConfirmSubmit>
                </form>
              </>
            ) : bots.length === 0 ? (
              <p className="text-body text-muted-foreground">
                Aucun bot actif : un administrateur doit d&apos;abord ajouter un bot (Réglages →
                Bots).
              </p>
            ) : (
              <>
                {user.telegramLinkToken ? (
                  <div className="space-y-3">
                    <p className="text-body">
                      Ouvrez un de ces liens dans Telegram, puis appuyez sur{" "}
                      <strong className="font-semibold">Démarrer</strong>.
                    </p>
                    {bots.map((b) => (
                      <div key={b.username} className="space-y-1.5">
                        <p className="text-note text-muted-foreground">
                          {b.name} (@{b.username})
                        </p>
                        <CopyField
                          value={`https://t.me/${b.username}?start=admin_${user.telegramLinkToken}`}
                          label={`Lien pour lier votre Telegram avec @${b.username}`}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-body text-muted-foreground">
                    Générez un lien, ouvrez-le dans Telegram et appuyez sur Démarrer.
                  </p>
                )}
                <form action={generateTelegramLinkAction}>
                  <Button
                    type="submit"
                    className="max-md:h-10"
                    variant={telegramFirst ? "default" : "outline"}
                  >
                    {user.telegramLinkToken ? "Générer un nouveau lien" : "Générer un lien"}
                  </Button>
                </form>
              </>
            )}
          </div>
        </FormSection>

        <FormSection
          title="Mot de passe"
          description="10 caractères au moins. Vos autres appareils seront déconnectés."
        >
          <form action={changePasswordAction} className={`space-y-4 ${BOX}`}>
            <div className="space-y-2">
              <Label htmlFor="current">Mot de passe actuel</Label>
              <Input
                id="current"
                name="current"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Nouveau mot de passe</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirmer le nouveau mot de passe</Label>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </div>
            <Button
              type="submit"
              className="max-md:h-10"
              variant={telegramFirst ? "outline" : "default"}
            >
              Modifier le mot de passe
            </Button>
          </form>
        </FormSection>

        <FormSection
          title="Visite guidée"
          description="Deux minutes pour retrouver chaque rubrique du menu. Elle repart de l'accueil, et la liste « À faire pour démarrer » réapparaît si elle n'est pas finie."
        >
          <form action={restartTourAction}>
            <Button type="submit" variant="outline" className="max-md:h-10">
              <Compass aria-hidden />
              Revoir la visite
            </Button>
          </form>
        </FormSection>
      </div>
    </>
  );
}
