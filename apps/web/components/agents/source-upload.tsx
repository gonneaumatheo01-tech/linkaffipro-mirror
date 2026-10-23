"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { AGENT_MEDIA_RULES, agentUploadProblem } from "@/lib/agents/dating";

type UploadReply = { files?: Array<{ id: string; filename: string; error?: string }>; error?: string };

/**
 * Dépôt de vidéos sources depuis la fiche d'équipe Rencontres (ADMIN et MANAGER) : la persona d'abord, puis une ou
 * plusieurs vidéos (MP4, MOV ou WebM, 50 Mo au plus chacune, contrôlé avant l'envoi et par le serveur). Chaque vidéo
 * est rangée pour la persona (vidéo source, déposée par l'équipe). La page est rechargée après l'envoi.
 */
export function SourceUpload({ personas }: { personas: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const uid = useId();
  const [personaId, setPersonaId] = useState(personas[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const rule = AGENT_MEDIA_RULES.source;

  async function send(list: FileList | null) {
    if (!list || list.length === 0 || !personaId) return;
    setDone(null);
    const problems: string[] = [];
    const fd = new FormData();
    fd.append("purpose", "source");
    fd.append("personaId", personaId);
    let count = 0;
    for (const f of Array.from(list)) {
      const p = agentUploadProblem("source", f.type, f.size);
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
        setDone(ok > 1 ? `${ok} vidéos rangées.` : "Vidéo rangée.");
        router.refresh();
      }
    } catch {
      setErrors([...problems, "Envoi interrompu : vérifiez la connexion, puis réessayez."]);
    } finally {
      setBusy(false);
    }
  }

  if (personas.length === 0)
    return (
      <p className="text-note text-muted-foreground">
        Créez d&apos;abord une persona dans Conversations → Personas, puis choisissez-la dans le plan d&apos;un canal.
      </p>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-persona`}>Persona</Label>
          <NativeSelect
            id={`${uid}-persona`}
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
            wrapperClassName="w-full sm:w-56"
          >
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="inline-flex min-h-9 cursor-pointer items-center rounded-md border border-border bg-background px-3 text-body font-medium text-foreground hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring max-md:min-h-10">
          {busy ? "Envoi en cours…" : "Déposer des vidéos sources"}
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={busy}
            accept={rule.mimes.join(",")}
            aria-describedby={`${uid}-aide`}
            onChange={(e) => {
              void send(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p id={`${uid}-aide`} className="text-note text-muted-foreground">
        {rule.types}, {rule.maxBytes / (1024 * 1024)} Mo au plus par vidéo. Une personne entière bien visible, 5 à 15
        secondes. Vous pouvez aussi les envoyer au bot avec #rencontres #source et le prénom.
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
