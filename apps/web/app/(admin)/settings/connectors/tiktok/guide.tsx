import { CopyField } from "@/components/admin/copy-field";

/**
 * Guide pas à pas pour créer l'application TikTok (Marketing API), écrit pour quelqu'un qui n'a jamais ouvert
 * le portail développeur. Les valeurs à coller sont dans des champs « Copier ». Mis à jour dans `docs/GUIDE-UTILISATEUR.md`.
 */
export function TikTokAppGuide({ redirectUri }: { redirectUri: string }) {
  const step = "rounded-md border bg-muted/40 p-3";
  return (
    <details className="group rounded-lg border p-4" open>
      <summary className="cursor-pointer text-sm font-medium">
        Comment créer l&apos;application TikTok (10 minutes, puis 1 à 2 semaines d&apos;attente de
        validation)
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-muted-foreground">
          À faire une seule fois, avec le compte <strong>TikTok for Business</strong> qui gère vos
          publicités (le même que sur ads.tiktok.com). Vous n&apos;avez rien à installer : tout se
          passe dans le navigateur.
        </p>
        <ol className="list-decimal space-y-3 pl-5">
          <li className={step}>
            Ouvrez{" "}
            <a
              className="underline"
              href="https://business-api.tiktok.com/portal"
              target="_blank"
              rel="noreferrer"
            >
              business-api.tiktok.com/portal
            </a>{" "}
            et connectez-vous avec votre compte TikTok for Business.
          </li>
          <li className={step}>
            Cliquez sur <strong>Become a Developer</strong> (devenir développeur). Remplissez le
            formulaire : votre nom, votre e-mail, le nom de l&apos;entreprise, le type d&apos;usage
            (« Advertiser » / annonceur). Validez.
          </li>
          <li className={step}>
            Dans le menu, ouvrez <strong>My Apps</strong> puis cliquez sur{" "}
            <strong>Create an App</strong>.
          </li>
          <li className={step}>
            Remplissez la fiche de l&apos;application :
            <ul className="mt-2 space-y-2">
              <li>
                <span className="text-muted-foreground">App name (nom) :</span>
                <CopyField value="LinkAffi Pro" />
              </li>
              <li>
                <span className="text-muted-foreground">App description (description) :</span>
                <CopyField value="Lecture des dépenses publicitaires pour les statistiques internes" />
              </li>
              <li>
                <span className="text-muted-foreground">
                  Advertiser redirect URL (adresse de retour après connexion) — collez exactement :
                </span>
                <CopyField value={redirectUri} />
              </li>
            </ul>
          </li>
          <li className={step}>
            Dans <strong>Scope of permission</strong> (droits demandés), cochez uniquement :
            <ul className="mt-1 list-disc pl-5">
              <li>
                <strong>Ad Account Management</strong> → <strong>Read</strong> (lecture des comptes
                publicitaires, pas « Write »).
              </li>
              <li>
                <strong>Reporting</strong> (lecture des rapports de performance : dépenses,
                impressions, clics).
              </li>
            </ul>
            <p className="mt-1 text-muted-foreground">
              Ne cochez rien d&apos;autre : nous lisons seulement, nous ne modifions jamais vos
              campagnes. Moins de droits demandés = validation plus rapide.
            </p>
          </li>
          <li className={step}>
            Cliquez sur <strong>Submit</strong>. TikTok examine l&apos;application : comptez{" "}
            <strong>1 à 2 semaines</strong>, vous recevrez un e-mail. Tant qu&apos;elle n&apos;est
            pas validée, la connexion d&apos;un vrai compte publicitaire est refusée par TikTok.
          </li>
          <li className={step}>
            Une fois l&apos;application créée (même avant validation), ouvrez{" "}
            <strong>My Apps</strong> → votre application → <strong>Basic Information</strong> :
            copiez l&apos;<strong>App ID</strong> (un grand nombre) et le <strong>Secret</strong>{" "}
            dans le formulaire ci-dessus, puis <strong>Enregistrer</strong> et{" "}
            <strong>Vérifier</strong>.
          </li>
          <li className={step}>
            Après l&apos;e-mail de validation : cliquez sur{" "}
            <strong>Connecter un compte TikTok</strong> ci-dessous, acceptez sur la page TikTok,
            cochez les comptes à suivre. Les dépenses arrivent ensuite toutes seules dans Pubs.
          </li>
        </ol>
        <div className="rounded-md border border-dashed p-3">
          <p className="font-medium">En attendant la validation : le mode bac à sable (sandbox)</p>
          <p className="mt-1 text-muted-foreground">
            Pour vérifier que tout est bien branché sans attendre : dans le portail, menu{" "}
            <strong>Tools</strong> → <strong>Sandbox</strong>, créez un compte de test (bouton{" "}
            <strong>Create sandbox ad account</strong>), puis cliquez sur{" "}
            <strong>Generate Access Token</strong> et notez l&apos;identifiant d&apos;annonceur
            (Advertiser ID) affiché. Ici : cochez <strong>Mode bac à sable</strong>, Enregistrer,
            puis collez le jeton et l&apos;identifiant dans le formulaire « Connecter un compte bac
            à sable ». Les chiffres d&apos;un compte de test sont fictifs ; décochez le mode bac à
            sable dès que l&apos;application est validée et déconnectez le compte de test.
          </p>
        </div>
      </div>
    </details>
  );
}
