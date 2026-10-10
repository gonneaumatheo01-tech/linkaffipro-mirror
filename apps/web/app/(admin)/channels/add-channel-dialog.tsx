"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, ExternalLink, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { watchAdded, watchOpen, watchPoll, type DetectedChannel } from "@/lib/channels/watch";
import { addChannelByLinkAction, type AddChannelByLinkState } from "./actions";

type BotItem = { username: string; name: string };

/** Durée de surveillance après l'ouverture (2 minutes), un contrôle toutes les 5 secondes. */
const WATCH_MS = 120_000;
const POLL_MS = 5_000;

type CountResponse = { count: number; latest: { id: string; title: string } | null };

/**
 * Méthode 2 (lien public) : formulaire et résultat. Remonté à chaque ouverture de la fenêtre (`key`), si bien que
 * l'ancien résultat (« ajouté ✅ » ou erreur) ne réapparaît pas à la réouverture.
 */
function LinkMethodForm({ onAdded }: { onAdded: (channelId: string) => void }) {
  const [linkState, linkAction, linkPending] = useActionState<AddChannelByLinkState, FormData>(
    addChannelByLinkAction,
    {},
  );
  const onAddedRef = useRef(onAdded);
  useEffect(() => {
    onAddedRef.current = onAdded;
  }, [onAdded]);

  // Méthode 2 réussie : la surveillance n'annonce pas ce canal une seconde fois, la liste derrière se met à jour.
  useEffect(() => {
    if (linkState.ok && linkState.channelId) onAddedRef.current(linkState.channelId);
  }, [linkState]);

  return (
    <>
      <form action={linkAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="add-channel-link">Lien ou @nom</Label>
          <Input
            id="add-channel-link"
            name="link"
            placeholder="t.me/mon_canal ou @mon_canal"
            required
            autoComplete="off"
          />
        </div>
        <Button type="submit" className="max-md:h-10" disabled={linkPending}>
          {linkPending ? "Vérification…" : "Ajouter"}
        </Button>
      </form>
      <div aria-live="polite">
        {linkState.ok ? (
          <Alert key={`ok-${linkState.at}`} variant="success" role="status">
            <CircleCheck aria-hidden />
            <AlertDescription>{linkState.ok}</AlertDescription>
          </Alert>
        ) : linkState.error ? (
          <Alert key={`err-${linkState.at}`} variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{linkState.error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </>
  );
}

/**
 * Fenêtre « Ajouter un canal existant » : les trois méthodes dans l'ordre, et pendant 2 minutes la liste des canaux
 * se rafraîchit toute seule ; un bandeau « Canal « X » détecté ✅ » apparaît dès qu'un nouveau canal arrive.
 * La méthode 2 affiche son résultat dans la fenêtre même (et rafraîchit la liste derrière) ; ce canal-là n'a pas de second
 * bandeau « détecté ». À chaque ouverture, bandeaux et résultat de la méthode 2 repartent de zéro.
 */
export function AddChannelDialog({
  bots,
  latestId,
  canImportFromAccount,
}: {
  bots: BotItem[];
  latestId: string | null;
  canImportFromAccount: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /** Compteur d'ouvertures : clé du formulaire de la méthode 2 (remonté, donc vidé, à chaque ouverture). */
  const [openCount, setOpenCount] = useState(0);
  const [detected, setDetected] = useState<DetectedChannel[]>([]);
  /** La surveillance de 2 minutes est-elle arrivée à son terme (depuis la dernière ouverture) ? */
  const [expired, setExpired] = useState(false);
  const watchRef = useRef(watchOpen(latestId));
  const watching = open && !expired;

  // Fenêtre fermée : on se cale sur le dernier canal connu. Fenêtre ouverte : on ne bouge pas, sinon un canal arrivé
  // pendant la surveillance (rafraîchissement de la page) ne serait jamais annoncé.
  useEffect(() => {
    if (!open) watchRef.current = watchOpen(latestId);
  }, [latestId, open]);

  const onLinkAdded = useCallback(
    (channelId: string) => {
      watchRef.current = watchAdded(watchRef.current, channelId);
      setDetected(watchRef.current.detected);
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    if (!open) return;
    const startedAt = Date.now();
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/channels/count", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as CountResponse;
          if (stopped) return;
          const { state, changed } = watchPoll(watchRef.current, data.latest);
          if (changed) {
            watchRef.current = state;
            setDetected(state.detected);
            router.refresh();
          }
        }
      } catch {
        /* réseau : on réessaiera au prochain tour */
      }
      if (Date.now() - startedAt >= WATCH_MS) {
        stopped = true;
        setExpired(true);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open, router]);

  const firstBot = bots[0]?.username ?? "votre_bot";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          watchRef.current = watchOpen(latestId);
          setExpired(false);
          setDetected([]);
          setOpenCount((n) => n + 1);
        }
      }}
    >
      <DialogTrigger render={<Button className="max-md:h-10" />}>
        <Plus aria-hidden />
        Ajouter un canal existant
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajouter un canal existant</DialogTitle>
          <DialogDescription>
            Le bot est déjà administrateur d&apos;un canal qui n&apos;apparaît pas dans la liste ?
            Trois façons de le faire connaître, de la plus simple à la plus manuelle.
          </DialogDescription>
        </DialogHeader>

        {detected.map((d) => (
          <Alert key={d.id} variant="success" role="status">
            <CircleCheck aria-hidden />
            <AlertDescription>
              Canal « {d.title} » détecté : il est maintenant dans la liste.
            </AlertDescription>
          </Alert>
        ))}

        <ol className="space-y-3">
          <MethodStep
            n={1}
            title="Transférer un message du canal à l'un des bots"
            note="Marche aussi pour les canaux privés."
          >
            <p className="text-body text-muted-foreground">
              Dans Telegram, ouvrez le canal, appuyez longuement sur n&apos;importe quel message →
              Transférer → choisissez l&apos;un des bots ci-dessous. Le bot répond « Canal ajouté »
              et le canal apparaît ici.
            </p>
            {bots.length === 0 ? (
              <p className="text-body text-danger">
                Aucun bot actif : ajoutez d&apos;abord un bot (Réglages → Bots).
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2" aria-label="Ouvrir un bot dans Telegram">
                {bots.map((b) => (
                  <li key={b.username}>
                    <a
                      href={`https://t.me/${b.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "max-md:h-10",
                      )}
                    >
                      @{b.username}
                      <ExternalLink aria-hidden />
                      <span className="sr-only"> (s&apos;ouvre dans Telegram)</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-note text-muted-foreground">
              Seuls les comptes Telegram liés à la plateforme (Mon compte → Lier mon Telegram) sont
              acceptés. Si le canal interdit le transfert (contenu protégé), passez à la méthode 3.
            </p>
          </MethodStep>

          <MethodStep
            n={2}
            title="Coller le lien public du canal"
            note="Pour un canal public seulement : son lien t.me/… ou son @nom."
          >
            <LinkMethodForm key={openCount} onAdded={onLinkAdded} />
          </MethodStep>

          <MethodStep n={3} title="Publier un message dans le canal">
            <p className="text-body text-muted-foreground">
              Le bot doit déjà être administrateur du canal (sinon Telegram ne lui montre pas les
              publications). Publiez n&apos;importe quel message dans le canal (un simple « . »
              suffit) : le bot le voit et enregistre le canal. Vous pouvez ensuite supprimer ce
              message.
            </p>
          </MethodStep>
        </ol>

        {canImportFromAccount ? (
          <p className="text-body">
            Beaucoup de canaux ?{" "}
            <Link
              href="/channels/import"
              className="font-medium text-brand-ink underline underline-offset-4"
            >
              Importer tous mes canaux
            </Link>{" "}
            depuis votre compte Telegram connecté.
          </p>
        ) : null}

        <p className="text-note text-muted-foreground" aria-live="polite">
          {watching
            ? "Surveillance en cours : la liste se met à jour toute seule pendant 2 minutes."
            : "Surveillance terminée : fermez et rouvrez cette fenêtre pour relancer, ou rechargez la page."}{" "}
          Dans tous les cas, le bot doit être administrateur du canal pour accueillir les membres :
          canal → Administrateurs → Ajouter → @{firstBot}.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Une méthode d'ajout : numéro dans un rond orange pâle, titre, une ligne d'aide, puis le contenu. */
function MethodStep({
  n,
  title,
  note,
  children,
}: {
  n: number;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-xl border border-border p-4">
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-note font-semibold text-brand-ink tabular-nums"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="text-body font-semibold text-foreground">
          <span className="sr-only">Méthode {n} : </span>
          {title}
        </h3>
        {note ? <p className="-mt-1 text-note text-muted-foreground">{note}</p> : null}
        {children}
      </div>
    </li>
  );
}
