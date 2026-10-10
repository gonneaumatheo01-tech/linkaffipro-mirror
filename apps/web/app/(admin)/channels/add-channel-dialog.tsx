"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addChannelByLinkAction } from "./actions";

type BotItem = { username: string; name: string };

/** Durée de surveillance après l'ouverture (2 minutes), un contrôle toutes les 5 secondes. */
const WATCH_MS = 120_000;
const POLL_MS = 5_000;

type CountResponse = { count: number; latest: { id: string; title: string } | null };

/**
 * Fenêtre « Ajouter un canal existant » : les trois méthodes dans l'ordre, et pendant 2 minutes la liste des canaux
 * se rafraîchit toute seule ; un bandeau « Canal « X » détecté ✅ » apparaît dès qu'un nouveau canal arrive.
 */
export function AddChannelDialog({ bots, latestId, canImportFromAccount }: { bots: BotItem[]; latestId: string | null; canImportFromAccount: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [detected, setDetected] = useState<string[]>([]);
  /** La surveillance de 2 minutes est-elle arrivée à son terme (depuis la dernière ouverture) ? */
  const [expired, setExpired] = useState(false);
  const seenRef = useRef<string | null>(latestId);
  const watching = open && !expired;

  useEffect(() => {
    seenRef.current = latestId;
  }, [latestId]);

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
          if (data.latest && data.latest.id !== seenRef.current) {
            seenRef.current = data.latest.id;
            setDetected((d) => [...d, data.latest!.title]);
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
        if (o) setExpired(false);
      }}
    >
      <DialogTrigger render={<Button className="max-md:h-10" />}>Ajouter un canal existant</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajouter un canal existant</DialogTitle>
          <DialogDescription>
            Le bot est déjà administrateur d&apos;un canal mais le canal n&apos;apparaît pas ici ? Trois façons de le faire
            connaître, de la plus simple à la plus manuelle.
          </DialogDescription>
        </DialogHeader>

        {detected.map((title) => (
          <Alert key={title} role="status">
            <AlertDescription>Canal « {title} » détecté ✅ — il est maintenant dans la liste.</AlertDescription>
          </Alert>
        ))}

        <section className="space-y-2 rounded-lg border p-3">
          <h3 className="text-sm font-medium">1. Transférer un message du canal à l&apos;un des bots (marche pour les canaux privés)</h3>
          <p className="text-sm text-muted-foreground">
            Dans Telegram, ouvrez le canal, appuyez longuement sur n&apos;importe quel message → Transférer → choisissez l&apos;un des bots
            ci-dessous. Le bot répond « Canal ajouté ✅ » et le canal apparaît ici.
          </p>
          {bots.length === 0 ? (
            <p className="text-sm text-destructive">Aucun bot actif : ajoutez d&apos;abord un bot (page Bots).</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {bots.map((b) => (
                <li key={b.username}>
                  <Button variant="outline" size="sm" render={<a href={`https://t.me/${b.username}`} target="_blank" rel="noreferrer" />}>
                    @{b.username}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Seuls les comptes Telegram liés à la plateforme (Mon compte → Lier Telegram) sont acceptés. Si le canal interdit le transfert
            (contenu protégé), passez à la méthode 3.
          </p>
        </section>

        <section className="space-y-2 rounded-lg border p-3">
          <h3 className="text-sm font-medium">2. Coller le lien public du canal</h3>
          <p className="text-sm text-muted-foreground">Pour un canal public seulement : son lien t.me/… ou son @nom.</p>
          <form action={addChannelByLinkAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="add-channel-link">Lien ou @nom</Label>
              <Input id="add-channel-link" name="link" placeholder="t.me/mon_canal ou @mon_canal" required autoComplete="off" className="mt-1" />
            </div>
            <Button type="submit" className="max-md:h-10">
              Ajouter
            </Button>
          </form>
        </section>

        <section className="space-y-2 rounded-lg border p-3">
          <h3 className="text-sm font-medium">3. Publier un message dans le canal</h3>
          <p className="text-sm text-muted-foreground">
            Publiez n&apos;importe quel message dans le canal (un simple « . » suffit) : le bot le voit et enregistre le canal. Vous pouvez
            ensuite supprimer ce message.
          </p>
        </section>

        {canImportFromAccount ? (
          <p className="text-sm">
            Beaucoup de canaux ?{" "}
            <Link href="/channels/import" className="underline underline-offset-2">
              Importer tous mes canaux
            </Link>{" "}
            depuis votre compte Telegram connecté.
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground" aria-live="polite">
          {watching
            ? "Surveillance en cours : la liste se met à jour toute seule pendant 2 minutes."
            : "Surveillance terminée : fermez et rouvrez cette fenêtre pour relancer, ou rechargez la page."}{" "}
          Dans tous les cas, le bot doit être administrateur du canal pour accueillir les membres : Canal → Administrateurs → Ajouter → @{firstBot}.
        </p>
      </DialogContent>
    </Dialog>
  );
}
