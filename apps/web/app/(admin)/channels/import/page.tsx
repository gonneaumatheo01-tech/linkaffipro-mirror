import type { Metadata } from "next";
import Link from "next/link";
import { Download, SearchX, Send, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { isAccountSessionActive, listAccountChannels } from "@/lib/channels/account-import";
import { canaux } from "@/lib/channels/rights-message";
import { importChannelsFromAccountAction } from "../actions";

export const metadata: Metadata = { title: "Importer mes canaux" };
export const dynamic = "force-dynamic";

const FORM_ID = "import-channels";

export default async function ImportChannelsPage({ searchParams }: PageProps<"/channels/import">) {
  await requireUser();
  const sp = await searchParams;
  const active = await isAccountSessionActive().catch(() => false);
  const listing = active ? await listAccountChannels() : null;
  const rows = listing?.ok ? listing.rows : [];
  const firstBot = listing?.ok ? listing.firstBot : null;
  const toImport = rows.filter((r) => !r.known);
  const prechecked = toImport.filter((r) => r.botAdmins.length > 0).length;
  const bot = `@${firstBot ?? "votre_bot"}`;

  return (
    <>
      <PageHeader
        title="Importer mes canaux"
        backHref="/channels"
        backLabel="Tous les canaux"
        description={
          rows.length > 0
            ? "Les canaux et groupes dont votre compte Telegram connecté est administrateur ou créateur. Cochez ceux à ajouter."
            : "Les canaux et groupes dont votre compte Telegram connecté est administrateur ou créateur."
        }
        help={
          active
            ? `Les canaux où l'un de nos bots est déjà administrateur sont cochés d'avance. Pour les autres, ajoutez d'abord le bot dans Telegram (canal → Administrateurs → Ajouter → ${bot}) : rien n'est modifié dans Telegram.`
            : undefined
        }
        primaryAction={
          rows.length > 0 ? (
            <Button
              type="submit"
              form={FORM_ID}
              className="max-md:h-10"
              disabled={toImport.length === 0}
            >
              <Download aria-hidden />
              Importer les canaux cochés
            </Button>
          ) : undefined
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      {!active ? (
        <EmptyState
          icon={<Send />}
          title="Compte Telegram non connecté"
          description="Connectez d'abord le compte Telegram qui possède vos canaux, puis revenez ici."
          action={{
            href: "/settings/connectors/telegram",
            label: "Connecter mon compte Telegram",
          }}
        />
      ) : listing && !listing.ok ? (
        <EmptyState
          icon={<TriangleAlert />}
          title="Lecture des canaux impossible pour le moment"
          description={listing.error}
          action={{ href: "/channels/import", label: "Réessayer", variant: "outline" }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="Aucun canal trouvé"
          description="Votre compte Telegram n'est administrateur ou créateur d'aucun canal parmi ses 500 derniers échanges."
          action={{ href: "/channels", label: "Retour aux canaux", variant: "outline" }}
        />
      ) : (
        <form id={FORM_ID} action={importChannelsFromAccountAction} className="space-y-3">
          <p className="text-body text-muted-foreground">
            <span className="font-semibold text-foreground">
              {canaux(rows.length)} trouvé{rows.length > 1 ? "s" : ""}
            </span>{" "}
            · {fmtNum(toImport.length)} à importer · {fmtNum(prechecked)} coché
            {prechecked > 1 ? "s" : ""} d&apos;avance. Un canal sans bot peut quand même être
            importé : il sera ajouté sans bot administrateur.
          </p>
          <Table label="Canaux de mon compte Telegram">
            <TableCaption className="sr-only">Canaux de mon compte Telegram</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <span className="sr-only">Importer</span>
                </TableHead>
                <TableHead>Canal</TableHead>
                <TableHead numeric className="max-md:hidden">
                  Membres
                </TableHead>
                <TableHead>Nos bots administrateurs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const id = r.telegramChatId;
                const cid = `imp-${id}`;
                return (
                  <TableRow key={id}>
                    <TableCell>
                      {r.known ? (
                        <span className="sr-only">Déjà ajouté</span>
                      ) : (
                        <span className="flex size-10 items-center justify-center">
                          <input
                            type="checkbox"
                            id={cid}
                            name="ids"
                            value={id}
                            defaultChecked={r.botAdmins.length > 0}
                            aria-label={`Importer ${r.title}`}
                            className="size-4 accent-brand"
                          />
                          <input type="hidden" name={`title_${id}`} value={r.title} />
                          <input type="hidden" name={`username_${id}`} value={r.username ?? ""} />
                          <input
                            type="hidden"
                            name={`broadcast_${id}`}
                            value={r.isBroadcast ? "1" : "0"}
                          />
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-56 whitespace-normal">
                      <label
                        htmlFor={r.known ? undefined : cid}
                        className="block font-medium text-foreground"
                      >
                        {r.title}
                      </label>
                      <span className="block text-note text-muted-foreground">
                        {r.username ? `@${r.username} · ` : ""}
                        {r.isBroadcast ? "canal" : "groupe"} ·{" "}
                        {r.isCreator ? "vous êtes le créateur" : "vous êtes administrateur"}
                      </span>
                      {r.known ? (
                        <Link
                          href={`/channels/${r.known.id}`}
                          className="mt-1 inline-flex min-h-8 items-center text-note font-medium text-brand-ink underline-offset-4 hover:underline"
                        >
                          Déjà ajouté : ouvrir la fiche
                        </Link>
                      ) : null}
                    </TableCell>
                    <TableCell numeric className="max-md:hidden">
                      {r.memberCount === null ? "—" : fmtNum(r.memberCount)}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {r.botAdmins.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {r.botAdmins.map((u) => (
                            <StatusPill key={u} tone="neutral">
                              @{u}
                            </StatusPill>
                          ))}
                        </span>
                      ) : (
                        <span className="text-note text-danger">
                          {r.checkNote ?? "Aucun"} : ajoutez {bot} comme administrateur dans
                          Telegram
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </form>
      )}
    </>
  );
}
