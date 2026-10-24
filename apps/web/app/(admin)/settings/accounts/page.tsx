import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { maskPhone } from "@linkaffipro/mtproto";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { SidePanel } from "@/components/admin/side-panel";
import { StatusPill } from "@/components/admin/status-pill";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { fmtDate } from "@/lib/format";
import { accountPersonaWhere } from "@/lib/accounts/persona-choice";
import { requireUser } from "@/lib/session";
import { ActiveBadge } from "@/lib/status-badges";
import {
  addAccountAction,
  disconnectAccountAction,
  refreshAccountAction,
  setAccountPersonaAction,
  submitCodeAction,
  submitPasswordAction,
  toggleAccountAction,
} from "./actions";

export const metadata: Metadata = { title: "Comptes Telegram" };

const STATUS_LABEL: Record<string, string> = {
  PENDING_CODE: "Code envoyé",
  PENDING_PASSWORD: "Mot de passe à saisir",
  ACTIVE: "Connecté",
  ERROR: "Erreur",
  DISCONNECTED: "Déconnecté",
};

/**
 * Réglages → Comptes Telegram (phase 18, étape 1) : les VRAIS comptes Telegram (pas des bots) qui porteront une
 * persona de l'assistant. Un compte = un numéro, une session chiffrée, une connexion à venir (étape 2).
 */
