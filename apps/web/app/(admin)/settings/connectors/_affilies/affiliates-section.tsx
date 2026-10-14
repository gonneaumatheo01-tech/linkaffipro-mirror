import Link from "next/link";
import { LINKAFFI_EVENTS_URL_DEFAULT } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { StatCard } from "@/components/admin/stat-card";
import { StatusPill } from "@/components/admin/status-pill";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { fmtDate, fmtNum, fmtRelative } from "@/lib/format";
import { loadLinkaffiIntegrationState } from "@/lib/integrations/linkaffi/settings";
import { LinkaffiDivergences } from "@/components/connectors/linkaffi-divergences";
import { linkaffiConnectionStatus } from "@/lib/integrations/linkaffi/view";
import {
  generateLinkaffiKeyAction,
  generateLinkaffiSecretAction,
  saveLinkaffiEventsUrlAction,
  sendLinkaffiTestEventAction,
} from "../affiliates-actions";
import { EventsUrlForm } from "./events-url-form";
import { SecretCard } from "./secret-card";
import { TestEventButton } from "./test-event-button";

/** Page interne des affiliés Link Affi (vue par affilié et par campagne Telegram, phase 13). */
const AFFILIATES_VIEW = "/campaigns/affiliates";

/**
 * Réglages → Connexions → « Campagnes Telegram des affiliés » (phase 13, ADMIN : la page entière l'est) : état de la
 * connexion, guide en 3 étapes, clé de connexion et secret de signature (montrés une seule fois), test d'envoi, état
 * de la file des événements, écarts de chiffres avec Link Affi, et, dans « Avancé », l'adresse de la fonction Link Affi.
 * Aucune valeur secrète n'est rendue ici : seulement leur début et leur date.
 */
