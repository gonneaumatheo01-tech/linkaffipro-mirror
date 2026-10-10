"use client";

import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * « Programmer » / « Changer la date » sur la fiche d'un envoi : une petite boîte avec la date et l'heure (heure de
 * Paris), envoyée à l'action serveur existante `scheduleAction` (champs `broadcastId` et `scheduledAt`).
 */
export function ScheduleDialog({
  action,
  broadcastId,
  defaultValue,
  label,
}: {
  action: (formData: FormData) => void | Promise<void>;
  broadcastId: string;
  /** Valeur du champ datetime-local (heure de Paris). */
  defaultValue: string;
  label: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" className="max-md:h-10">
            <CalendarClock aria-hidden />
            {label}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Le message partira tout seul à cette date et à cette heure (heure de Paris).
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="broadcastId" value={broadcastId} />
          <div className="space-y-2">
            <Label htmlFor="broadcast-schedule-at">Date et heure (heure de Paris)</Label>
            <Input
              id="broadcast-schedule-at"
              name="scheduledAt"
              type="datetime-local"
              defaultValue={defaultValue}
              required
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Annuler</DialogClose>
            <Button type="submit">
              <CalendarClock aria-hidden />
              Programmer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
