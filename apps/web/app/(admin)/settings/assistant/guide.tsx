import { CopyField } from "@/components/admin/copy-field";

const API_SETTINGS_URL = "https://venice.ai/settings/api";

/** Nom d'un menu ou d'un bouton de Venice (en anglais, tel qu'affiché). */
function Ui({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-foreground">{children}</span>;
}

/**
 * Guide pas à pas pour créer la clé Venice (une seule fois, 5 minutes), d'après la documentation de Venice au
 * 18 octobre 2026 (docs.venice.ai, « Generating an API key »). Écrit pour quelqu'un qui n'a jamais ouvert Venice.
 * Contenu seul : la page le place dans une section (première fois) ou dans « Avancé » (clé déjà enregistrée).
 */
export function VeniceKeyGuide() {
  return (
    <div className="max-w-3xl space-y-4 text-body">
      <ol className="list-decimal space-y-3 pl-5 marker:text-muted-foreground">
        <li>
          Connectez-vous à Venice (ou créez un compte), puis ouvrez la page des clés :
          <div className="mt-1.5 max-w-md">
            <CopyField value={API_SETTINGS_URL} label="Adresse de la page des clés Venice" />
          </div>
        </li>
        <li>
          Ajoutez du crédit sur le compte (solde en dollars ou crédits inclus) : sans solde, Venice
          refuse les réponses. Quelques dollars suffisent pour l&apos;essai.
        </li>
        <li>
          Cliquez sur <Ui>Generate New API Key</Ui>. Description :{" "}
          <code className="rounded bg-muted px-1 font-mono text-note">LinkAffi Pro</code>. Type :{" "}
          <Ui>Inference Only</Ui>. <Ui>Expires at</Ui> : laissez vide (ou une date lointaine). Les
          limites de dépense par jour sont facultatives : le plafond mensuel de cette page protège
          déjà le budget.
        </li>
        <li>
          Cliquez sur <Ui>Generate</Ui> puis copiez la clé : elle n&apos;est affichée qu&apos;une
          seule fois. Perdue ? Créez-en une nouvelle (et supprimez l&apos;ancienne).
        </li>
        <li>
          Revenez ici, collez la clé dans « Clé Venice », cliquez sur <Ui>Enregistrer</Ui> puis sur{" "}
          <Ui>Vérifier</Ui>. La vérification ne coûte rien : elle lit le solde et la liste des
          modèles.
        </li>
        <li>
          Choisissez « Seulement l&apos;équipe (essai) », enregistrez, puis écrivez au bot de
          conversation depuis votre propre compte Telegram (relié dans « Mon compte »). Passez à
          « Tout le monde » quand l&apos;essai est concluant.
        </li>
      </ol>
      <p className="text-note text-muted-foreground">
        Venice facture à l&apos;usage, en dollars. Pour révoquer la clé : page des clés Venice → la
        ligne de la clé → supprimer, puis ici « Retirer la clé ».
      </p>
    </div>
  );
}
