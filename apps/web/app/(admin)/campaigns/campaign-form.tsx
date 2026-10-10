import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { statusLabels } from "@/lib/status-badges";
import { UNIVERSES, UNIVERSE_LABELS } from "@/lib/universe";
import { NAMING_EXAMPLE, NAMING_HELP } from "@/lib/campaigns/match";
import { NameGenerator } from "./new/name-generator";

export const PLATFORM_LABELS: Record<string, string> = statusLabels("adPlatform");
export const STATUS_LABELS: Record<string, string> = statusLabels("campaign");

export type CampaignFormValues = {
  id?: string;
  name?: string;
  adPlatform?: string | null;
  vertical?: string | null;
  status?: string;
  budgetDaily?: number | null;
  /** Dates au format AAAA-MM-JJ (facultatives). */
  startAt?: string;
  endAt?: string;
  notes?: string | null;
  channelIds?: string[];
  /** Compte publicitaire connecté (phase 7) qui alimente la campagne. */
  connectionId?: string | null;
  /** La campagne suit déjà une campagne pub de ce compte (changer de compte la détache). */
  followsAdCampaign?: boolean;
};

export type CampaignFormConnection = {
  id: string;
  platform: string;
  name: string;
  externalId: string;
};

/**
 * Formulaire « Modifier la campagne » (volet de la fiche) en trois niveaux : l'essentiel (nom, univers, statut),
 * puis, repliés, les pubs et le compte connecté, le budget et les dates, le nom conventionnel.
 * Les canaux se règlent dans l'onglet Canaux : ils sont renvoyés tels quels (champs cachés), comme si les cases
 * n'avaient pas été touchées ; l'action garde de toute façon les canaux désactivés.
 */
export function CampaignForm({
  action,
  values,
  channels,
  connections = [],
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  values: CampaignFormValues;
  /** Canaux actifs (pour le générateur de nom). */
  channels: Array<{ id: string; title: string }>;
  /** Comptes publicitaires connectés et actifs (Réglages → Connexions). */
  connections?: CampaignFormConnection[];
  submitLabel: string;
}) {
  const adsChanged = [values.adPlatform, values.connectionId].filter(Boolean).length;
  const planChanged = [
    values.budgetDaily ?? null,
    values.startAt || null,
    values.endAt || null,
    values.notes || null,
  ].filter((v) => v !== null).length;
  // Le générateur lit le premier canal coché : les canaux de la campagne, actifs, dans l'ordre de la liste.
  const campaignChannels = channels.filter((c) => values.channelIds?.includes(c.id));
  return (
    <form action={action} className="space-y-6">
      {values.id ? <input type="hidden" name="campaignId" value={values.id} /> : null}
      {(values.channelIds ?? []).map((id) => (
        <input key={id} type="hidden" name="channelIds" value={id} />
      ))}
      <FormSection title="L'essentiel">
        <div className="space-y-2">
          <Label htmlFor="name">Nom de la campagne</Label>
          <Input
            id="name"
            name="name"
            required
            maxLength={120}
            defaultValue={values.name ?? ""}
            placeholder={`ex. ${NAMING_EXAMPLE}`}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vertical">Univers</Label>
            <NativeSelect
              id="vertical"
              name="vertical"
              defaultValue={values.vertical ?? ""}
              wrapperClassName="w-full"
            >
              <option value="">Sans univers</option>
              {UNIVERSES.map((u) => (
                <option key={u} value={u}>
                  {UNIVERSE_LABELS[u]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Statut</Label>
            <NativeSelect
              id="status"
              name="status"
              defaultValue={values.status ?? "DRAFT"}
              wrapperClassName="w-full"
            >
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <p className="text-note text-muted-foreground">
          Les canaux se règlent dans l&apos;onglet Canaux, les offres dans la vue d&apos;ensemble.
        </p>
      </FormSection>

      <AdvancedSection
        title="Pubs et compte connecté"
        description="Plateforme des pubs, compte Meta ou TikTok qui envoie les dépenses."
        modifiedCount={adsChanged}
      >
        <div className="space-y-2">
          <Label htmlFor="adPlatform">Plateforme des pubs</Label>
          <NativeSelect
            id="adPlatform"
            name="adPlatform"
            defaultValue={values.adPlatform ?? ""}
            wrapperClassName="w-full"
          >
            <option value="">Non précisée</option>
            {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="connectionId">Compte pub connecté</Label>
          <NativeSelect
            id="connectionId"
            name="connectionId"
            defaultValue={values.connectionId ?? ""}
            wrapperClassName="w-full"
          >
            <option value="">Sans compte</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {PLATFORM_LABELS[c.platform] ?? c.platform} · {c.name} ({c.externalId})
              </option>
            ))}
            {values.connectionId && !connections.some((c) => c.id === values.connectionId) ? (
              <option value={values.connectionId}>Compte actuel (déconnecté ou en erreur)</option>
            ) : null}
          </NativeSelect>
          <p className="text-note text-muted-foreground">
            Ses dépenses arrivent toutes seules (Réglages → Connexions).
            {values.followsAdCampaign
              ? " Changer de compte détache la campagne pub suivie aujourd'hui."
              : " Une campagne pub du même nom déjà importée de ce compte est reprise à l'enregistrement."}
          </p>
        </div>
      </AdvancedSection>

      <AdvancedSection
        title="Budget, dates et notes"
        description="À titre indicatif : rien n'est bloqué par ces valeurs."
        modifiedCount={planChanged}
      >
        <div className="space-y-2">
          <Label htmlFor="budgetDaily">Budget par jour (€)</Label>
          <Input
            id="budgetDaily"
            name="budgetDaily"
            inputMode="decimal"
            defaultValue={values.budgetDaily ?? ""}
            placeholder="ex. 50"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="startAt">Début</Label>
            <Input id="startAt" name="startAt" type="date" defaultValue={values.startAt ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endAt">Fin</Label>
            <Input id="endAt" name="endAt" type="date" defaultValue={values.endAt ?? ""} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={2000}
            defaultValue={values.notes ?? ""}
          />
        </div>
      </AdvancedSection>

      <AdvancedSection
        title="Proposer un nom conventionnel"
        description="Un nom au format plateforme-programme-langue-canal-mois."
      >
        <p className="text-note text-muted-foreground">{NAMING_HELP}</p>
        <NameGenerator channels={campaignChannels.length ? campaignChannels : channels} />
      </AdvancedSection>

      <Button type="submit" className="max-md:h-10">
        {submitLabel}
      </Button>
    </form>
  );
}
