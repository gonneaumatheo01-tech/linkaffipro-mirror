import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = { title: "Invitation" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invitation = await prisma.invitation.findUnique({ where: { token }, include: { invitedBy: { select: { name: true } } } });
  const valid = invitation && !invitation.acceptedAt && invitation.expiresAt > new Date();
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Rejoindre LinkAffi Pro</CardTitle>
            <CardDescription>
              {valid
                ? `${invitation.invitedBy.name} vous invite en tant que ${invitation.role === "ADMIN" ? "administrateur" : "manager"}. Choisissez votre nom et votre mot de passe.`
                : "Cette invitation est invalide, expirée ou déjà utilisée. Demandez une nouvelle invitation à un administrateur."}
            </CardDescription>
          </CardHeader>
          {valid ? (
            <CardContent>
              <AcceptInviteForm token={token} email={invitation.email} />
            </CardContent>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
