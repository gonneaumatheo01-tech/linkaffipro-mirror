/**
 * Phase 29, chantier A : mots de recherche par langue (règle 5 : la veille cherche dans la langue locale). Une ligne
 * par langue européenne couverte ; les requêtes sont composées par `localQuery`.
 */
import { EUROPE_COUNTRIES, type Market } from "../contract";

export type LocalTerms = { casino: string; sports: string; dating: string; ads: string; forum: string; news: string; ban: string };

export const LOCAL_TERMS: Readonly<Record<string, LocalTerms>> = {
  fr: { casino: "casino en ligne", sports: "paris sportifs", dating: "site de rencontre", ads: "publicité", forum: "forum affiliation", news: "actualité", ban: "compte publicitaire banni" },
  en: { casino: "online casino", sports: "sports betting", dating: "dating app", ads: "advertising", forum: "affiliate forum", news: "news", ban: "ad account banned" },
  de: { casino: "Online-Casino", sports: "Sportwetten", dating: "Dating-App", ads: "Werbung", forum: "Affiliate Forum", news: "Nachrichten", ban: "Werbekonto gesperrt" },
  es: { casino: "casino online", sports: "apuestas deportivas", dating: "app de citas", ads: "publicidad", forum: "foro afiliados", news: "noticias", ban: "cuenta publicitaria bloqueada" },
  it: { casino: "casinò online", sports: "scommesse sportive", dating: "app di incontri", ads: "pubblicità", forum: "forum affiliazione", news: "notizie", ban: "account pubblicitario bloccato" },
  pt: { casino: "casino online", sports: "apostas desportivas", dating: "app de encontros", ads: "publicidade", forum: "fórum afiliados", news: "notícias", ban: "conta de anúncios banida" },
  nl: { casino: "online casino", sports: "sportweddenschappen", dating: "datingapp", ads: "reclame", forum: "affiliate forum", news: "nieuws", ban: "advertentieaccount geblokkeerd" },
  pl: { casino: "kasyno online", sports: "zakłady sportowe", dating: "aplikacja randkowa", ads: "reklama", forum: "forum afiliacyjne", news: "wiadomości", ban: "konto reklamowe zablokowane" },
  sv: { casino: "nätcasino", sports: "sportbetting", dating: "dejtingapp", ads: "reklam", forum: "affiliate forum", news: "nyheter", ban: "annonskonto avstängt" },
  no: { casino: "nettcasino", sports: "sportsbetting", dating: "datingapp", ads: "reklame", forum: "affiliate forum", news: "nyheter", ban: "annonsekonto stengt" },
  da: { casino: "online casino", sports: "sportsvæddemål", dating: "datingapp", ads: "reklame", forum: "affiliate forum", news: "nyheder", ban: "annoncekonto lukket" },
  fi: { casino: "nettikasino", sports: "urheiluvedonlyönti", dating: "deittisovellus", ads: "mainonta", forum: "affiliate foorumi", news: "uutiset", ban: "mainostili suljettu" },
  cs: { casino: "online kasino", sports: "sportovní sázky", dating: "seznamka", ads: "reklama", forum: "affiliate fórum", news: "zprávy", ban: "reklamní účet zablokován" },
  ro: { casino: "cazino online", sports: "pariuri sportive", dating: "aplicație de întâlniri", ads: "publicitate", forum: "forum afiliere", news: "știri", ban: "cont de reclame blocat" },
  el: { casino: "online καζίνο", sports: "αθλητικό στοίχημα", dating: "εφαρμογή γνωριμιών", ads: "διαφήμιση", forum: "φόρουμ affiliate", news: "ειδήσεις", ban: "αποκλεισμός διαφημιστικού λογαριασμού" },
  hu: { casino: "online kaszinó", sports: "sportfogadás", dating: "társkereső", ads: "hirdetés", forum: "affiliate fórum", news: "hírek", ban: "hirdetési fiók letiltva" },
  bg: { casino: "онлайн казино", sports: "спортни залози", dating: "приложение за запознанства", ads: "реклама", forum: "афилиейт форум", news: "новини", ban: "блокиран рекламен акаунт" },
  hr: { casino: "online kasino", sports: "sportsko klađenje", dating: "aplikacija za upoznavanje", ads: "oglašavanje", forum: "affiliate forum", news: "vijesti", ban: "blokiran oglasni račun" },
  sk: { casino: "online kasíno", sports: "športové stávky", dating: "zoznamka", ads: "reklama", forum: "affiliate fórum", news: "správy", ban: "reklamný účet zablokovaný" },
  sl: { casino: "spletna igralnica", sports: "športne stave", dating: "aplikacija za zmenke", ads: "oglaševanje", forum: "affiliate forum", news: "novice", ban: "blokiran oglaševalski račun" },
  et: { casino: "online kasiino", sports: "spordiennustus", dating: "tutvumisrakendus", ads: "reklaam", forum: "affiliate foorum", news: "uudised", ban: "reklaamikonto blokeeritud" },
  lv: { casino: "tiešsaistes kazino", sports: "sporta likmes", dating: "iepazīšanās lietotne", ads: "reklāma", forum: "affiliate forums", news: "ziņas", ban: "reklāmas konts bloķēts" },
  lt: { casino: "internetinis kazino", sports: "sporto lažybos", dating: "pažinčių programėlė", ads: "reklama", forum: "affiliate forumas", news: "naujienos", ban: "reklamos paskyra užblokuota" },
};

/** Langues de la veille (toutes celles des pays couverts, sans doublon). */
export const WATCH_LANGUAGES: readonly string[] = [...new Set(Object.values(EUROPE_COUNTRIES))];

export function termsOf(language: string | null | undefined): LocalTerms {
  return LOCAL_TERMS[(language ?? "en").toLowerCase()] ?? LOCAL_TERMS.en!;
}

export function marketTerm(market: Market, language: string | null | undefined): string {
  const t = termsOf(language);
  return market === "CASINO" ? t.casino : market === "SPORTS" ? t.sports : t.dating;
}

/** Requête dans la langue locale : « <marché> <publicité> <genre> » (genre : actualité, forum, bannissement). */
export function localQuery(market: Market, language: string | null | undefined, kind: "news" | "forum" | "ban" | "ads"): string {
  const t = termsOf(language);
  const tail = kind === "news" ? t.news : kind === "forum" ? t.forum : kind === "ban" ? t.ban : "";
  return [marketTerm(market, language), t.ads, tail].filter(Boolean).join(" ");
}

/** Langue locale d'un pays (ISO alpha-2), anglais par défaut. */
export function languageOfCountry(country: string | null | undefined): string {
  return EUROPE_COUNTRIES[(country ?? "").toUpperCase()] ?? "en";
}
