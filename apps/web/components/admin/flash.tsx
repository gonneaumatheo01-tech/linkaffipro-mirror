import { Alert, AlertDescription } from "@/components/ui/alert";

/** Message de retour d'une action (ok / erreur) passé par les paramètres d'URL. */
export function Flash({ ok, error }: { ok?: string | string[]; error?: string | string[] }) {
  const okMsg = Array.isArray(ok) ? ok[0] : ok;
  const errMsg = Array.isArray(error) ? error[0] : error;
  if (!okMsg && !errMsg) return null;
  return (
    <Alert variant={errMsg ? "destructive" : "default"} className="mb-4">
      <AlertDescription>{errMsg ?? okMsg}</AlertDescription>
    </Alert>
  );
}
