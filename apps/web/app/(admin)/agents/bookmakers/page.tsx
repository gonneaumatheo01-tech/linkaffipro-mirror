import type { Metadata } from "next";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { AgentsNav } from "@/components/agents/agents-nav";
import { BookmakerSiteCard } from "@/components/agents/bookmakers/site-card";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import { canManageBookmakers } from "@/lib/agents/bookmakers";
import { loadBookmakersPage } from "@/lib/agents/bookmakers-queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { fmtNum, fmtRelative } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agents · Bookmakers" };
export const dynamic = "force-dynamic";

/**
 * Agents → Bookmakers (phase 35) : les sites de nos bookmakers (Celsius, Sportaza, Bet Portal…) que le système lit
 * lui-même avec le compte du client, en lecture seule, sans jamais miser. Par site : état, qui lit (serveur ou Mac),
 * dernier succès, réussite sur 24 h, méthode de lecture apprise, dernières lectures, matchs du jour, écart avec les
 * autres bookmakers. Gestes réservés aux administrateurs ; les managers lisent.
 */
export default async function AgentsBookmakersPage({
  searchParams,
}: PageProps<"/agents/bookmakers">) {
  const user = await requireUser();
  const sp = await searchParams;
  const isAdmin = canManageBookmakers(user.role);
  const now = new Date();
  const [data, pending] = await Promise.all([loadBookmakersPage(now), loadPendingCounts()]);
  const ok = data.sites.filter((s) => s.site.status === "READY").length;

  return (
    <>
      <AgentsNav
        current="bookmakers"
        isAdmin={user.role === "ADMIN"}
        pending={pending.validations + pending.requests}
      />
      <PageHeader
        title="Bookmakers"
        description="Les sites de vos bookmakers que le système lit lui-même avec votre compte : matchs, marchés et cotes. L'équipe Paris sportifs choisit ses paris sur ces cotes-là. Il ne mise jamais, ne dépose jamais et ne retire jamais d'argent."
        help="Une cote n'est publiée que si elle a été lue deux fois à l'identique. Pour un contrôle anti-robot ou un code, Kevin vous demande d'ouvrir le navigateur sur le Mac."
        secondaryActions={
          <>
            <Link
              href="/agents/sports"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
            >
              Équipe Paris sportifs
            </Link>
            <Link
              href="/agents/boss"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
            >
              Parler à Kevin
            </Link>
          </>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <FormSection
        title="Sites des bookmakers"
        description={
          data.sites.length
            ? `${fmtNum(ok)} sur ${fmtNum(data.sites.length)} se ${ok > 1 ? "lisent" : "lit"} bien. Le Mac ${data.mac.alive ? `lit (dernier passage ${fmtRelative(data.mac.at, now)})` : data.mac.at ? `ne lit pas en ce moment (dernier passage ${fmtRelative(data.mac.at, now)})` : "n'a encore jamais lu"}.${data.commonCredentials ? "" : " Identifiants des comptes : pas encore donnés à Kevin."}`
            : undefined
        }
      >
        {data.sites.length === 0 ? (
          <EmptyState
            icon={<Trophy />}
            title="Aucun bookmaker pour l'instant"
            description="Les sites de Celsius, Sportaza et Bet Portal apparaissent ici au premier contrôle (toutes les 30 minutes). Pour en ajouter un : écrivez à Kevin « ajoute le bookmaker X, c'est x.com »."
            action={{ href: "/agents/boss", label: "Parler à Kevin", variant: "outline" }}
          />
        ) : (
          <ul className="space-y-4">
            {data.sites.map((v) => (
              <BookmakerSiteCard key={v.site.key} v={v} isAdmin={isAdmin} now={now} />
            ))}
          </ul>
        )}
      </FormSection>
    </>
  );
}
