/** Langues proposées pour les textes du bot (fr obligatoire). */
export const SEQUENCE_LANGS = ["fr", "en", "es", "pt", "de", "it", "ar", "tr", "nl", "pl", "ro", "ru"] as const;
export type SequenceLang = (typeof SEQUENCE_LANGS)[number];
