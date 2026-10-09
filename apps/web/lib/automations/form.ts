import {
  MAX_ACTIONS,
  parseActions,
  parseConditions,
  type AutomationAction,
  type AutomationConditions,
} from "@linkaffipro/core";

/** Lit les conditions depuis un formulaire (cases à cocher et champs). */
export function conditionsFromForm(fd: FormData): AutomationConditions {
  const langs = String(fd.get("languages") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parseConditions({
    channelIds: fd.getAll("channelIds").map(String),
    campaignIds: fd.getAll("campaignIds").map(String),
    categoryIds: fd.getAll("categoryIds").map(String),
    spendLevels: fd.getAll("spendLevels").map(String),
    languages: langs,
    inactiveDays: String(fd.get("inactiveDays") ?? "").trim() || undefined,
  });
}

/** Lit jusqu'à MAX_ACTIONS actions (lignes `a<i>_*`) depuis un formulaire. */
export function actionsFromForm(fd: FormData): AutomationAction[] {
  const raw: unknown[] = [];
  for (let i = 0; i < MAX_ACTIONS; i++) {
    const type = String(fd.get(`a${i}_type`) ?? "");
    if (!type) continue;
    const text = String(fd.get(`a${i}_text`) ?? "");
    const buttonsRaw = String(fd.get(`a${i}_buttons`) ?? "");
    const buttons = buttonsRaw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [label, url] = l.split("|").map((x) => x.trim());
        return [{ text: label ?? "", url: url ?? "" }];
      });
    raw.push({
      type,
      text,
      buttons: buttons.length ? buttons : undefined,
      mediaAssetId: String(fd.get(`a${i}_mediaAssetId`) ?? "") || null,
      botId: String(fd.get(`a${i}_botId`) ?? "") || null,
      trigger: String(fd.get(`a${i}_trigger`) ?? ""),
      hours: String(fd.get(`a${i}_hours`) ?? ""),
      tag: String(fd.get(`a${i}_tag`) ?? ""),
      channelId: String(fd.get(`a${i}_channelId`) ?? ""),
    });
  }
  if (raw.length === 0) throw new Error("Ajoutez au moins une action dans « Alors… ».");
  return parseActions(raw);
}
