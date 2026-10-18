"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";
import {
  mergeOffers,
  mergeThread,
  nextRemoved,
  THREAD_POLL_MS,
  THREAD_REFRESH_EVENT,
  threadCursor,
  vanishedFromThread,
  type OfferState,
  type ThreadMessage,
  type ThreadUpdate,
} from "@/lib/conversations/thread";
import { MessageBubble } from "./message-bubble";

/** Distance du bas (px) sous laquelle le fil suit les nouveaux messages tout seul. */
const STICK_TO_BOTTOM_PX = 120;

/** Demande au fil de se relire tout de suite (après « Envoyer »). */
export function requestThreadRefresh(): void {
  window.dispatchEvent(new Event(THREAD_REFRESH_EVENT));
}

/**
 * Fil d'une conversation, mis à jour en direct : toutes les 4 s tant que l'onglet est visible (rien quand il est
 * caché ; relu dès qu'il redevient visible ou après « Envoyer »), GET /api/conversations/<id>/messages?after=… ne
 * renvoie que les nouveaux messages et l'état. Un changement d'état (l'équipe a pris la main ailleurs, /stop, blocage)
 * recharge la fiche (boutons et en-tête). Les messages lus par la page et par le fil sont fusionnés sans doublon,
 * l'envoi le plus avancé gagne ; un message qui n'existe plus (envoi de l'assistante raté, retiré par le worker) est
 * retiré du fil dès la relecture suivante, même s'il venait de la page. Le fil suit les nouveaux messages tant qu'on
 * est en bas ; il défile au clavier.
 */
export function ConversationThread({
  conversationId,
  initialMessages,
  initialOffers,
  initialCursor,
  stateKey,
  truncated,
}: {
  conversationId: string;
  initialMessages: ThreadMessage[];
  initialOffers: Record<string, OfferState>;
  initialCursor: string;
  stateKey: string;
  /** La page ne montre que les 200 derniers messages. */
  truncated: boolean;
}) {
  const router = useRouter();
  const [polled, setPolled] = useState<ThreadMessage[]>([]);
  /** Messages qui n'existent plus (retirés du fil, qu'ils viennent de la page ou d'une relecture). */
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [polledOffers, setPolledOffers] = useState<Record<string, OfferState> | null>(null);
  const [offline, setOffline] = useState(false);
  const messages = useMemo(
    () => mergeThread(initialMessages, polled).filter((m) => !removed.has(m.id)),
    [initialMessages, polled, removed],
  );
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const offers = useMemo(
    () => mergeOffers(initialOffers, polledOffers),
    [initialOffers, polledOffers],
  );

  const cursorRef = useRef(initialCursor);
  const stateKeyRef = useRef(stateKey);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    stateKeyRef.current = stateKey;
    cursorRef.current = threadCursor(
      initialMessages,
      cursorRef.current > initialCursor ? cursorRef.current : initialCursor,
    );
  }, [stateKey, initialMessages, initialCursor]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let inFlight = false;

    const poll = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      // Seuls les messages déjà affichés AVANT la relecture peuvent avoir disparu : ils existaient avant sa lecture en
      // base (un message arrivé par un rechargement de la page pendant la relecture n'est jamais retiré à tort).
      const shownBefore = messagesRef.current;
      try {
        const res = await fetch(
          `/api/conversations/${encodeURIComponent(conversationId)}/messages?after=${encodeURIComponent(cursorRef.current)}`,
          { cache: "no-store", headers: { accept: "application/json" } },
        );
        if (stopped) return;
        if (res.status === 404 || res.status === 401) {
          router.refresh();
          return;
        }
        if (!res.ok) {
          setOffline(true);
          return;
        }
        const data = (await res.json()) as ThreadUpdate;
        if (stopped) return;
        setOffline(false);
        const vanished = data.windowStart
          ? vanishedFromThread(shownBefore, data)
          : new Set<string>();
        if (vanished.size > 0 || data.messages.length > 0) {
          setRemoved((cur) => nextRemoved(cur, vanished, data.messages));
          setPolled((cur) =>
            mergeThread(
              cur.filter((m) => !vanished.has(m.id)),
              data.messages,
            ),
          );
        }
        setPolledOffers(data.offers);
        if (data.cursor > cursorRef.current) cursorRef.current = data.cursor;
        if (data.stateKey !== stateKeyRef.current) {
          stateKeyRef.current = data.stateKey;
          router.refresh();
        }
      } catch {
        if (!stopped) setOffline(true);
      } finally {
        inFlight = false;
      }
    };

    const hidden = () => document.visibilityState === "hidden";
    const schedule = () => {
      if (stopped || timer || hidden()) return;
      timer = setTimeout(async () => {
        timer = null;
        if (hidden()) return;
        await poll();
        schedule();
      }, THREAD_POLL_MS);
    };
    const onVisibility = () => {
      if (hidden()) {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      void poll().then(schedule);
    };
    const onRefresh = () => void poll();

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(THREAD_REFRESH_EVENT, onRefresh);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(THREAD_REFRESH_EVENT, onRefresh);
    };
  }, [conversationId, router]);

  // Suit les nouveaux messages tant que la personne qui lit est en bas du fil (au premier affichage : tout en bas).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
  };

  return (
    <div className="space-y-2">
      {offline ? (
        <p role="status" className="flex items-center gap-2 text-note text-warning">
          <WifiOff aria-hidden className="size-4" />
          Le fil n&apos;a pas pu être mis à jour : nouvel essai dans quelques secondes.
        </p>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label="Messages de la conversation"
        tabIndex={0}
        className="max-h-[65vh] min-h-48 overflow-y-auto rounded-xl border border-border bg-background p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid md:p-4"
      >
        {truncated ? (
          <p className="mb-3 text-center text-note text-muted-foreground">
            Seuls les 200 derniers messages sont affichés.
          </p>
        ) : null}
        {messages.length === 0 ? (
          <p className="py-10 text-center text-body text-muted-foreground">
            Aucun message pour l&apos;instant.
          </p>
        ) : (
          <ol className="space-y-4">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                offer={m.offerSubId ? offers[m.offerSubId] : undefined}
              />
            ))}
          </ol>
        )}
      </div>
      <p className="text-note text-muted-foreground">
        Mis à jour en direct tant que cette page est ouverte.
      </p>
    </div>
  );
}
