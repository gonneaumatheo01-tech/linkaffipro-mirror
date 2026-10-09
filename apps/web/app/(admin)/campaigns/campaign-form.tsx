import { VERTICALS, VERTICAL_LABELS } from "@linkaffipro/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { statusLabels } from "@/lib/status-badges";

export const PLATFORM_LABELS: Record<string, string> = statusLabels("adPlatform");
export const STATUS_LABELS: Record<string, string> = statusLabels("campaign");

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

export function CampaignForm({
  action,
  values,
  channels,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  values: CampaignFormValues;
  channels: Array<{ id: string; title: string }>;
  submitLabel: string;
}) {
  const selectCls = "h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9";
  const selected = new Set(values.channelIds ?? []);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      {values.id ? <input type="hidden" name="campaignId" value={values.id} /> : null}
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="name">Nom de la pub</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          defaultValue={values.name ?? ""}
          placeholder="ex. TikTok casino FR octobre"
          className="h-10 md:h-9"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="adPlatform">Plateforme</Label>
        <select
          id="adPlatform"
          name="adPlatform"
          defaultValue={values.adPlatform ?? ""}
          className={selectCls}
        >
          <option value="">— non précisée —</option>
          {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="vertical">Univers</Label>
        <select
          id="vertical"
          name="vertical"
          defaultValue={values.vertical ?? ""}
          className={selectCls}
        >
          <option value="">— non précisé —</option>
          {VERTICALS.map((v) => (
            <option key={v} value={v}>
              {VERTICAL_LABELS[v]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="status">Statut</Label>
        <select
          id="status"
          name="status"
          defaultValue={values.status ?? "DRAFT"}
          className={selectCls}
        >
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="budgetDaily">Budget par jour (€, à titre indicatif)</Label>
        <Input
          id="budgetDaily"
          name="budgetDaily"
          inputMode="decimal"
          defaultValue={values.budgetDaily ?? ""}
          placeholder="ex. 50"
          className="h-10 md:h-9"
        />
      </div>
      <fieldset className="space-y-2 md:col-span-2">
        <legend className="text-sm font-medium">Canaux alimentés par cette pub</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {channels.length === 0 ? (
            <span className="text-muted-foreground">Aucun canal actif pour l&apos;instant.</span>
          ) : null}
          {channels.map((c) => (
            <label key={c.id} className="flex min-h-10 items-center gap-2 md:min-h-0">
              <input
                type="checkbox"
                name="channelIds"
                value={c.id}
                defaultChecked={selected.has(c.id)}
                className="size-4"
              />{" "}
              {c.title}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="notes">Notes (facultatif)</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          maxLength={2000}
          defaultValue={values.notes ?? ""}
        />
      </div>
      <div className="md:col-span-2">
        <Button type="submit" className="max-md:h-10">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
