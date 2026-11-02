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
  /\bj\s?t.?\s*(envoie?|mets?|file)\s+(le\s+)?lien/,
  /tiens\s+(le\s+)?lien/,
  /voil[aà]\s+(le\s+)?lien/,
  /(le|ton)\s+lien\s+(juste\s+)?(en\s+dessous|ci.?dessous|arrive)/,
];

function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function announcesLink(texts: readonly string[]): boolean {
  const joined = fold(texts.join(" "));
  return LINK_ANNOUNCE.some((re) => re.test(joined));
}

/**
 * Retire l'annonce du lien (« attends je t'envoie le lien ») quand il ne part pas à ce tour : une annonce sans envoi
 * est impossible. Les messages vidés sont retirés ; rend [] si plus rien ne reste.
 */
export function stripLinkAnnouncement(texts: readonly string[]): string[] {
  return texts
    .map((text) => {
      let out = text;
      for (const re of LINK_ANNOUNCE) {
        const m = re.exec(fold(out));
        if (!m) continue;
        // Même position dans le texte d'origine (le pliage garde la longueur), « attends » juste avant compris.
        const before = out.slice(0, m.index).replace(/(\battends?\s*,?\s*)$/i, "");
        out = `${before}${out.slice(m.index + m[0].length)}`;
      }
      return out
        .replace(/\s{2,}/g, " ")
        .replace(/^[\s,;:.]+|[\s,;:]+$/g, "")
        .trim();
    })
    .filter((t) => /[\p{L}\p{N}]/u.test(t));
}

/** Phrase qui dit ce qu'est l'app (« c'est une appli pour parler », « c'est un site de rencontre »). */
const APP_DESCRIPTION = [
  /\bc\s*.?\s*est\s+(une?\s+)?(appli|app|application|site|plateforme)\b/,
  /\b(appli|app|application)\s+(pour|de)\s+(parler|discuter|tchatter|chatter|se\s+parler|rencontres?)\b/,
];

/**
 * Série de photos : retire, au tour du lien, les morceaux de phrase qui disent ce qu'est l'app (consigne du client : le
 * lien répond pour elle). Les messages vidés sont retirés ; rend [] si plus rien ne reste.
 */
export function stripAppDescription(texts: readonly string[]): string[] {
  return texts
    .map((text) =>
      text
        .split(/(?<=[,;.!?…])\s+/)
        .filter((part) => !APP_DESCRIPTION.some((re) => re.test(fold(part))))
        .join(" ")
        .replace(/^[\s,;:.]+|[\s,;:]+$/g, "")
        .trim(),
    )
    .filter((t) => /[\p{L}\p{N}]/u.test(t));
}

/** Clé interne dans les faits : le lien est armé et partira au prochain tour. */
export const ARMED_LINK_FACT = "__lien_arme";
