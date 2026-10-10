import { CopyField } from "@/components/admin/copy-field";

const CONSOLE_URL = "https://platform.claude.com";
const KEYS_URL = "https://platform.claude.com/settings/keys";

/** Nom d'un menu ou d'un bouton de la console Anthropic (en anglais, tel qu'affiché). */
function Ui({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-foreground">{children}</span>;
}

/**
 * Guide pas à pas pour créer la clé API Anthropic (une seule fois, 5 minutes), d'après la console au 10 octobre 2026.
 * Écrit pour quelqu'un qui n'a jamais ouvert la console. Aussi résumé dans docs/A-FAIRE-HUMAIN.md.
 * Contenu seul : la page le place dans une section (première fois) ou dans « Avancé » (clé déjà enregistrée).
 */
export function AnthropicKeyGuide() {
  return (
    <div className="max-w-3xl space-y-4 text-body">
      <ol className="list-decimal space-y-3 pl-5 marker:text-muted-foreground">
        <li>
          Ouvrez la console Anthropic et créez un compte (ou connectez-vous) :
          <div className="mt-1.5 max-w-md">
            <CopyField value={CONSOLE_URL} label="Adresse de la console Anthropic" />
          </div>
        </li>
        <li>
          Nouveau compte : menu <Ui>Settings</Ui> → <Ui>Billing</Ui>, ajoutez une carte ou achetez
          des crédits (5 $ suffisent pour commencer). Sans moyen de paiement, la clé est refusée.
        </li>
        <li>
          Ouvrez la page des clés : <Ui>Settings</Ui> → <Ui>API keys</Ui>
          <div className="mt-1.5 max-w-md">
            <CopyField value={KEYS_URL} label="Adresse de la page des clés Anthropic" />
          </div>
        </li>
        <li>
          Cliquez sur <Ui>Create key</Ui>. Nom :{" "}
          <code className="rounded bg-muted px-1 font-mono text-note">LinkAffi Pro</code>.
          Expiration : laissez « Never » (ou 1 an). « Linked account » : vous-même. Espace de
          travail (workspace) : laissez par défaut.
        </li>
        <li>
          Cliquez sur <Ui>Create</Ui> puis <Ui>Copy</Ui> : la clé commence par{" "}
          <code className="rounded bg-muted px-1 font-mono text-note">sk-ant-</code> et n&apos;est
          affichée qu&apos;une seule fois. Perdue ? Créez-en une nouvelle (et supprimez
          l&apos;ancienne).
        </li>
        <li>
          Revenez ici, collez la clé dans « Clé API Anthropic », cliquez sur <Ui>Enregistrer</Ui>{" "}
          puis sur <Ui>Vérifier</Ui>. Le bouton « Améliorer avec l&apos;IA » devient actif pour
          toute l&apos;équipe.
        </li>
      </ol>
      <p className="text-note text-muted-foreground">
        Anthropic facture à l&apos;usage : quelques centimes par jour avec le modèle rapide, et le
        plafond mensuel protège le budget. Pour révoquer la clé : console Anthropic →{" "}
        <Ui>API keys</Ui> → la ligne de la clé → <Ui>Delete</Ui>, puis ici « Retirer la clé ».
      </p>
    </div>
  );
}
