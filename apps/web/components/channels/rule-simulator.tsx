"use client";

import { useId, useState } from "react";
import { FlaskConical, Info } from "lucide-react";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { NameMaps } from "@/lib/channels/exceptions";
import { simulate, type SimGroup, type SimRule } from "@/lib/channels/rule-simulator";

/**
 * Simulateur de « Qui peut entrer et quand » : « Si quelqu'un vient de [▾], il se passe : … » avec les règles
 * enregistrées du canal, exactement comme le bot (`simulate`, fondé sur `packages/core/src/provenance.ts`) : la règle
 * appliquée, les canaux à rejoindre, le moment de l'acceptation et le message du bot. Rien n'est envoyé.
 */
export function RuleSimulator({
  rules,
  groups,
  ctx,
}: {
  rules: SimRule[];
  groups: SimGroup[];
  ctx: NameMaps & { channelId: string; channelTitle: string };
}) {
  const id = useId();
  const choices = groups.flatMap((g) => g.choices);
  const [key, setKey] = useState(choices[0]?.key ?? "");
  const choice = choices.find((c) => c.key === key) ?? choices[0];
  if (!choice) return null;
  const r = simulate(rules, choice.provenance, ctx);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-4 rounded-xl border border-border bg-surface p-4 md:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"
        >
          <FlaskConical className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-title text-foreground">
            Et si quelqu&apos;un demande à entrer ?
          </h2>
          <p className="mt-0.5 text-note text-muted-foreground">
            D&apos;après les règles enregistrées, exactement comme le bot. Rien n&apos;est envoyé.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-from`}>Si quelqu&apos;un vient…</Label>
        <NativeSelect
          id={`${id}-from`}
          value={choice.key}
          onChange={(e) => setKey(e.target.value)}
          wrapperClassName="w-full"
        >
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.choices.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      </div>
      <div aria-live="polite" className="space-y-3">
        <p className="text-body font-semibold text-foreground">… il se passe :</p>
        <DetailList className="max-sm:grid-cols-1 max-sm:gap-y-1">
          <DetailRow label="Règle appliquée">{r.ruleText}</DetailRow>
          <DetailRow label="Canaux à rejoindre">{r.gatesText}</DetailRow>
          <DetailRow label="Acceptation">{r.whenText}</DetailRow>
          <DetailRow label="Message du bot">{r.messageText}</DetailRow>
        </DetailList>
        {r.notes.length > 0 ? (
          <ul className="space-y-1">
            {r.notes.map((n) => (
              <li key={n} className="flex items-start gap-2 text-note text-muted-foreground">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                {n}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
