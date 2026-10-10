import { prisma } from "@linkaffipro/db";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Button } from "@/components/ui/button";
import { updateChannelsAction } from "../../actions";
import type { TabProps } from "./shared";

/**
 * Onglet Canaux : les canaux Telegram où arrivent les membres de la campagne (cases à cocher, en cartes avec la
 * pastille d'univers). Les canaux désactivés déjà rattachés sont conservés (l'action les garde) et rappelés.
 */
export async function ChannelsTab({ id, scope }: TabProps) {
  const [channels, inactive] = await Promise.all([
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true, vertical: true, isTest: true },
    }),
    scope.channelIds.length
      ? prisma.channel.findMany({
          where: { id: { in: scope.channelIds }, isActive: false },
          orderBy: { title: "asc" },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
  ]);
  const selected = new Set(scope.channelIds);
  return (
    <FormSection
      title="Canaux de la campagne"
      description="Ils servent au filtre « Campagne » (statistiques, messages, membres) et au choix du canal des nouveaux liens d'entrée."
    >
      {channels.length === 0 ? (
        <EmptyState
          title="Aucun canal actif"
          description="Ajoutez d'abord un canal Telegram, puis revenez le cocher ici."
          action={{ href: "/channels", label: "Aller aux canaux", variant: "outline" }}
        />
      ) : (
        <form action={updateChannelsAction} className="max-w-3xl space-y-4">
          <input type="hidden" name="campaignId" value={id} />
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Canaux alimentés par la campagne</legend>
            {channels.map((c) => (
              <label
                key={c.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-body transition-colors hover:bg-muted/50 has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
              >
                <input
                  type="checkbox"
                  name="channelIds"
                  value={c.id}
                  defaultChecked={selected.has(c.id)}
                  className="size-4 shrink-0 accent-brand"
                />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                {c.isTest ? <StatusPill tone="muted">Test</StatusPill> : null}
                <UniverseDot universe={c.vertical} />
              </label>
            ))}
          </fieldset>
          {inactive.length ? (
            <p className="text-note text-muted-foreground">
              Canaux désactivés gardés dans la campagne (réactivez-les depuis Canaux) :{" "}
              {inactive.map((c) => c.title).join(", ")}.
            </p>
          ) : null}
          <Button type="submit" className="max-md:h-10">
            Enregistrer les canaux
          </Button>
        </form>
      )}
    </FormSection>
  );
}
