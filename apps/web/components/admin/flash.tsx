import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Message de retour d'une action (ok / erreur) passé par les paramètres d'URL.
 * Les deux sont affichés quand ils sont présents (ex. import partiel : canaux importés ET canaux en échec).
 */
export function Flash({ ok, error }: { ok?: string | string[]; error?: string | string[] }) {
  const okMsg = Array.isArray(ok) ? ok[0] : ok;
  const errMsg = Array.isArray(error) ? error[0] : error;
  if (!okMsg && !errMsg) return null;
  return (
    <div className="mb-4 space-y-2">
      {okMsg ? (
        <Alert variant="default" role="status">
          <AlertDescription>{okMsg}</AlertDescription>
        </Alert>
      ) : null}
      {errMsg ? (
        <Alert variant="destructive">
          <AlertDescription>{errMsg}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
