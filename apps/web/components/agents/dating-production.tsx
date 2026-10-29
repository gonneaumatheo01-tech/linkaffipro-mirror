import Link from "next/link";
import { AgentMediaPreview } from "@/components/agents/agent-media-preview";
import { FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/components/ui/cn";
import { createTestPostAction } from "@/app/(admin)/agents/[equipe]/actions";
import { DATING_DEFAULT_BUDGETS, TEST_POST_FORMATS, providerLabel } from "@/lib/agents/dating";
import type { DatingPersonaView } from "@/lib/agents/dating-queries";
import { spendView } from "@/lib/agents/display";
import { fmtDateShort, fmtNum } from "@/lib/format";

function Figure({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className="min-w-0">
      <dt className="text-note text-muted-foreground">{label}</dt>
      <dd className={cn("text-body font-semibold tabular-nums", tone === "warning" ? "text-warning" : "text-foreground")}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Production de l'équipe Rencontres (phase 20, fiche `/agents/dating`) : dépense photo du mois face au plafond,
 * « Produire un post de test » (simulation, canal Test), puis une carte par persona (photos produites ce mois,
 * dernières productions avec aperçu). Les vidéos IA ont été retirées le 29 octobre 2026.
 */
export function DatingProduction({
  personas,
  spent,
  budgets,
  keys,
  isAdmin,
  simulation,
  now,
}: {
  personas: DatingPersonaView[];
  spent: { image: number };
  budgets: { image?: number };
  keys: { fal: boolean };
  isAdmin: boolean;
  simulation: boolean;
  now: Date;
}) {
  const hasKey = keys.fal;
  const capImage = budgets.image ?? DATING_DEFAULT_BUDGETS.image;
  const image = spendView(spent.image, { image: capImage });

  return (
    <FormSection
      id="production"
      title="Photos des personas"
      description={
        hasKey
          ? "Les photos sont neuves, faites avec le fichier du personnage."
          : "Aucune clé de fournisseur : tout tourne en simulation (la photo est celle de la persona)."
      }
      className="scroll-mt-24"
      actions={
        !hasKey && isAdmin ? (
          <Link href="/agents/settings" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
            Coller une clé
          </Link>
        ) : null
      }
    >
      <dl className="grid gap-4 rounded-xl border border-border bg-card px-4 py-3 sm:grid-cols-2">
        <Figure label="Photos IA ce mois" value={image.text} tone={image.tone === "brand" ? undefined : "warning"} />
      </dl>

      <form action={createTestPostAction} className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="test-post-format">Type de post</Label>
          <NativeSelect id="test-post-format" name="format" defaultValue="photo" wrapperClassName="w-full sm:w-40">
            {TEST_POST_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="test-post-persona">Persona</Label>
          <NativeSelect
            id="test-post-persona"
            name="personaId"
            defaultValue={personas[0]?.id ?? ""}
            wrapperClassName="w-full sm:w-56"
          >
            <option value="">Celle du premier canal (texte seulement)</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" className="max-md:h-10">
          Produire un post de test
        </Button>
        <p className="text-note text-muted-foreground sm:basis-full">
          {simulation
            ? "En simulation : il part sur le canal Test après votre validation."
            : "Toujours en simulation : un post de test part sur le canal Test, jamais sur un vrai canal."}
        </p>
      </form>

      {personas.length === 0 ? (
        <p className="text-note text-muted-foreground">
          Aucune persona pour cette équipe : choisissez une persona dans le plan d&apos;un canal ci-dessous, ou créez une
          persona « Une fille » dans Conversations → Personas.
        </p>
      ) : (
        <ul className="space-y-3">
          {personas.map((p) => (
            <li key={p.id} className="space-y-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/conversations/personas/${p.id}#medias`}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {p.name}
                </Link>
                {p.isActive ? <StatusPill tone="success">Active</StatusPill> : <StatusPill tone="muted">Inactive</StatusPill>}
                {p.references === 0 ? <StatusPill tone="warning">Aucune image de référence</StatusPill> : null}
                {!p.hasCharacterFile ? (
                  <StatusPill tone="muted" title="Sans lui, les photos produites restent celles de la persona.">
                    Pas de fichier du personnage
                  </StatusPill>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Figure label="Photos produites ce mois" value={fmtNum(p.photosMonth)} />
                <Figure label="Images de référence" value={`${p.references} sur 3`} />
              </dl>
              {p.latest.length ? (
                <div className="space-y-1.5">
                  <p className="text-note font-medium text-foreground">Dernières productions</p>
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {p.latest.map((m) => {
                      const what = "Photo";
                      const by = providerLabel(m.providerName);
                      return (
                        <li key={m.id} className="space-y-1">
                          <AgentMediaPreview
                            id={m.id}
                            mimeType={m.mimeType}
                            label={`${what} de ${p.name} produite le ${fmtDateShort(m.createdAt, now)}`}
                          />
                          <p className="text-note text-muted-foreground">
                            {what}, {fmtDateShort(m.createdAt, now)}
                            {by ? ` (${by})` : ""}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="text-note text-muted-foreground">Rien de produit pour l&apos;instant.</p>
              )}
            </li>
          ))}
        </ul>
      )}

    </FormSection>
  );
}

/** Encart « Conversation » : l'agent Conversation Rencontres, c'est l'assistante des conversations (phases 17-18). */
export function DatingConversationCard() {
  return (
    <FormSection
      title="Conversation"
      description="Les messages privés des membres sont traités par les personas de la rubrique Conversations : rien à régler ici."
      actions={
        <Link href="/conversations" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
          Ouvrir Conversations
        </Link>
      }
    >
      <p className="text-note text-muted-foreground">
        Boîte de réception, reprise en main, personas et chiffres : tout est dans Conversations.
      </p>
    </FormSection>
  );
}
