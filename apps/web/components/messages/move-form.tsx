"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { movePostAction, type MovePostResult } from "@/app/(admin)/messages/move-action";
import { splitLocal, timeLabel } from "@/lib/posts/calendar";

/**
 * « Déplacer » au clavier (volet du calendrier, fiche d'un message) : un jour et une heure (Paris), puis l'action
 * serveur `movePostAction` (mêmes contrôles que le glisser-déposer). `onDone` reçoit le résultat (toast, fermeture) ;
 * sans `onDone` (fiche d'un message), la confirmation s'affiche sous le formulaire et la page est rechargée.
 */
export function MoveForm({
  postId,
  local,
  onDone,
  submitLabel = "Déplacer",
}: {
  postId: string;
  /** Date actuelle (« AAAA-MM-JJTHH:MM », heure de Paris). */
  local: string;
  onDone?: (result: MovePostResult, from: string) => void;
  submitLabel?: string;
}) {
  const id = useId();
  const current = splitLocal(local);
  const [day, setDay] = useState(current?.day ?? "");
  const [time, setTime] = useState(current ? timeLabel(current.hour, current.minute) : "12:00");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await movePostAction({ postId, scheduledAt: `${day}T${time}` });
      if (!r.ok) setError(r.error);
      else if (!onDone) {
        setNotice(r.message);
        router.refresh();
      }
      onDone?.(r, local);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-describedby={`${id}-help`}>
      <p id={`${id}-help`} className="text-note text-muted-foreground">
        Choisissez le nouveau jour et la nouvelle heure (heure de Paris).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-day`}>Jour</Label>
          <Input
            id={`${id}-day`}
            type="date"
            required
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-time`}>Heure</Label>
          <Input
            id={`${id}-time`}
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-36"
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending || !day || !time}>
          <CalendarClock aria-hidden />
          {pending ? "Déplacement…" : submitLabel}
        </Button>
      </div>
      <div aria-live="polite">
        {error ? <p className="text-note text-danger">{error}</p> : null}
        {notice ? <p className="text-note text-success">{notice}</p> : null}
      </div>
    </form>
  );
}