export async function AffiliatesSection() {
  const now = new Date();
  const [state, activeLinks] = await Promise.all([
    loadLinkaffiIntegrationState(now),
    prisma.inviteLink.count({ where: { kind: "LINKAFFI", isActive: true } }),
  ]);
  const status = linkaffiConnectionStatus(state, now);
  const q = state.queue;

  return (
    <FormSection
      id="linkaffi-affilies"
      title="Campagnes Telegram des affiliés"
      description="Vos affiliés Link Affi travaillent sur vos canaux : Link Affi crée ici le lien d'invitation de chaque affilié, puis reçoit ses membres et leurs clics d'offre."
      actions={
        <Link
          href={AFFILIATES_VIEW}
          className={buttonVariants({ variant: "outline", size: "sm", className: "max-md:h-10" })}
        >
          Voir les affiliés
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        <p className="text-note text-muted-foreground">{status.sentence}</p>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h3 className="text-body font-semibold text-foreground">
          Brancher Link Affi (une seule fois)
        </h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-body text-foreground">
          <li>
            Générez ci-dessous la clé de connexion et le secret de signature. Copiez chacun tout de
            suite : ils ne s&apos;affichent qu&apos;une fois.
          </li>
          <li>
            Dans Lovable, ouvrez le projet Link Affi, puis Cloud → Secrets, et ajoutez deux secrets
            : <code className="font-mono break-words">LINKAFFIPRO_API_KEY</code> avec la clé de
            connexion, et <code className="font-mono break-words">LINKAFFIPRO_WEBHOOK_SECRET</code>{" "}
            avec le secret de signature.
          </li>
          <li>
            Revenez ici et cliquez « Envoyer un événement de test » : « Reçu » veut dire que tout
            est branché. Créez alors, dans Link Affi, une campagne Telegram pour un affilié.
          </li>
        </ol>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SecretCard
          envName="LINKAFFIPRO_API_KEY"
          action={generateLinkaffiKeyAction}
          current={
            state.keyPrefix
              ? {
                  hint: state.keyPrefix,
                  createdAt: fmtDate(state.keyCreatedAt),
                  createdBy: state.keyCreatedBy,
                }
              : null
          }
          texts={{
            title: "Clé de connexion",
            description:
              "Link Affi la montre à chaque appel pour créer les liens de vos affiliés et lire leurs membres.",
            generate: "Générer la clé",
            regenerate: "Régénérer la clé",
            ready: "Générée",
            currentLabel: "Clé actuelle",
            copyNow: "Copiez-la maintenant : elle ne sera plus jamais affichée.",
            confirmDescription:
              "La clé actuelle cessera de marcher tout de suite : Link Affi ne pourra plus créer de liens ni lire les membres tant que vous n'aurez pas collé la nouvelle clé dans ses secrets.",
          }}
        />
        <SecretCard
          envName="LINKAFFIPRO_WEBHOOK_SECRET"
          action={generateLinkaffiSecretAction}
          current={
            state.hasSecret
              ? { hint: null, createdAt: fmtDate(state.secretCreatedAt), createdBy: null }
              : null
          }
          texts={{
            title: "Secret de signature",
            description:
              "Il signe chaque événement envoyé à Link Affi, qui vérifie ainsi qu'il vient bien de vous.",
            generate: "Générer le secret",
            regenerate: "Régénérer le secret",
            ready: "Généré",
            currentLabel: "Secret actuel enregistré",
            copyNow: "Copiez-le maintenant : il ne sera plus jamais affiché.",
            confirmDescription:
              "Le secret actuel cessera de marcher tout de suite : Link Affi refusera nos événements tant que vous n'aurez pas collé le nouveau secret dans ses secrets.",
          }}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-body font-semibold text-foreground">Vérifier la connexion</h3>
        <p className="text-note text-muted-foreground">
          Envoie tout de suite à Link Affi un événement de test signé (aucun membre réel).
        </p>
        <TestEventButton action={sendLinkaffiTestEventAction} disabled={!state.hasSecret} />
        {!state.hasSecret ? (
          <p className="text-note text-muted-foreground">
            Générez d&apos;abord le secret de signature pour pouvoir envoyer un test.
          </p>
        ) : !state.anonKeyReady ? (
          <p className="text-note text-muted-foreground">
            Le site ne connaît pas encore la clé d&apos;accès publique de Link Affi : le test ne
            peut pas partir d&apos;ici, mais les vrais événements partent quand même.
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-body font-semibold text-foreground">
            Événements envoyés à Link Affi
          </h3>
          <p className="text-note text-muted-foreground">
            Demandes, entrées, départs et clics d&apos;offre des membres amenés par vos affiliés.
            {activeLinks > 0
              ? ` ${fmtNum(activeLinks)} lien${activeLinks > 1 ? "s" : ""} d'affilié actif${activeLinks > 1 ? "s" : ""}.`
              : " Aucun lien d'affilié pour l'instant."}
            {state.lastEventSentAt
              ? ` Dernier envoi réussi ${fmtRelative(state.lastEventSentAt, now)}.`
              : ""}
          </p>
        </div>
        {q.stuck ? (
          <Alert variant="warning">
            <AlertDescription>
              Des événements attendent depuis plus d&apos;une heure : vérifiez que le secret de
              signature est bien collé dans Link Affi, puis envoyez un test. Ils sont renvoyés tout
              seuls pendant 24 heures.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="En attente"
            value={fmtNum(q.pending)}
            hint="Partent dans la minute, ou au prochain essai."
          />
          <StatCard label="Envoyés (24 h)" value={fmtNum(q.sent24h)} hint="Reçus par Link Affi." />
          <StatCard
            label="Abandonnés (7 jours)"
            value={fmtNum(q.failed7d)}
            hint="Après 24 h d'essais. Link Affi peut les relire."
          />
          <StatCard
            label="Plus ancien en attente"
            value={q.oldestPendingAt ? fmtRelative(q.oldestPendingAt, now) : "—"}
            hint={q.stuck ? "Plus d'une heure : à vérifier." : "Rien de bloqué."}
          />
        </div>
      </div>

      {/* Écarts avec Link Affi (bloc de la synchro : en attente, aucun écart, écarts à regarder, lecture impossible). */}
      <LinkaffiDivergences now={now} />

      <AdvancedSection
        title="Avancé : adresse de Link Affi"
        description="Où partent les événements des membres. À ne changer que si Link Affi vous donne une autre adresse."
        modifiedCount={state.eventsUrlIsDefault ? 0 : 1}
      >
        <EventsUrlForm
          url={state.eventsUrl}
          isDefault={state.eventsUrlIsDefault}
          defaultUrl={LINKAFFI_EVENTS_URL_DEFAULT}
          action={saveLinkaffiEventsUrlAction}
        />
      </AdvancedSection>
    </FormSection>
  );
}
