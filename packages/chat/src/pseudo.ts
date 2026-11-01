// Détection du pseudo donné par la personne (inscrite sur le site).
// Le modèle note le pseudo dans memory_facts sous la forme « pseudo: <valeur> ».

const PSEUDO_PREFIX = /^pseudo\s*:\s*/i;

/** Extrait le pseudo des faits de la conversation, ou null. */
export function extractPseudo(facts: readonly string[]): string | null {
  for (const f of facts) {
    if (PSEUDO_PREFIX.test(f)) {
      const val = f.replace(PSEUDO_PREFIX, "").trim();
      if (val) return val;
    }
  }
  return null;
}

/** Vrai si les messages annoncent l'envoi du lien sans que le lien soit effectivement parti. */
const LINK_ANNOUNCE = [
  /je\s+t.?\s*envoie?\s+(le\s+)?lien/,
  /je\s+te?\s*met[s]?\s+(le\s+)?lien/,
  /je\s+te?\s*file\s+(le\s+)?lien/,
  /tiens\s+(le\s+)?lien/,
  /voil[aà]\s+(le\s+)?lien/,
];

export function announcesLink(texts: readonly string[]): boolean {
  const joined = texts.join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return LINK_ANNOUNCE.some((re) => re.test(joined));
}

/** Clé interne dans les faits : le lien est armé et partira au prochain tour. */
export const ARMED_LINK_FACT = "__lien_arme";
