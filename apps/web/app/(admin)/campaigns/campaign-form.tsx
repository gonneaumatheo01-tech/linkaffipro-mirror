import { VERTICALS, VERTICAL_LABELS } from "@linkaffipro/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const PLATFORM_LABELS: Record<string, string> = { TIKTOK: "TikTok", META: "Meta", OTHER: "Autre" };
export const STATUS_LABELS: Record<string, string> = { DRAFT: "Brouillon", ACTIVE: "Active", PAUSED: "En pause", ENDED: "Terminée" };

export type CampaignFormValues = {
  id?: string;
  name?: string;
  adPlatform?: string | null;
  vertical?: string | null;
  status?: string;
  budgetDaily?: number | null;
  notes?: string | null;
  channelIds?: string[];
};

export function CampaignForm({ action, values, channels, submitLabel }: { action: (formData: FormData) => Promise<void>; values: CampaignFormValues; channels: Array<{ id: string; title: string }>; submitLabel: string }) {
  const selectCls = "h-9 w-full rounded-md border bg-background px-3 text-sm";
  const selected = new Set(values.channelIds ?? []);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      {values.id ? <input type="hidden" name="campaignId" value={values.id} /> : null}
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="name">Nom de la pub</Label>
        <Input id="name" name="name" required maxLength={120} defaultValue={values.name ?? ""} placeholder="ex. TT-casino-FR-octobre" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="adPlatform">Plateforme</Label>
        <select id="adPlatform" name="adPlatform" defaultValue={values.adPlatform ?? ""} className={selectCls}>
          <option value="">— non précisée —</option>
          {Object.entries(PLATFORM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="vertical">Univers</Label>
        <select id="vertical" name="vertical" defaultValue={values.vertical ?? ""} className={selectCls}>
          <option value="">— non précisé —</option>
          {VERTICALS.map((v) => <option key={v} value={v}>{VERTICAL_LABELS[v]}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="status">Statut</Label>
        <select id="status" name="status" defaultValue={values.status ?? "DRAFT"} className={selectCls}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="budgetDaily">Budget par jour (€, indicatif)</Label>
        <Input id="budgetDaily" name="budgetDaily" inputMode="decimal" defaultValue={values.budgetDaily ?? ""} placeholder="ex. 50" />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label>Canaux alimentés par cette pub</Label>
        <div className="flex flex-wrap gap-3 text-sm">
          {channels.length === 0 ? <span className="text-muted-foreground">Aucun canal détecté.</span> : null}
          {channels.map((c) => (
            <label key={c.id} className="flex items-center gap-1">
              <input type="checkbox" name="channelIds" value={c.id} defaultChecked={selected.has(c.id)} /> {c.title}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} maxLength={2000} defaultValue={values.notes ?? ""} />
      </div>
      <div className="md:col-span-2">
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}
