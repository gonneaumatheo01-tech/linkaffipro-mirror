import { CopyField } from "@/components/admin/copy-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CONSOLE_URL = "https://platform.claude.com";
const KEYS_URL = "https://platform.claude.com/settings/keys";

/**
 * Guide pas à pas pour créer la clé API Anthropic (une seule fois, 5 minutes), d'après la console au 10 octobre 2026.
 * Écrit pour quelqu'un qui n'a jamais ouvert la console. Aussi résumé dans docs/A-FAIRE-HUMAIN.md.
 */
export function AnthropicKeyGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Créer la clé API Anthropic (une seule fois, 5 minutes)</CardTitle>
        <CardDescription>
          L&apos;assistant utilise les modèles Claude d&apos;Anthropic. Il faut un compte sur leur console, un moyen
          de paiement (ou des crédits), puis une clé à coller ci-dessus. Anthropic facture à l&apos;usage :
          quelques centimes par jour avec le modèle rapide, le plafond mensuel ci-dessus protège le budget.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            Ouvrez la console Anthropic et créez un compte (ou connectez-vous) :
            <div className="mt-1 max-w-md">
              <CopyField value={CONSOLE_URL} />
            </div>
          </li>
          <li>
            Si c&apos;est un nouveau compte : menu <b>Settings</b> → <b>Billing</b> → ajoutez une carte ou achetez des
            crédits (5 $ suffisent pour commencer). Sans moyen de paiement, la clé est refusée.
          </li>
          <li>
            Ouvrez la page des clés : <b>Settings</b> → <b>API keys</b>
            <div className="mt-1 max-w-md">
              <CopyField value={KEYS_URL} />
            </div>
          </li>
          <li>
            Cliquez sur <b>Create key</b>. Nom : <code className="rounded bg-muted px-1">LinkAffi Pro</code>.
            Expiration : laissez « Never » (ou 1 an). « Linked account » : vous-même. Espace de travail (workspace) :
            laissez par défaut.
          </li>
          <li>
            Cliquez sur <b>Create</b> puis <b>Copy</b> : la clé commence par <code className="rounded bg-muted px-1">sk-ant-</code>
            et n&apos;est affichée qu&apos;une seule fois. Si vous la perdez, créez-en une nouvelle (et supprimez l&apos;ancienne).
          </li>
          <li>
            Revenez ici, collez la clé dans le champ « Clé API Anthropic », cliquez sur <b>Enregistrer</b> puis sur{" "}
            <b>Vérifier</b>. Le bouton « Améliorer avec l&apos;IA » devient actif pour toute l&apos;équipe.
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          La clé est chiffrée en base et jamais réaffichée. Pour la révoquer : console Anthropic → API keys → la ligne
          de la clé → Delete, puis ici « Retirer la clé ».
        </p>
      </CardContent>
    </Card>
  );
}