export default async function AccountsPage({ searchParams }: PageProps<"/settings/accounts">) {
  const user = await requireUser();
  const sp = await searchParams;
  const [accounts, personas] = await Promise.all([
    prisma.telegramUserAccount.findMany({
      orderBy: { createdAt: "asc" },
      include: { persona: { select: { name: true, isActive: true } } },
    }),
    // Rencontres seulement : une persona Casino / Paris ne parle jamais depuis un vrai compte (refusé aussi par l'action).
    prisma.persona.findMany({
      where: accountPersonaWhere,
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
  ]);
  const isAdmin = user.role === "ADMIN";
  const connected = accounts.filter((a) => a.status === "ACTIVE").length;
  const viewKey = String(new Date().getTime());

  const addPanel = isAdmin ? (
    <SidePanel
      key={`add-${viewKey}`}
      title="Ajouter un compte"
      description="Un VRAI compte Telegram (pas un bot) : son numéro, puis le code reçu dans Telegram. Il n'affichera pas le badge « bot »."
      trigger={
        <Button className="max-md:h-10">
          <Plus aria-hidden />
          Ajouter un compte
        </Button>
      }
    >
      <form action={addAccountAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="phone">Numéro de téléphone</Label>
          <Input id="phone" name="phone" placeholder="+33612345678" required autoComplete="off" />
          <p className="text-note text-muted-foreground">
            Format international. Le code arrive dans l&apos;application Telegram de ce numéro.
          </p>
        </div>
        <Button type="submit" className="max-md:h-10">
          Envoyer le code
        </Button>
      </form>
    </SidePanel>
  ) : null;

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Comptes Telegram"
        description="Les vrais comptes Telegram qui discuteront à la place de l'assistante. Ils n'ont pas le badge « bot » : la personne en face croit parler à quelqu'un."
        help="Ajoutez un numéro, recopiez le code reçu dans Telegram, puis activez le compte. La connexion permanente arrive à l'étape suivante."
        meta={
          accounts.length > 0 ? (
            <StatusPill tone={connected > 0 ? "success" : "warning"}>
              {connected} connecté{connected > 1 ? "s" : ""} sur {accounts.length}
            </StatusPill>
          ) : null
        }
        primaryAction={addPanel}
      />
      <Flash ok={sp.ok} error={sp.error} />

      <DataTable
        key={`accounts-${viewKey}`}
        label="Comptes Telegram"
        columns={[
          { key: "account", header: "Compte", className: "min-w-40 whitespace-normal" },
          { key: "state", header: "État" },
          { key: "persona", header: "Persona", hideOnMobile: true },
          { key: "signal", header: "Dernier signal", hideOnMobile: true },
        ]}
        rows={accounts.map((a) => ({
          id: a.id,
          cells: {
            account: (
              <span className="flex flex-col items-start gap-1">
                <span>{a.label}</span>
                <span className="text-note font-normal text-muted-foreground">
                  {maskPhone(a.phone)}
                  {a.telegramUsername ? ` · @${a.telegramUsername}` : ""}
                </span>
              </span>
            ),
            state: (
              <span className="flex flex-col items-start gap-1">
                <StatusPill tone={a.status === "ACTIVE" ? "success" : a.status === "ERROR" ? "danger" : "warning"}>
                  {STATUS_LABEL[a.status] ?? a.status}
                </StatusPill>
                <ActiveBadge active={a.isActive} />
              </span>
            ),
            persona: a.persona ? a.persona.name : "aucune",
            signal: fmtDate(a.lastActiveAt),
          },
          sortValues: {
            account: a.label,
            state: STATUS_LABEL[a.status] ?? a.status,
            persona: a.persona?.name ?? "",
          },
          detailTitle: a.label,
          detailDescription: maskPhone(a.phone),
          detail: (
            <div className="space-y-6">
              <DetailList>
                <DetailRow label="État">
                  <StatusPill tone={a.status === "ACTIVE" ? "success" : a.status === "ERROR" ? "danger" : "warning"}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </StatusPill>
                </DetailRow>
                <DetailRow label="Activé">
                  <ActiveBadge active={a.isActive} />
                </DetailRow>
                <DetailRow label="Persona">{a.persona ? a.persona.name : "aucune"}</DetailRow>
                <DetailRow label="Dernier signal">{fmtDate(a.lastActiveAt)}</DetailRow>
                {a.lastError ? <DetailRow label="Dernière erreur">{a.lastError}</DetailRow> : null}
              </DetailList>

              {a.status === "PENDING_CODE" ? (
                <form action={submitCodeAction} className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <input type="hidden" name="accountId" value={a.id} />
                  <div className="space-y-2">
                    <Label htmlFor={`code-${a.id}`}>Code reçu dans Telegram</Label>
                    <Input id={`code-${a.id}`} name="code" placeholder="12345" required autoComplete="off" />
                  </div>
                  <Button type="submit" className="max-md:h-10">
                    Valider le code
                  </Button>
                </form>
              ) : null}

              {a.status === "PENDING_PASSWORD" ? (
                <form action={submitPasswordAction} className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <input type="hidden" name="accountId" value={a.id} />
                  <div className="space-y-2">
                    <Label htmlFor={`pwd-${a.id}`}>Mot de passe de validation en deux étapes</Label>
                    <Input id={`pwd-${a.id}`} name="password" type="password" required autoComplete="off" />
                  </div>
                  <Button type="submit" className="max-md:h-10">
                    Valider le mot de passe
                  </Button>
                </form>
              ) : null}

              {isAdmin ? (
                <form action={setAccountPersonaAction} className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <input type="hidden" name="accountId" value={a.id} />
                  <div className="space-y-2">
                    <Label htmlFor={`persona-${a.id}`}>Persona de ce compte</Label>
                    <NativeSelect id={`persona-${a.id}`} name="personaId" defaultValue={a.personaId ?? ""} wrapperClassName="w-full">
                      <option value="">Aucune</option>
                      {personas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.isActive ? "" : " (désactivée)"}
                        </option>
                      ))}
                    </NativeSelect>
                    <p className="text-note text-muted-foreground">Personas Rencontres seulement.</p>
                  </div>
                  <Button type="submit" variant="outline" className="max-md:h-10">
                    Enregistrer
                  </Button>
                </form>
              ) : null}

              {isAdmin ? (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <form action={refreshAccountAction}>
                    <input type="hidden" name="accountId" value={a.id} />
                    <Button type="submit" variant="outline" className="max-md:h-10">
                      Vérifier la session
                    </Button>
                  </form>
                  <form action={toggleAccountAction}>
                    <input type="hidden" name="accountId" value={a.id} />
                    {/* L'action lit « active » : sans ce champ, « Activer » désactivait le compte. */}
                    <input type="hidden" name="active" value={a.isActive ? "0" : "1"} />
                    {a.isActive ? (
                      <Button type="submit" variant="outline" className="max-md:h-10">
                        Désactiver
                      </Button>
                    ) : (
                      <Button type="submit" variant="outline" className="max-md:h-10">
                        Activer
                      </Button>
                    )}
                  </form>
                  <form action={disconnectAccountAction}>
                    <input type="hidden" name="accountId" value={a.id} />
                    <ConfirmSubmit
                      variant="destructive"
                      className="max-md:h-10"
                      confirmTitle={`Déconnecter ${a.label} ?`}
                      confirmLabel="Déconnecter"
                      message="La session est révoquée chez Telegram. Pour reconnecter, il faudra renvoyer un code à ce numéro."
                    >
                      Déconnecter
                    </ConfirmSubmit>
                  </form>
                </div>
              ) : null}
            </div>
          ),
        }))}
        empty={{
          title: "Aucun compte réel",
          description: isAdmin
            ? "Ajoutez un numéro : c'est ce compte qui discutera à la place de l'assistante, sans badge « bot »."
            : "Un administrateur doit ajouter un compte.",
        }}
      />
    </>
  );
}
