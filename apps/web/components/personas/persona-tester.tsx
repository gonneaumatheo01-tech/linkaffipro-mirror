"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Info, RotateCcw, Send, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtMoney } from "@/lib/format";
import { personaRole } from "@/lib/personas/form";
import type { TestNotice, TestResponse, TestState } from "@/lib/personas/test-turn";
import { styleLines } from "@/lib/personas/view";
import { StatusBadge } from "@/lib/status-badges";
import { cn } from "@/lib/utils";

type Bubble = {
  id: number;
  from: "person" | "assistant";
  text: string;
  button: string | null;
  mediaAssetId: string | null;
  fixed: boolean;
};

const START: TestState = {
  stage: "WELCOME",
  style: {},
  facts: [],
  assistantTurns: 0,
  offerSends: 0,
  closed: false,
};

/** Historique renvoyé à chaque message (même borne que la route). */
const HISTORY_SENT = 40;
const MESSAGE_MAX = 1000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function costText(eur: number): string {
  if (eur > 0 && eur < 0.01) return `moins de ${fmtMoney(0.01)}`;
  return fmtMoney(eur);
}

const NOTICE_ICONS = { info: Info, warning: TriangleAlert, danger: CircleAlert } as const;
const NOTICE_VARIANTS = { info: "info", warning: "warning", danger: "destructive" } as const;

/**
 * « Tester » une persona (phase 17) : conversation simulée dans la page, sans Telegram. L'équipe écrit comme une
 * personne qui découvre le bot ; l'assistante répond avec la vraie IA (persona enregistrée, coût compté dans le plafond
 * du mois) : bulles avec un « écrit… » court, bouton d'offre affiché comme un faux bouton (lien d'essai, aucun suivi),
 * étape du parcours et style détecté à côté, « Recommencer ». Le mineur, le refus des contrôles et la panne de l'IA
 * s'affichent comme dans la vraie vie. L'historique reste dans la page (rien n'est enregistré, sauf le coût).
 */
