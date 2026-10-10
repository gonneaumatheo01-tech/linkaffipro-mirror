"use client";

import { Tabs } from "@base-ui/react/tabs";
import { cn } from "@/components/ui/cn";

/**
 * Langues d'un message du bot en onglets (Base UI : flèches gauche / droite, onglet actif souligné d'orange).
 * Les panneaux restent montés : un texte en cours de modification n'est pas perdu en changeant d'onglet.
 */
export function LangTabs({
  label,
  items,
  defaultValue,
  actions,
}: {
  label: string;
  items: Array<{ value: string; label: string; content: React.ReactNode }>;
  defaultValue?: string;
  /** Contenu à droite de la barre d'onglets (ex. « Ajouter une langue »). */
  actions?: React.ReactNode;
}) {
  const first = items.some((i) => i.value === defaultValue) ? defaultValue : items[0]?.value;
  return (
    <Tabs.Root defaultValue={first}>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border">
        <Tabs.List aria-label={label} className="-mb-px flex gap-1 overflow-x-auto">
          {items.map((i) => (
            <Tabs.Tab
              key={i.value}
              value={i.value}
              className={cn(
                "inline-flex h-9 shrink-0 items-center border-b-2 border-transparent px-3 text-body whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground max-md:h-10",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                "data-[active]:border-brand data-[active]:font-semibold data-[active]:text-foreground",
              )}
            >
              {i.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {actions ? <div className="pb-1.5">{actions}</div> : null}
      </div>
      {items.map((i) => (
        <Tabs.Panel
          key={i.value}
          value={i.value}
          keepMounted
          className="pt-4 outline-none data-[hidden]:hidden"
        >
          {i.content}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
