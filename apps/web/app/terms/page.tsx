import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/admin/brand-logo";

export const metadata: Metadata = {
  title: "Conditions d'utilisation",
  robots: { index: false, follow: false },
};

/** Page publique (sans session) : conditions d'utilisation de l'outil interne LinkAffi Pro. */
export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 md:px-6 md:py-12">
      <article className="space-y-6 rounded-xl border border-border bg-card p-6 text-body leading-relaxed text-foreground md:p-10">
        <header className="space-y-2">
          <p className="flex items-center gap-2 text-body font-semibold text-foreground">
            <BrandLogo size={28} />
            LinkAffi Pro
          </p>
          <h1 className="pt-2 text-title text-foreground">Conditions d&apos;utilisation</h1>
          <p className="text-muted-foreground">Dernière mise à jour : 10 octobre 2026.</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">1. Objet</h2>
          <p>
            LinkAffi Pro est un outil interne, réservé aux membres d&apos;une équipe
            d&apos;affiliation invités par un administrateur. Il sert à piloter des bots Telegram, à
            lire des statistiques publicitaires et à suivre les résultats d&apos;affiliation. Il
            n&apos;est pas proposé au public et ne vend aucun service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">2. Accès et comptes</h2>
          <p>
            Chaque utilisateur dispose d&apos;un compte personnel, créé sur invitation. Il
            s&apos;engage à garder son mot de passe confidentiel et à ne pas partager son accès. Un
            administrateur peut suspendre un compte à tout moment.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">
            3. Comptes publicitaires connectés
          </h2>
          <p>
            En connectant un compte Meta ou TikTok, l&apos;utilisateur confirme qu&apos;il est
            autorisé à en consulter les données pour le compte de l&apos;équipe. L&apos;outil
            n&apos;accède à ces comptes qu&apos;en lecture seule et respecte les conditions
            d&apos;utilisation des plateformes concernées (Meta Platform Terms, TikTok for
            Business). L&apos;accès peut être retiré à tout moment, depuis l&apos;outil ou depuis la
            plateforme.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">4. Usage responsable</h2>
          <p>
            Les messages envoyés aux membres Telegram respectent les règles de Telegram : pas
            d&apos;envoi massif non sollicité, respect des blocages, suppression des données sur
            demande. L&apos;utilisateur est responsable du contenu qu&apos;il programme ou envoie
            depuis l&apos;outil.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">5. Données personnelles</h2>
          <p>
            Le traitement des données est décrit dans la{" "}
            <Link
              href="/privacy"
              className="font-medium text-brand-ink underline underline-offset-4"
            >
              politique de confidentialité
            </Link>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">
            6. Responsabilité et évolution
          </h2>
          <p>
            L&apos;outil est fourni « en l&apos;état » pour un usage interne. Les chiffres affichés
            proviennent des plateformes tierces et peuvent être recalculés par elles après coup. Ces
            conditions peuvent évoluer ; la version en ligne fait foi.
          </p>
        </section>

        <footer className="border-t border-border pt-4 text-note text-muted-foreground">
          <Link href="/privacy" className="font-medium text-brand-ink underline underline-offset-4">
            Politique de confidentialité
          </Link>
          {" · "}
          <Link href="/login" className="font-medium text-brand-ink underline underline-offset-4">
            Connexion
          </Link>
        </footer>
      </article>
    </main>
  );
}
