"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CASINO_UPLOAD,
  CASINO_UPLOAD_ACCEPT,
  casinoUploadProblem,
  type CasinoTheme,
} from "@/lib/agents/casino";

type UploadReply = {
  files?: Array<{ id: string; filename: string; error?: string }>;
  error?: string;
};

/**
 * Dépôt de vidéos et d'images depuis la fiche Casino (ADMIN et MANAGER) : les thèmes d'abord (un ou plusieurs), puis
 * les fichiers (contrôlés avant l'envoi et par le serveur). Chaque fichier est rangé pour l'équipe Casino, déposé par
 * l'équipe, avec ces thèmes. La page est rechargée après l'envoi.
 */
export function CasinoUpload({ themes }: { themes: CasinoTheme[] }) {
  const router = useRouter();
  const uid = useId();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  function toggle(key: string, on: boolean) {
    setPicked((p) => (on ? [...p.filter((k) => k !== key), key] : p.filter((k) => k !== key)));
  }

  async function send(list: FileList | null) {
    if (!list || list.length === 0) return;
    setDone(null);
    if (picked.length === 0) {
      setErrors(["Cochez d'abord au moins un thème."]);
      return;
    }
    const problems: string[] = [];
    const fd = new FormData();
    fd.append("purpose", "casino");
    for (const t of picked) fd.append("themes", t);
    let count = 0;
    for (const f of Array.from(list)) {
      const p = casinoUploadProblem(f.type, f.size);
      if (p) problems.push(`${f.name} : ${p}`);
      else {
        fd.append("files", f);
        count++;
      }
    }
    if (count === 0) {
      setErrors(problems);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/agents/media", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as UploadReply;
      if (!res.ok) problems.push(data.error ?? "Envoi impossible : réessayez.");
      const ok = (data.files ?? []).filter((f) => f.id && !f.error).length;
      for (const f of data.files ?? []) if (f.error) problems.push(`${f.filename} : ${f.error}`);
      setErrors(problems);
      if (ok > 0) {
        setDone(ok > 1 ? `${ok} fichiers rangés.` : "Fichier rangé.");
        router.refresh();
      }
    } catch {
      setErrors([...problems, "Envoi interrompu : vérifiez la connexion, puis réessayez."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-note font-medium text-foreground">Thèmes des fichiers</legend>
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          {themes.map((t) => (
            <li key={t.key}>
              <label className="flex min-h-9 items-center gap-2 text-body">
                <Checkbox
                  checked={picked.includes(t.key)}
                  onCheckedChange={(v) => toggle(t.key, Boolean(v))}
                />
                {t.label}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <label className="inline-flex min-h-9 cursor-pointer items-center rounded-md border border-border bg-background px-3 text-body font-medium text-foreground hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring max-md:min-h-10">
        {busy ? "Envoi en cours…" : "Déposer des vidéos ou des images"}
        <input
          type="file"
          multiple
          className="sr-only"
          disabled={busy}
          accept={CASINO_UPLOAD_ACCEPT}
          aria-describedby={`${uid}-aide`}
          onChange={(e) => {
            void send(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <p id={`${uid}-aide`} className="text-note text-muted-foreground">
        Vidéos {CASINO_UPLOAD.video.types} (50 Mo au plus), images {CASINO_UPLOAD.image.types} (10
        Mo au plus), 10 fichiers à la fois. Vous pouvez aussi les envoyer au bot sur Telegram avec
        #casino et le thème, par exemple #casino #roulette.
      </p>
      {done ? (
        <p role="status" className="text-note text-success">
          {done}
        </p>
      ) : null}
      {errors.length ? (
        <ul role="alert" className="space-y-1 text-body text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
