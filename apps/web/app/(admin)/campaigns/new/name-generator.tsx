"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildCampaignName } from "@/lib/campaigns/match";

/**
 * Bouton « Générer un nom » du formulaire de campagne : lit la plateforme, l'univers et le premier canal coché
 * dans le formulaire parent, puis écrit « TT-casinoX-FR-canalA-2026-10 » dans le champ Nom.
 * Composant client autonome : le formulaire reste un composant serveur.
 */
export function NameGenerator({ channels }: { channels: Array<{ id: string; title: string }> }) {
  const [program, setProgram] = useState("");
  const [language, setLanguage] = useState("FR");

  function generate(e: React.MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form;
    if (!form) return;
    const fd = new FormData(form);
    const channelId = fd.getAll("channelIds").map(String)[0];
    const channel = channels.find((c) => c.id === channelId)?.title ?? "";
    const name = buildCampaignName({
      platform: String(fd.get("adPlatform") ?? ""),
      program: program || String(fd.get("vertical") ?? ""),
      language,
      channel,
      date: new Date(),
    });
    const input = form.elements.namedItem("name");
    if (input instanceof HTMLInputElement) {
      input.value = name;
      input.focus();
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-2">
      <div className="space-y-1">
        <Label htmlFor="gen-program" className="text-xs">
          Programme (ex. casinoX)
        </Label>
        <Input
          id="gen-program"
          value={program}
          onChange={(e) => setProgram(e.target.value)}
          placeholder="univers si vide"
          className="h-9 w-40 md:h-8"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="gen-language" className="text-xs">
          Langue
        </Label>
        <Input
          id="gen-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          maxLength={5}
          className="h-9 w-16 uppercase md:h-8"
        />
      </div>
      <Button type="button" size="sm" variant="outline" className="max-md:h-10" onClick={generate}>
        Générer un nom
      </Button>
      <span className="text-xs text-muted-foreground">
        Utilise la plateforme, le premier canal coché et le mois en cours.
      </span>
    </div>
  );
}
