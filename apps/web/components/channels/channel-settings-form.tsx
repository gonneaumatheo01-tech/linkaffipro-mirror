import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { channelLanguageOptions } from "@/lib/channels/bot-messages";
import { UNIVERSES, UNIVERSE_LABELS } from "@/lib/universe";

export type ChannelSettingsValues = {
  id: string;
  title: string;
  vertical: string | null;
  language: string;
  primaryBotId: string | null;
  isActive: boolean;
  isTest: boolean;
  isMediaLibrary: boolean;
};

/** Bot proposable comme bot principal ; `mode` absent = bot normal (listes déjà filtrées par la page). */
export type PrimaryBotOption = { id: string; username: string; mode?: string };

/**
 * Bots proposés comme « Bot principal » : jamais un bot en mode assistant de conversation (phase 17 : il n'accepte pas
 * les demandes et n'écrit qu'aux personnes qui lui parlent). Le serveur le refuse aussi (`updateChannelAction`).
 */
export function primaryBotChoices<T extends PrimaryBotOption>(bots: readonly T[]): T[] {
  return bots.filter((b) => b.mode === undefined || b.mode === "STANDARD");
}

/** Case à cocher d'un réglage : libellé et une ligne d'aide, zone cliquable de 40 px. */
function SettingCheck({
  name,
  defaultChecked,
  title,
  note,
}: {
  name: string;
  defaultChecked: boolean;
  title: string;
  note: string;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-start gap-3 rounded-lg py-1">
      <Checkbox name={name} defaultChecked={defaultChecked} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-body font-medium text-foreground">{title}</span>
        <span className="block text-note text-muted-foreground">{note}</span>
      </span>
    </label>
  );
}

/**
 * Réglages d'un canal (ex-réglages en ligne du tableau) : univers, langue, bot principal, actif, test, médiathèque.
 * Envoie les mêmes champs qu'avant à `updateChannelAction` ; `returnTo` : la liste ou la fiche du canal.
 */
export function ChannelSettingsForm({
  channel,
  bots,
  action,
  returnTo,
}: {
  channel: ChannelSettingsValues;
  bots: PrimaryBotOption[];
  action: (formData: FormData) => Promise<void>;
  returnTo: string;
}) {
  const p = `settings-${channel.id}`;
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="channelId" value={channel.id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <FormSection
        title="Le canal"
        description="Son univers, sa langue et le bot qui accueille les membres."
      >
        <div className="space-y-2">
          <Label htmlFor={`${p}-vertical`}>Univers</Label>
          <NativeSelect
            id={`${p}-vertical`}
            name="vertical"
            defaultValue={channel.vertical ?? ""}
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
          <Label htmlFor={`${p}-language`}>Langue</Label>
          <NativeSelect
            id={`${p}-language`}
            name="language"
            defaultValue={channel.language.trim().toLowerCase()}
            required
            aria-describedby={`${p}-language-help`}
            wrapperClassName="w-full"
          >
            {channelLanguageOptions(channel.language).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          <p id={`${p}-language-help`} className="text-note text-muted-foreground">
            Le bot écrit dans cette langue si celle du membre n&apos;est pas traduite.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${p}-bot`}>Bot principal</Label>
          <NativeSelect
            id={`${p}-bot`}
            name="primaryBotId"
            defaultValue={channel.primaryBotId ?? ""}
            aria-describedby={`${p}-bot-help`}
            wrapperClassName="w-full"
          >
            <option value="">Aucun : le premier bot administrateur</option>
            {primaryBotChoices(bots).map((b) => (
              <option key={b.id} value={b.id}>
                @{b.username}
              </option>
            ))}
          </NativeSelect>
          <p id={`${p}-bot-help`} className="text-note text-muted-foreground">
            Le bot qui accepte les demandes et écrit en privé aux membres de ce canal.
          </p>
        </div>
      </FormSection>
      <FormSection title="Usage" description="Ce que la plateforme fait de ce canal.">
        <div className="space-y-1">
          <SettingCheck
            name="isActive"
            defaultChecked={channel.isActive}
            title="Canal actif"
            note="Décoché : le bot n'accepte plus les demandes et n'écrit plus aux membres de ce canal."
          />
          <SettingCheck
            name="isTest"
            defaultChecked={channel.isTest}
            title="Canal de test"
            note="Pour essayer les messages et les règles sans toucher aux vrais membres."
          />
          <SettingCheck
            name="isMediaLibrary"
            defaultChecked={channel.isMediaLibrary}
            title="Médiathèque"
            note="Canal privé où le bot range les photos et vidéos à réutiliser."
          />
        </div>
      </FormSection>
      <Button type="submit" className="max-md:h-10">
        Enregistrer les réglages
      </Button>
    </form>
  );
}
