"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";
import { SidePanel, SidePanelClose } from "@/components/admin/side-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { emojiCount, type EmojiActionState } from "@/lib/custom-emoji/library";
import { fmtRelative } from "@/lib/format";
import type { AccountImportState } from "@/lib/custom-emoji/queries";
import { forgetMissingPreviews } from "./emoji-media";
import { invalidateCustomEmojiLibrary } from "./use-library";

type Action = (prev: EmojiActionState, formData: FormData) => Promise<EmojiActionState>;

function Result({ state, id }: { state: EmojiActionState; id: string }) {
  if (!state) return null;
  return state.error ? (
    <p id={id} role="alert" className="text-note text-danger">
      {state.error}
    </p>
  ) : (
    <p id={id} role="status" className="text-note text-success">
      {state.ok}
    </p>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section
      aria-labelledby={`add-emoji-step-${n}`}
      className="space-y-2 rounded-xl border border-border p-4"
    >
      <h3
        id={`add-emoji-step-${n}`}
        className="flex items-center gap-2 text-body font-semibold text-foreground"
      >
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-note font-semibold text-brand-ink"
        >
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Volet « Ajouter des emojis animés » de la bibliothèque (Messages → Emojis animés) : les trois façons, de la plus
 * simple à la plus complète : transférer un message au bot, coller le lien d'un pack, importer les packs du compte
 * Telegram connecté. Un responsable peut tout faire ici (retirer un emoji reste réservé aux administrateurs).
 */
export function AddEmojisPanel({
  defaultOpen = false,
  ...props
}: AddEmojisProps & { defaultOpen?: boolean }) {
  return (
    <SidePanel
      defaultOpen={defaultOpen}
      size="md"
      title="Ajouter des emojis animés"
      description="Trois façons, de la plus simple à la plus complète. Les emojis ajoutés servent à toute l'équipe."
      trigger={
        <Button className="max-md:h-10">
          <Plus aria-hidden />
          Ajouter des emojis animés
        </Button>
      }
      footer={<SidePanelClose />}
    >
      <AddEmojisContent {...props} />
    </SidePanel>
  );
}

type AddEmojisProps = {
  bots: Array<{ username: string; name: string }>;
  account: AccountImportState;
  importPack: Action;
  importAccount: Action;
};

/** Contenu du volet : les trois façons d'ajouter des emojis animés (utilisable seul, par exemple dans un test). */
export function AddEmojisContent({ bots, account, importPack, importAccount }: AddEmojisProps) {
  const [packState, packAction, packPending] = useActionState(importPack, null);
  const [accountState, accountAction, accountPending] = useActionState(importAccount, null);

  // Un ajout réussi : le sélecteur de l'éditeur relira la bibliothèque, et les aperçus absents seront redemandés.
  useEffect(() => {
    if (packState?.ok || accountState?.ok) {
      invalidateCustomEmojiLibrary();
      forgetMissingPreviews();
    }
  }, [packState, accountState]);

  const connected = account.session === "active";
  return (
    <div className="space-y-4">
      <Step n={1} title="Transférer un message au bot">
        <p className="text-body text-muted-foreground">
          Dans Telegram, transférez (ou envoyez) à l&apos;un de nos bots un message qui contient vos
          emojis animés. Le bot répond, par exemple, « 6 emojis animés ajoutés ✅ » et ils arrivent
          ici.
        </p>
        {bots.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Nos bots">
            {bots.map((b) => (
              <li key={b.username}>
                <a
                  href={`https://t.me/${encodeURIComponent(b.username)}`}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
                  aria-label={`Ouvrir @${b.username} dans Telegram (nouvel onglet)`}
                >
                  @{b.username}
                  <ExternalLink aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-note text-warning">Aucun bot actif pour l&apos;instant.</p>
        )}
        <p className="text-note text-muted-foreground">
          Seuls les comptes Telegram liés à l&apos;équipe sont pris en compte : liez le vôtre dans{" "}
          <Link href="/account" className="font-medium text-brand-ink underline underline-offset-2">
            Mon compte
          </Link>
          .
        </p>
      </Step>

      <Step n={2} title="Coller le lien d'un pack">
        <form action={packAction} className="space-y-2">
          <Label htmlFor="emoji-pack-link">Lien du pack</Label>
          <Input
            id="emoji-pack-link"
            name="link"
            inputMode="url"
            autoComplete="off"
            placeholder="https://t.me/addemoji/NomDuPack"
            aria-describedby={packState ? "emoji-pack-help emoji-pack-result" : "emoji-pack-help"}
            aria-invalid={packState?.error ? true : undefined}
            required
          />
          <p id="emoji-pack-help" className="text-note text-muted-foreground">
            Dans Telegram, ouvrez le pack d&apos;emojis puis « Partager » pour copier son lien. Tous
            ses emojis sont ajoutés.
          </p>
          <Button type="submit" disabled={packPending} className="max-md:h-10">
            {packPending ? "Ajout en cours…" : "Ajouter le pack"}
          </Button>
          <Result state={packState} id="emoji-pack-result" />
        </form>
      </Step>

      <Step n={3} title="Importer les packs de votre compte Telegram">
        <p className="text-body text-muted-foreground">
          Le compte Telegram connecté au site (celui qui a Telegram Premium) ajoute d&apos;un coup
          tous les packs d&apos;emojis animés installés dessus.
        </p>
        <AccountStatus account={account} />
        {connected ? (
          <form action={accountAction} className="space-y-2">
            <Button
              type="submit"
              variant="outline"
              disabled={accountPending || account.running}
              className="max-md:h-10"
              aria-describedby={accountState ? "emoji-account-result" : undefined}
            >
              {accountPending || account.running ? "Import en cours…" : "Importer mes packs"}
            </Button>
            <Result state={accountState} id="emoji-account-result" />
          </form>
        ) : (
          <Link
            href="/settings/connectors/telegram"
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            Connecter le compte Telegram
          </Link>
        )}
      </Step>
    </div>
  );
}

function AccountStatus({ account }: { account: AccountImportState }) {
  const lines: React.ReactNode[] = [];
  if (account.session === "none")
    lines.push(
      <span key="s">
        Aucun compte Telegram connecté : un administrateur le connecte dans Réglages → Connexions →
        Telegram.
      </span>,
    );
  else if (account.session === "error")
    lines.push(
      <span key="s" className="text-danger">
        Le compte Telegram connecté est à reconnecter (Réglages → Connexions → Telegram).
      </span>,
    );
  else
    lines.push(
      <span key="s" className="text-success">
        Compte Telegram connecté.
      </span>,
    );
  if (account.running)
    lines.push(<span key="r">Import en cours : les emojis arrivent d&apos;ici une minute.</span>);
  else if (account.lastImport)
    lines.push(
      <span key="i">
        Dernier import {fmtRelative(new Date(account.lastImport.at))} :{" "}
        {emojiCount(account.lastImport.count)} {account.lastImport.count > 1 ? "ajoutés" : "ajouté"}
        .
      </span>,
    );
  else if (account.lastRequest)
    lines.push(
      <span key="q">
        Dernière demande {fmtRelative(new Date(account.lastRequest.at))}
        {account.lastRequest.byName ? ` par ${account.lastRequest.byName}` : ""} : rien de nouveau.
      </span>,
    );
  if (account.accountEmojis > 0)
    lines.push(
      <span key="c">
        {emojiCount(account.accountEmojis)} de votre compte dans la bibliothèque.
      </span>,
    );
  return (
    <ul
      className="space-y-0.5 text-note text-muted-foreground"
      aria-label="État du compte Telegram"
    >
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}
