import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/admin/brand-logo";
import { Term } from "@/components/admin/help-tip";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  robots: { index: false, follow: false },
};

/**
 * Page publique (sans session) : politique de confidentialité de l'outil interne LinkAffi Pro.
 * Exigée par Meta et TikTok pour les applications développeur qui lisent des données publicitaires.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 md:px-6 md:py-12">
      <article className="space-y-6 rounded-xl border border-border bg-card p-6 text-body leading-relaxed text-foreground md:p-10">
        <header className="space-y-2">
          <p className="flex items-center gap-2 text-body font-semibold text-foreground">
            <BrandLogo size={28} />
            LinkAffi Pro
          </p>
          <h1 className="pt-2 text-title text-foreground">Politique de confidentialité</h1>
          <p className="text-muted-foreground">Dernière mise à jour : 10 octobre 2026.</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">1. Qui sommes-nous</h2>
          <p>
            LinkAffi Pro est un outil interne de gestion et de statistiques utilisé par une équipe
            d&apos;affiliation. Il n&apos;est pas ouvert au public : seuls les membres de
            l&apos;équipe, invités par un administrateur, peuvent s&apos;y connecter. Cette page
            explique quelles données l&apos;outil traite, pourquoi, et pendant combien de temps.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">2. Données traitées</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Données publicitaires (Meta, TikTok)</strong> : quand un membre de
              l&apos;équipe connecte un compte publicitaire, l&apos;outil lit, en lecture seule, les
              campagnes, groupes de publicités, publicités, dépenses, impressions, clics, portée et
              résultats, jour par jour. Aucune publicité n&apos;est créée, modifiée ni publiée
              depuis l&apos;outil. Les jetons d&apos;accès sont chiffrés en base et ne sont jamais
              affichés ni exportés ; ils sont effacés dès que le compte est déconnecté.
            </li>
            <li>
              <strong>Membres Telegram</strong> : identifiant Telegram, prénom, nom et pseudo
              publics, langue, canaux rejoints, clics sur les liens envoyés par nos bots. Ces
              données servent à accueillir les membres, à mesurer l&apos;efficacité des messages et
              à relier une inscription chez un partenaire au message d&apos;origine.
            </li>
            <li>
              <strong>Données d&apos;affiliation</strong> : événements transmis par nos partenaires
              (inscription, dépôt) via un <Term term="sub-ID">identifiant de suivi</Term> anonyme,
              sans nom ni coordonnées du joueur.
            </li>
            <li>
              <strong>Comptes de l&apos;équipe</strong> : nom, adresse e-mail, rôle, journal des
              actions effectuées dans l&apos;outil.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">3. Pourquoi</h2>
          <p>
            Pour piloter nos propres campagnes publicitaires, calculer leur coût et leur rendement,
            animer nos canaux Telegram et répondre à nos obligations contractuelles envers nos
            partenaires. Les données ne sont ni vendues ni transmises à des tiers, hormis les
            plateformes d&apos;origine (Meta, TikTok, Telegram, partenaires d&apos;affiliation) avec
            lesquelles elles sont échangées pour fonctionner.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">4. Conservation</h2>
          <p>
            Les données personnelles des membres Telegram sont conservées <strong>24 mois</strong>{" "}
            après leur dernière activité, puis supprimées automatiquement. Les données publicitaires
            agrégées (dépenses par jour) sont conservées pour les statistiques historiques. Un
            membre peut demander la suppression de ses données à tout moment : elles sont alors
            anonymisées sans délai.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">5. Sécurité</h2>
          <p>
            Accès par mot de passe réservé à l&apos;équipe, connexions chiffrées (HTTPS), jetons et
            secrets chiffrés en base (AES-256-GCM), hébergement en Europe, journal d&apos;audit de
            chaque action, sauvegardes quotidiennes.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-body font-semibold text-foreground">6. Vos droits et contact</h2>
          <p>
            Vous pouvez demander l&apos;accès, la rectification ou la suppression des données qui
            vous concernent, ou retirer l&apos;accès accordé à un compte publicitaire (depuis votre
            compte Meta ou TikTok, ou en nous le demandant). Contact : l&apos;administrateur de la
            plateforme, joignable à l&apos;adresse indiquée dans vos échanges avec l&apos;équipe, ou
            par Telegram.
          </p>
        </section>

        <footer className="border-t border-border pt-4 text-note text-muted-foreground">
          <Link
            href="/terms"
            className="inline-flex items-center font-medium text-brand-ink underline underline-offset-4 max-md:min-h-10"
          >
            Conditions d&apos;utilisation
          </Link>
          {" · "}
          <Link
            href="/login"
            className="inline-flex items-center font-medium text-brand-ink underline underline-offset-4 max-md:min-h-10"
          >
            Connexion
          </Link>
        </footer>
      </article>
    </main>
  );
}
