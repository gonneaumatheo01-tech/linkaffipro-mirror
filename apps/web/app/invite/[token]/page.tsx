import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = { title: "Invitation" };
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
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>
              {mode === "reset" ? "Nouveau mot de passe" : "Rejoindre LinkAffi Pro"}
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
      </div>
    </main>
  );
}
