import { CopyField } from "@/components/admin/copy-field";

/**
 * Guide pas à pas pour créer l'application TikTok (Marketing API), écrit pour quelqu'un qui n'a jamais ouvert
 * le portail développeur. Même gabarit que le guide Meta (`meta/guide.tsx`) : les valeurs à coller en haut, dans des
 * champs « Copier » avec leur libellé, puis une liste numérotée, puis l'encadré « plus tard ». Mis à jour dans
 * `docs/GUIDE-UTILISATEUR.md`.
 * Contenu seul : la page le place dans un bloc repliable (ouvert tant que l'application n'est pas enregistrée).
 */
export function TikTokAppGuide({ redirectUri }: { redirectUri: string }) {
  return (
    <div className="space-y-6 text-body">
      <p className="text-muted-foreground">
        À faire une seule fois, avec le compte <strong>TikTok for Business</strong> qui gère vos
        publicités (le même que sur ads.tiktok.com). Vous n&apos;avez rien à installer : tout se
        passe dans le navigateur. Les valeurs à coller sont ci-dessous, avec un bouton « Copier »
        pour chacune.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <p className="font-medium">Nom de l&apos;application (App name)</p>
          <CopyField value="LinkAffi Pro" label="Nom de l'application (App name)" />
        </div>
        <div className="space-y-1.5">
          <p className="font-medium">Description (App description)</p>
          <CopyField
            value="Lecture des dépenses publicitaires pour les statistiques internes"
            label="Description (App description)"
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <p className="font-medium">Adresse de retour (Advertiser redirect URL)</p>
          <CopyField value={redirectUri} label="Adresse de retour (Advertiser redirect URL)" />
        </div>
      </div>

      <ol className="list-decimal space-y-3 pl-5">
        <li>
          Ouvrez{" "}
          <a
            className="underline underline-offset-4"
            href="https://business-api.tiktok.com/portal"
            target="_blank"
            rel="noreferrer"
          >
            business-api.tiktok.com/portal
          </a>{" "}
          et connectez-vous avec votre compte TikTok for Business.
        </li>
        <li>
          Cliquez sur <strong>Become a Developer</strong> (devenir développeur). Remplissez le
          formulaire : votre nom, votre e-mail, le nom de l&apos;entreprise, le type d&apos;usage
          (« Advertiser » : annonceur). Validez.
        </li>
        <li>
          Dans le menu, ouvrez <strong>My Apps</strong> puis cliquez sur{" "}
          <strong>Create an App</strong>.
        </li>
        <li>
          Remplissez la fiche de l&apos;application avec les trois valeurs ci-dessus : le nom, la
          description et l&apos;<em>adresse de retour</em> (collez-la exactement).
        </li>
        <li>
          Dans <strong>Scope of permission</strong> (droits demandés), cochez uniquement{" "}
          <strong>Ad Account Management</strong> → <strong>Read</strong> (lecture des comptes
          publicitaires, pas « Write ») et <strong>Reporting</strong> (lecture des rapports :
          dépenses, impressions, clics). Ne cochez rien d&apos;autre : nous lisons seulement, nous
          ne modifions jamais vos campagnes, et moins de droits demandés veut dire une validation
          plus rapide.
        </li>
        <li>
          Cliquez sur <strong>Submit</strong>. TikTok examine l&apos;application : comptez{" "}
          <strong>1 à 2 semaines</strong>, vous recevrez un e-mail. Tant qu&apos;elle n&apos;est pas
          validée, la connexion d&apos;un vrai compte publicitaire est refusée par TikTok.
        </li>
        <li>
          Une fois l&apos;application créée (même avant validation), ouvrez <strong>My Apps</strong>{" "}
          → votre application → <strong>Basic Information</strong> : copiez l&apos;
          <strong>App ID</strong> (un grand nombre) et le <strong>Secret</strong> dans le formulaire
          « Application TikTok » ci-dessus, puis <strong>Enregistrer</strong> et{" "}
          <strong>Vérifier</strong>.
        </li>
        <li>
          Après l&apos;e-mail de validation : cliquez sur{" "}
          <strong>Connecter un compte TikTok</strong> en haut de la page, acceptez sur la page
          TikTok, cochez les comptes à suivre. Les dépenses arrivent ensuite toutes seules dans
          Campagnes (onglet Pubs).
        </li>
      </ol>

      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <p className="font-medium">En attendant la validation : le mode bac à sable (sandbox)</p>
        <p className="mt-1 text-muted-foreground">
          Pour vérifier que tout est bien branché sans attendre : dans le portail, menu{" "}
          <strong>Tools</strong> → <strong>Sandbox</strong>, créez un compte de test (bouton{" "}
          <strong>Create sandbox ad account</strong>), puis cliquez sur{" "}
          <strong>Generate Access Token</strong> et notez l&apos;identifiant d&apos;annonceur
          (Advertiser ID) affiché. Ici : cochez <strong>Mode bac à sable</strong> (bloc « Avancé »
          de l&apos;application), Enregistrer, puis collez le jeton et l&apos;identifiant dans le
          formulaire « Connecter un compte bac à sable ». Les chiffres d&apos;un compte de test sont
          fictifs ; décochez le mode bac à sable dès que l&apos;application est validée et
          déconnectez le compte de test.
        </p>
      </div>
    </div>
  );
}