export function PersonaTester({
  personaId,
  personaName,
  gender,
  maxOfferSends,
  blockedReason,
  offerNote,
}: {
  personaId: string;
  personaName: string;
  gender: string;
  maxOfferSends: number;
  /** Test impossible pour l'instant (clé absente, plafond atteint) : la raison, en une phrase. */
  blockedReason: string | null;
  /** Remarque sur l'offre (aucune offre utilisable : jamais de lien). */
  offerNote: string | null;
}) {
  const role = personaRole(gender);
  const name = personaName.trim() || role.charAt(0).toUpperCase() + role.slice(1);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [conv, setConv] = useState<TestState>(START);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<TestNotice | null>(null);
  const [last, setLast] = useState<Pick<TestResponse, "note" | "rejected" | "model"> | null>(null);
  const [cost, setCost] = useState(0);
  const generation = useRef(0);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles, typing]);

  const busy = pending || typing;
  const closed = conv.closed || conv.stage === "CLOSED";

  function reset() {
    generation.current += 1;
    setBubbles([]);
    setConv(START);
    setText("");
    setPending(false);
    setTyping(false);
    setError(null);
    setNotice(null);
    setLast(null);
    setCost(0);
  }

  async function send() {
    const message = text.trim();
    if (!message || busy || closed || blockedReason) return;
    const gen = generation.current;
    const history = bubbles.slice(-HISTORY_SENT).map((b) => ({ from: b.from, text: b.text }));
    setBubbles((b) => [
      ...b,
      {
        id: nextId.current++,
        from: "person",
        text: message,
        button: null,
        mediaAssetId: null,
        fixed: false,
      },
    ]);
    setText("");
    setPending(true);
    setTyping(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/assistant/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personaId, message, history, state: conv }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<TestResponse> & {
        error?: string;
      };
      if (gen !== generation.current) return;
      if (!res.ok || !data.state) {
        setError(data.error ?? "L'essai n'a pas pu aboutir : réessayez dans un instant.");
        return;
      }
      setPending(false);
      for (const part of data.parts ?? []) {
        setTyping(true);
        await wait(part.typingMs);
        if (gen !== generation.current) return;
        setBubbles((b) => [
          ...b,
          {
            id: nextId.current++,
            from: "assistant",
            text: part.text,
            button: part.button,
            mediaAssetId: part.mediaAssetId,
            fixed: part.fixed,
          },
        ]);
      }
      setConv(data.state);
      setNotice(data.notice ?? null);
      setLast({
        note: data.note ?? null,
        rejected: data.rejected ?? [],
        model: data.model ?? null,
      });
      setCost((c) => c + (data.costEur ?? 0));
    } catch {
      if (gen === generation.current) setError("Connexion impossible : réessayez dans un instant.");
    } finally {
      if (gen === generation.current) {
        setPending(false);
        setTyping(false);
      }
    }
  }

  const style = styleLines(conv.style);
  const NoticeIcon = notice ? NOTICE_ICONS[notice.tone] : null;

  return (
    <section
      id="tester"
      aria-labelledby="tester-title"
      className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="space-y-1 border-b border-border p-4">
        <h2 id="tester-title" className="text-body font-semibold text-foreground">
          Tester
        </h2>
        <p className="text-note text-muted-foreground">
          Écrivez comme une personne qui découvre le bot : {role} répond avec la vraie IA,
          d&apos;après la version enregistrée. Rien ne part sur Telegram ; le coût compte dans le
          plafond du mois.
        </p>
      </div>

      {blockedReason ? (
        <div className="p-4">
          <Alert variant="warning" role="status">
            <TriangleAlert aria-hidden />
            <AlertDescription>{blockedReason}</AlertDescription>
          </Alert>
        </div>
      ) : (
        <>
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-label="Conversation d'essai"
            tabIndex={0}
            className="h-80 space-y-2 overflow-y-auto bg-background p-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          >
            {bubbles.length === 0 && !typing ? (
              <p className="px-2 py-6 text-center text-note text-muted-foreground">
                Commencez par un message, par exemple « salut, tu fais quoi ? ».
                {offerNote ? ` ${offerNote}` : ""}
              </p>
            ) : null}
            {bubbles.map((b) => (
              <BubbleView key={b.id} bubble={b} name={name} />
            ))}
            {typing ? (
              <p className="px-1 text-note text-muted-foreground" aria-live="off">
                {name} écrit…
              </p>
            ) : null}
          </div>

          <div className="space-y-3 border-t border-border p-4">
            {error ? (
              <p role="alert" className="flex items-start gap-2 text-body text-danger">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            ) : null}
            {notice && NoticeIcon ? (
              <Alert variant={NOTICE_VARIANTS[notice.tone]} role="status">
                <NoticeIcon aria-hidden />
                <AlertDescription>{notice.text}</AlertDescription>
              </Alert>
            ) : null}
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <Label htmlFor="tester-message">Votre message (comme une personne)</Label>
              <Textarea
                id="tester-message"
                value={text}
                rows={2}
                maxLength={MESSAGE_MAX}
                disabled={closed}
                placeholder={
                  closed ? "Conversation fermée : cliquez sur « Recommencer »." : "Votre message…"
                }
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                aria-describedby="tester-message-help"
              />
              <p id="tester-message-help" className="text-note text-muted-foreground">
                Entrée pour envoyer, Maj + Entrée pour aller à la ligne.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant="outline"
                  disabled={busy || closed || !text.trim()}
                  className="max-md:h-10"
                >
                  <Send aria-hidden />
                  {pending ? "Envoi…" : "Envoyer"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={reset}
                  disabled={bubbles.length === 0 && !error}
                  className="max-md:h-10"
                >
                  <RotateCcw aria-hidden />
                  Recommencer
                </Button>
              </div>
            </form>
          </div>

          <dl className="grid gap-3 border-t border-border p-4 text-body sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-note text-muted-foreground">Étape du parcours</dt>
              <dd>
                <StatusBadge kind="conversationStage" value={conv.stage} />
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-note text-muted-foreground">Liens envoyés</dt>
              <dd className="tabular-nums">
                {conv.offerSends} sur {maxOfferSends} au plus
              </dd>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <dt className="text-note text-muted-foreground">Style détecté chez la personne</dt>
              <dd>{style.length ? style.join(" · ") : "Pas encore assez d'échanges."}</dd>
            </div>
            {conv.facts.length ? (
              <div className="space-y-1 sm:col-span-2">
                <dt className="text-note text-muted-foreground">
                  Ce que {role} a retenu sur la personne
                </dt>
                <dd>{conv.facts.join(" · ")}</dd>
              </div>
            ) : null}
            {last?.note ? (
              <div className="space-y-1 sm:col-span-2">
                <dt className="text-note text-muted-foreground">
                  Note de l&apos;IA (jamais envoyée)
                </dt>
                <dd className="text-muted-foreground">{last.note}</dd>
              </div>
            ) : null}
            {last && last.rejected.length ? (
              <div className="space-y-1 sm:col-span-2">
                <dt className="text-note text-muted-foreground">Refusé par les contrôles</dt>
                <dd>{last.rejected.join(", ")}</dd>
              </div>
            ) : null}
            <div className="space-y-1 sm:col-span-2">
              <dt className="text-note text-muted-foreground">Coût de cet essai</dt>
              <dd className="tabular-nums">
                {costText(cost)}
                {last?.model ? (
                  <span className="text-note text-muted-foreground"> · modèle {last.model}</span>
                ) : null}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

function BubbleView({ bubble, name }: { bubble: Bubble; name: string }) {
  const mine = bubble.from === "person";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] space-y-1.5 rounded-2xl px-3 py-2 text-body",
          mine
            ? "rounded-br-sm bg-brand-soft text-foreground"
            : "rounded-bl-sm border border-border bg-card text-foreground",
        )}
      >
        <span className="sr-only">{mine ? "Vous : " : `${name} : `}</span>
        {bubble.mediaAssetId ? (
          // Aperçu servi par notre propre route (session requise).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/media/${bubble.mediaAssetId}`}
            alt="Visuel de l'app envoyé avec le lien"
            className="max-h-40 w-full rounded-lg object-cover"
          />
        ) : null}
        <p className="whitespace-pre-wrap break-words">{bubble.text}</p>
        {bubble.button ? (
          <span
            aria-disabled="true"
            className="block rounded-lg border border-border bg-surface px-3 py-1.5 text-center font-medium text-info"
          >
            {bubble.button}
            <span className="block text-note font-normal text-muted-foreground">
              (lien d&apos;essai, aucun suivi)
            </span>
          </span>
        ) : null}
        {bubble.fixed ? (
          <span className="block text-note text-muted-foreground">Texte de secours</span>
        ) : null}
      </div>
    </div>
  );
}
