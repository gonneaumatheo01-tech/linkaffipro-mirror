import { AgentMediaPreview } from "@/components/agents/agent-media-preview";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SecretSummary } from "@linkaffipro/agents";
import {
  deleteBookmakerCredentialsAction,
  deleteScreenshotProxyAction,
  saveBookmakerCredentialsAction,
  saveScreenshotProxyAction,
  testBookmakerConnectionAction,
} from "@/app/(admin)/agents/[equipe]/sports-actions";
import { CREDENTIAL_STATE, bookmakerLabel, credentialState } from "@/lib/agents/sports";
import type { BookmakerView } from "@/lib/agents/sports-queries";
import { fmtDateShort } from "@/lib/format";

const PROXY_TERM = "proxy : adresse internet résidentielle par laquelle passent les captures quand le site bloque";

function BookmakerCard({
  b,
  isAdmin,
  capture,
  now,
}: {
  b: BookmakerView;
  isAdmin: boolean;
  capture: { id: string; mimeType: string } | null;
  now: Date;
}) {
  const name = bookmakerLabel(b.key);
  const state = credentialState(b.login, b.password);
  const shown = CREDENTIAL_STATE[state];
  const id = (k: string) => `bk-${b.key}-${k}`;
  const preview = capture ?? null;
  return (
    <li className="space-y-3 rounded-xl border border-border bg-card px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{name}</span>
        {b.login === null && b.password === null ? (
          <StatusPill tone="warning">État illisible</StatusPill>
        ) : (
          <StatusPill tone={shown.tone}>{shown.label}</StatusPill>
        )}
        {b.lastTest ? (
          <StatusPill tone={b.lastTest.ok ? "success" : "danger"} title={b.lastTest.message || undefined}>
            {b.lastTest.ok ? "Connexion réussie" : "Connexion en échec"} le {fmtDateShort(b.lastTest.at, now)}
          </StatusPill>
        ) : (
          <span className="text-note text-muted-foreground">Jamais testé</span>
        )}
      </div>
      {b.lastTest && !b.lastTest.ok && b.lastTest.message ? (
        <p className="text-note text-danger">{b.lastTest.message}</p>
      ) : null}
      {preview ? (
        <div className="max-w-md space-y-1">
          <p className="text-note text-muted-foreground">Capture du dernier test :</p>
          <AgentMediaPreview
            id={preview.id}
            mimeType={preview.mimeType}
            label={`Capture de la page d'accueil ${name} lors du test de connexion`}
            className="aspect-auto max-h-80 object-contain"
          />
        </div>
      ) : null}
      {isAdmin ? (
        <>
          <div className="flex flex-wrap gap-2">
            {state === "complete" ? (
              <form action={testBookmakerConnectionAction}>
                <input type="hidden" name="bookmaker" value={b.key} />
                <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                  Tester la connexion
                </Button>
              </form>
            ) : null}
            {state !== "missing" ? (
              <form action={deleteBookmakerCredentialsAction}>
                <input type="hidden" name="bookmaker" value={b.key} />
                <ConfirmSubmit
                  variant="ghost"
                  size="sm"
                  className="text-danger max-md:h-10"
                  destructive
                  confirmTitle={`Retirer les identifiants ${name} ?`}
                  confirmLabel="Retirer les identifiants"
                  message="L'équipe ne pourra plus faire de capture chez ce bookmaker : les paris passeront par une image de repli, soumise à votre validation."
                >
                  Retirer les identifiants
                </ConfirmSubmit>
              </form>
            ) : null}
          </div>
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-body text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
              {state === "missing" ? "Saisir les identifiants" : "Remplacer les identifiants"}
            </summary>
            <form action={saveBookmakerCredentialsAction} className="space-y-3 border-t border-border px-3 py-3">
              <input type="hidden" name="bookmaker" value={b.key} />
              <p className="text-note text-muted-foreground">
                Le plus simple : le bot vous les demande sur Telegram et efface vos messages aussitôt. Ici, en secours.
                Ils sont chiffrés et jamais réaffichés.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={id("login")}>Identifiant du compte</Label>
                  <Input id={id("login")} name="login" autoComplete="off" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={id("password")}>Mot de passe</Label>
                  <Input id={id("password")} name="password" type="password" autoComplete="new-password" required />
                </div>
              </div>
              <Button type="submit" variant="outline" className="max-md:h-10">
                Enregistrer les identifiants
              </Button>
            </form>
          </details>
        </>
      ) : null}
    </li>
  );
}

