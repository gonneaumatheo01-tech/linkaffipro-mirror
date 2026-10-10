import { CopyField } from "@/components/admin/copy-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Guide pas à pas pour créer l'application Meta (une seule fois, ~10 minutes), avec les valeurs exactes à copier.
 * Écrit pour quelqu'un qui n'a jamais ouvert developers.facebook.com. Aussi recopié dans docs/GUIDE-UTILISATEUR.md.
 */
export function MetaAppGuide({
  redirectUri,
  appDomain,
  privacyUrl,
  termsUrl,
}: {
  redirectUri: string;
  appDomain: string;
  privacyUrl: string;
  termsUrl: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Créer l&apos;application Meta (une seule fois, 10 minutes)
        </CardTitle>
        <CardDescription>
          Meta demande qu&apos;une « application » porte la connexion. Elle se crée gratuitement sur
          developers.facebook.com avec votre compte Facebook. Les valeurs à coller sont ci-dessous,
          avec un bouton « Copier » pour chacune.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="font-medium">Adresse de retour (URI de redirection OAuth)</p>
            <CopyField value={redirectUri} />
          </div>
          <div className="space-y-1.5">
            <p className="font-medium">Domaine de l&apos;application</p>
            <CopyField value={appDomain} />
          </div>
          <div className="space-y-1.5">
            <p className="font-medium">URL de la politique de confidentialité</p>
            <CopyField value={privacyUrl} />
          </div>
          <div className="space-y-1.5">
            <p className="font-medium">URL des conditions d&apos;utilisation</p>
            <CopyField value={termsUrl} />
          </div>
          <div className="space-y-1.5">
            <p className="font-medium">Permissions à demander</p>
            <CopyField value="ads_read" />
          </div>
          <div className="space-y-1.5">
            <p className="font-medium">&nbsp;</p>
            <CopyField value="business_management" />
          </div>
        </div>

        <ol className="list-decimal space-y-3 pl-5">
          <li>
            Ouvrez{" "}
            <a
              href="https://developers.facebook.com/apps/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              developers.facebook.com/apps
            </a>{" "}
            et connectez-vous avec votre compte Facebook (celui qui voit vos comptes publicitaires).
            Si Meta vous demande de devenir « développeur », acceptez : c&apos;est gratuit et
            immédiat.
          </li>
          <li>
            Cliquez sur <strong>Créer une app</strong>. Nom : « LinkAffi Pro » (ou ce que vous
            voulez). Si Meta propose un cas d&apos;usage, choisissez <strong>Autre</strong> ; puis
            le type <strong>Entreprise</strong> (Business). Rattachez-la à votre Business Manager si
            la question est posée. Validez.
          </li>
          <li>
            Dans le tableau de bord de l&apos;app, cliquez sur <strong>Ajouter un produit</strong>{" "}
            (ou « Cas d&apos;usage ») et ajoutez <strong>Facebook Login for Business</strong> (si
            vous ne le voyez pas : <strong>Facebook Login</strong>, c&apos;est équivalent ici).
          </li>
          <li>
            Dans le menu de gauche, sous ce produit, ouvrez <strong>Paramètres</strong>. Dans le
            champ <strong>URI de redirection OAuth valides</strong>, collez l&apos;
            <em>adresse de retour</em> ci-dessus. Enregistrez les modifications (bouton en bas de
            page).
          </li>
          <li>
            Menu de gauche → <strong>Paramètres de l&apos;app</strong> → <strong>Général</strong>.
            Vous y trouvez l&apos;<strong>ID de l&apos;app</strong> (App ID) et la{" "}
            <strong>Clé secrète</strong> (App Secret : cliquez sur « Afficher », Meta redemande
            votre mot de passe). Copiez-les dans le formulaire « Application Meta » ci-dessus, puis{" "}
            <strong>Enregistrer</strong> et <strong>Vérifier</strong>. Sur la même page, renseignez
            aussi <em>Domaines de l&apos;app</em> (le domaine ci-dessus),{" "}
            <em>URL de politique de confidentialité</em> et <em>URL des conditions de service</em>{" "}
            (les deux URL ci-dessus) : Meta les exigera au premier passage en mode Live.
          </li>
          <li>
            Menu de gauche → <strong>Rôles de l&apos;app</strong> → <strong>Rôles</strong> →{" "}
            <strong>Ajouter des personnes</strong> : ajoutez chaque membre de l&apos;équipe qui
            connectera des comptes, comme <strong>Administrateur</strong>,{" "}
            <strong>Développeur</strong> ou <strong>Testeur</strong> (la personne reçoit une
            invitation à accepter sur Facebook). Tant que l&apos;app est en{" "}
            <strong>mode Développement</strong>, seules ces personnes peuvent se connecter ;
            c&apos;est suffisant : chacune verra tous les comptes publicitaires que son profil
            Facebook voit déjà (Business Manager inclus), sans validation de Meta.
          </li>
          <li>
            Revenez ici et cliquez sur <strong>Connecter un compte Meta</strong> : Facebook
            s&apos;ouvre, vous acceptez l&apos;accès, vous cochez les comptes à suivre, et les
            dépenses des 90 derniers jours arrivent toutes seules dans Campagnes (onglet Pubs).
          </li>
        </ol>

        <div className="rounded-lg border bg-muted/40 p-4">
          <p className="font-medium">
            Plus tard, seulement si besoin : passer l&apos;app en mode Live
          </p>
          <p className="mt-1 text-muted-foreground">
            Nécessaire uniquement pour laisser des personnes <em>hors</em> de l&apos;app (non
            ajoutées dans « Rôles de l&apos;app ») connecter leurs propres comptes. Dans ce cas :
            renseigner l&apos;URL de politique de confidentialité (ci-dessus), faire la{" "}
            <strong>Vérification de l&apos;entreprise</strong> (documents de la société, quelques
            jours), puis demander l&apos;
            <strong>accès avancé</strong> à <code>ads_read</code> via <strong>App Review</strong>{" "}
            (vidéo de démonstration, 1 à 2 semaines). Pour une équipe fermée, le mode Développement
            suffit indéfiniment.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
