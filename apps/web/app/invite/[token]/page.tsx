import type { Metadata, Viewport } from "next";
import { prisma } from "@linkaffipro/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BRAND_THEME_COLOR, BrandScreen } from "@/app/(auth)/brand-screen";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = { title: "Invitation" };
export const viewport: Viewport = { themeColor: BRAND_THEME_COLOR };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { invitedBy: { select: { name: true } } },
  });
  const valid = invitation && !invitation.acceptedAt && invitation.expiresAt > new Date();
  const existing = valid
    ? await prisma.user.findUnique({
        where: { email: invitation.email.toLowerCase() },
        select: { name: true },
      })
    : null;
  const mode = existing ? "reset" : "create";
  const roleLabel = invitation?.role === "ADMIN" ? "administrateur" : "manager";
  return (
    <BrandScreen width="md">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>
            <h1 className="text-title">
              {mode === "reset" ? "Nouveau mot de passe" : "Rejoindre LinkAffi Pro"}
            </h1>
          </CardTitle>
          <CardDescription>
            {!valid
              ? "Cette invitation est invalide, expirée ou déjà utilisée. Demandez une nouvelle invitation à un administrateur."
              : mode === "reset"
                ? `${invitation.invitedBy.name} vous a envoyé ce lien pour choisir un nouveau mot de passe, ${existing?.name}. Vos autres appareils seront déconnectés.`
                : `${invitation.invitedBy.name} vous invite en tant que ${roleLabel}. Choisissez votre nom et votre mot de passe.`}
          </CardDescription>
        </CardHeader>
        {valid ? (
          <CardContent>
            <AcceptInviteForm token={token} email={invitation.email} mode={mode} />
          </CardContent>
        ) : null}
      </Card>
    </BrandScreen>
  );
}