/** Bookmakers : identifiants (résumés seulement), test de connexion avec capture, adresse de secours des captures. */
export function Bookmakers({
  bookmakers,
  proxy,
  isAdmin,
  capture,
  now,
}: {
  bookmakers: BookmakerView[];
  proxy: SecretSummary | null;
  isAdmin: boolean;
  /** Capture renvoyée par le dernier « Tester la connexion » (lue dans l'adresse), pour son bookmaker. */
  capture: { bookmaker: string | null; id: string; mimeType: string } | null;
  now: Date;
}) {
  return (
    <FormSection
      id="bookmakers"
      title="Bookmakers"
      description="L'équipe se connecte à votre compte seulement pour retrouver le pari, lire la cote et faire la capture d'écran. Jamais de mise, jamais de dépôt, jamais de changement du compte."
      className="scroll-mt-24"
    >
      <ul className="space-y-3">
        {bookmakers.map((b) => {
          const lastAsset = b.lastTest?.assetId ?? null;
          const own =
            capture && (capture.bookmaker === b.key || (!capture.bookmaker && capture.id === lastAsset))
              ? { id: capture.id, mimeType: capture.mimeType }
              : null;
          return <BookmakerCard key={b.key} b={b} isAdmin={isAdmin} capture={own} now={now} />;
        })}
      </ul>
      <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">
            <Term term={PROXY_TERM}>Adresse internet de secours</Term> des captures
          </span>
          {proxy === null ? (
            <StatusPill tone="warning">État illisible</StatusPill>
          ) : proxy.set ? (
            <StatusPill tone="success">Enregistrée{proxy.updatedAt ? ` le ${fmtDateShort(proxy.updatedAt, now)}` : ""}</StatusPill>
          ) : (
            <StatusPill tone="muted">Aucune</StatusPill>
          )}
        </div>
        <p className="text-note text-muted-foreground">
          Seulement si le test de connexion dit « bloqué » : soit une adresse internet résidentielle (service à souscrire),
          soit la capture depuis votre Mac (voir l&apos;aide de la page). Sans capture possible, l&apos;équipe fabrique une
          image de repli et vous la fait toujours valider.
        </p>
        {isAdmin ? (
          <div className="flex flex-wrap items-end gap-2">
            <form action={saveScreenshotProxyAction} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="sports-proxy">{proxy?.set ? "Remplacer l'adresse" : "Coller l'adresse"}</Label>
                <Input
                  id="sports-proxy"
                  name="proxy"
                  type="password"
                  autoComplete="off"
                  className="font-mono"
                  placeholder="http://identifiant:motdepasse@adresse:port"
                />
              </div>
              <Button type="submit" variant="outline" className="max-md:h-10">
                Enregistrer
              </Button>
            </form>
            {proxy?.set ? (
              <form action={deleteScreenshotProxyAction}>
                <ConfirmSubmit
                  variant="ghost"
                  className="text-danger max-md:h-10"
                  destructive
                  confirmTitle="Retirer l'adresse de secours ?"
                  confirmLabel="Retirer l'adresse"
                  message="Les captures repasseront par la connexion normale du service."
                >
                  Retirer l&apos;adresse
                </ConfirmSubmit>
              </form>
            ) : null}
          </div>
        ) : (
          <p className="text-note text-muted-foreground">Les comptes et l&apos;adresse de secours sont réservés aux administrateurs.</p>
        )}
      </div>
    </FormSection>
  );
}
