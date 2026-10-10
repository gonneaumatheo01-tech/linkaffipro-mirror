import { prisma } from "@linkaffipro/db";
import { VERTICAL_LABELS, type Vertical } from "@linkaffipro/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateChannelsAction } from "../../actions";
import type { TabProps } from "./shared";

/** Onglet Canaux : cases à cocher des canaux Telegram alimentés par la campagne (les canaux désactivés sont conservés). */
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
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="text-base">Canaux de la campagne</CardTitle>
        <CardDescription>
          Cochez les canaux Telegram que cette campagne alimente. Ils servent aux filtres « Campagne
          » (tableau de bord, messages, envois) et au choix du canal des nouveaux liens
          d&apos;entrée.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun canal actif : ajoutez d&apos;abord un canal (menu Canaux).
          </p>
        ) : (
          <form action={updateChannelsAction} className="space-y-4">
            <input type="hidden" name="campaignId" value={id} />
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Canaux</legend>
              {channels.map((c) => (
                <label
                  key={c.id}
                  className="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    name="channelIds"
                    value={c.id}
                    defaultChecked={selected.has(c.id)}
                    className="size-4"
                  />
                  <span className="flex-1">
                    {c.title}
                    {c.isTest ? (
                      <span className="ml-1 text-xs text-muted-foreground">(test)</span>
                    ) : null}
                  </span>
                  {c.vertical ? (
                    <span className="text-xs text-muted-foreground">
                      {VERTICAL_LABELS[c.vertical as Vertical] ?? c.vertical}
                    </span>
                  ) : null}
                </label>
              ))}
            </fieldset>
            {inactive.length ? (
              <p className="text-xs text-muted-foreground">
                Canaux désactivés conservés dans la campagne (réactivez-les depuis la page Canaux) :{" "}
                {inactive.map((c) => c.title).join(", ")}.
              </p>
            ) : null}
            <Button type="submit" className="max-md:h-10">
              Enregistrer les canaux
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
