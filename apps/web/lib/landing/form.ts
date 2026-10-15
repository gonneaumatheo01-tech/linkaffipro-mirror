import {
  DEFAULT_LANDING_LANG,
  DEFAULT_LANDING_SOURCE,
  LANDING_LANGS,
  LANDING_TEXT_LIMITS,
  isLandingLang,
  isReservedLandingSegment,
  isValidLandingSlug,
  landingDefaults,
  landingLang,
  landingPublicUrl,
  normalizeMetaPixelId,
  normalizeSourceKey,
  normalizeTikTokPixelId,
  slugifyLanding,
  type LandingLang,
  type LandingRenderInput,
} from "@linkaffipro/core";

/**
 * Formulaire de la rubrique « Pages » (phase 15) : un seul formulaire pour créer ou modifier une page d'atterrissage
 * (canal, accroche, sous-texte, texte du bouton, sources ; le reste dans « Avancé »). Règles pures, partagées par le
 * formulaire (navigateur : aperçu en direct, contrôles à la frappe) et l'action serveur (validation complète), testées
 * dans form.test.ts. Contrat : docs/PAGES-ATTERRISSAGE.md.
 *
 * Mots affichés : « adresse de la page » (jamais le mot technique), « identifiant du pixel », « source » (« tk01 »),
 * « lien principal » pour la source par défaut (visite sans source ou avec une source inconnue).
 */

/** Nombre maximal de sources d'une page (source par défaut comprise). */
export const MAX_LANDING_SOURCES = 20;
/** Longueur maximale du nom de la page (pour l'équipe ; il nomme aussi les liens Telegram, coupés à 32 caractères). */
export const LANDING_NAME_MAX = 60;

/** Libellés des langues d'une page (dans leur langue, comme le sélecteur de langue des textes du bot). */
export const LANDING_LANG_LABELS: Record<LandingLang, string> = {
  fr: "Français",
  en: "English",
  es: "Español",
  pt: "Português",
  de: "Deutsch",
  it: "Italiano",
};

/** Une source dans le formulaire. */
export type LandingFormSource = {
  /** Source enregistrée (`LandingSource.id`) ; null : ajoutée dans le formulaire, pas encore enregistrée. */
  id: string | null;
  /** Clé (« tk01 ») ; "" = lien principal (source par défaut). */
  key: string;
  /** Pub reliée (facultatif) : sa dépense donne le coût par join. */
  adId: string | null;
  /** Retirée dans le formulaire (son lien sera révoqué à l'enregistrement). */
  removed: boolean;
  /** Lien principal (source par défaut, clé "") : toujours là, jamais retiré, sans nom à saisir. */
  main: boolean;
};

/** État complet du formulaire (envoyé tel quel à l'action serveur, en JSON). */
export type LandingFormState = {
  /** Page modifiée ; null : nouvelle page. */
  pageId: string | null;
  channelId: string;
  headline: string;
  subtext: string;
  buttonText: string;
  footnote: string;
  language: LandingLang;
  /** Saisies brutes des pixels (identifiant seul ou code complet collé). */
  tiktokPixel: string;
  metaPixel: string;
  cookieBanner: boolean;
  showPhoto: boolean;
  /** Nom de la page (pour l'équipe) ; vide : proposé d'après le canal. */
  name: string;
  /** Adresse de la page (`/j/<adresse>`) ; vide : proposée d'après le nom. */
  slug: string;
  /** Adresse saisie à la main (sinon elle suit le nom, pour une nouvelle page). */
  slugTouched: boolean;
  isActive: boolean;
  sources: LandingFormSource[];
};

/** Page enregistrée, relue pour remplir le formulaire. */
export type SavedLandingPage = {
  id: string;
  channelId: string;
  name: string;
  slug: string;
  language: string;
  headline: string;
  subtext: string | null;
  buttonText: string | null;
  footnote: string | null;
  showPhoto: boolean;
  cookieBanner: boolean;
  tiktokPixelId: string | null;
  metaPixelId: string | null;
  isActive: boolean;
  sources: ReadonlyArray<{ id: string; key: string; adId: string | null; isActive: boolean }>;
};

/** Ordre d'affichage des sources : le lien principal d'abord, puis par ordre d'ajout (l'ordre reçu). */
export function sortFormSources<S extends { key: string }>(sources: readonly S[]): S[] {
  return [
    ...sources.filter((s) => s.key === DEFAULT_LANDING_SOURCE),
    ...sources.filter((s) => s.key !== DEFAULT_LANDING_SOURCE),
  ];
}

/** Formulaire d'une nouvelle page : lien principal seul, français, rien dans « Avancé ». */
export function emptyLandingForm(channelId = ""): LandingFormState {
  return {
    pageId: null,
    channelId,
    headline: "",
    subtext: "",
    buttonText: "",
    footnote: "",
    language: DEFAULT_LANDING_LANG,
    tiktokPixel: "",
    metaPixel: "",
    cookieBanner: false,
    showPhoto: false,
    name: "",
    slug: "",
    slugTouched: false,
    isActive: true,
    sources: [mainSource()],
  };
}

/** Ligne du lien principal (source par défaut). */
export function mainSource(
  id: string | null = null,
  adId: string | null = null,
): LandingFormSource {
  return { id, key: DEFAULT_LANDING_SOURCE, adId, removed: false, main: true };
}

/** Nouvelle ligne de source (nom à saisir). */
export function newSource(): LandingFormSource {
  return { id: null, key: "", adId: null, removed: false, main: false };
}

/** Formulaire d'une page enregistrée (sources retirées absentes : elles se rajoutent avec le même nom). */
export function formFromPage(page: SavedLandingPage): LandingFormState {
  const sources = sortFormSources(
    page.sources
      .filter((s) => s.isActive)
      .map((s) =>
        s.key === DEFAULT_LANDING_SOURCE
          ? mainSource(s.id, s.adId)
          : { id: s.id, key: s.key, adId: s.adId, removed: false, main: false },
      ),
  );
  if (!sources.some((s) => s.main)) sources.unshift(mainSource());
  return {
    pageId: page.id,
    channelId: page.channelId,
    headline: page.headline,
    subtext: page.subtext ?? "",
    buttonText: page.buttonText ?? "",
    footnote: page.footnote ?? "",
    language: landingLang(page.language),
    tiktokPixel: page.tiktokPixelId ?? "",
    metaPixel: page.metaPixelId ?? "",
    cookieBanner: page.cookieBanner,
    showPhoto: page.showPhoto,
    name: page.name,
    slug: page.slug,
    slugTouched: true,
    isActive: page.isActive,
    sources,
  };
}

// ─── Contrôles à la frappe ───────────────────────────────────────────────────────────────────────────────────────

export type PixelCheck =
  { state: "empty" } | { state: "ok"; id: string } | { state: "invalid"; message: string };

/** Pixel saisi : vide (pas de pixel), reconnu (identifiant retrouvé, même dans un code complet collé), ou refusé. */
export function checkPixel(kind: "tiktok" | "meta", raw: string): PixelCheck {
  if (!raw.trim()) return { state: "empty" };
  const id = kind === "tiktok" ? normalizeTikTokPixelId(raw) : normalizeMetaPixelId(raw);
  if (id) return { state: "ok", id };
  return {
    state: "invalid",
    message:
      kind === "tiktok"
        ? "Identifiant du pixel TikTok non reconnu : 20 lettres majuscules et chiffres, par exemple CD2UC93C77U35BVUO310 (Gestionnaire d'événements TikTok)."
        : "Identifiant du pixel Meta non reconnu : uniquement des chiffres (15 ou 16 en général), par exemple 1070571443971391 (Gestionnaire d'événements Meta).",
  };
}

/** Phrase sous le champ d'un pixel reconnu : « Pixel reconnu : CD2UC93C77U35BVUO310. » */
export function pixelOkText(check: PixelCheck): string | null {
  return check.state === "ok" ? `Pixel reconnu : ${check.id}.` : null;
}

/**
 * Problème du nom d'une source (null : bon nom). `others` : clés des autres sources de la page (en minuscules).
 * Le lien principal n'a pas de nom (il sert quand la visite n'a pas de source).
 */
export function sourceKeyProblem(raw: string, others: readonly string[]): string | null {
  if (!raw.trim()) return "Donnez un nom à la source (par exemple tk01).";
  const key = normalizeSourceKey(raw);
  if (!key)
    return "Nom de source : lettres sans accents, chiffres, tirets ou soulignés, 32 caractères au plus (par exemple tk01).";
  if (others.includes(key)) return `La source « ${key} » existe déjà sur cette page.`;
  return null;
}

/** Problème de l'adresse de la page (null : bonne adresse). L'unicité est contrôlée par le serveur. */
export function slugProblem(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (isReservedLandingSegment(s) || !isValidLandingSlug(s))
    return "Adresse de la page : 3 à 48 caractères, minuscules sans accents, chiffres et tirets (pas au début ni à la fin).";
  return null;
}

/** Nom proposé pour une nouvelle page : le titre du canal (coupé), suivi de « 2 », « 3 »… s'il est déjà pris. */
export function suggestedPageName(
  channelTitle: string,
  takenNames: readonly string[] = [],
): string {
  const base =
    (channelTitle ?? "").replace(/\s+/g, " ").trim().slice(0, LANDING_NAME_MAX).trim() || "Page";
  const taken = new Set(takenNames.map((n) => n.trim().toLocaleLowerCase("fr")));
  if (!taken.has(base.toLocaleLowerCase("fr"))) return base;
  for (let i = 2; i < 100; i++) {
    const suffix = ` ${i}`;
    const name = `${base.slice(0, LANDING_NAME_MAX - suffix.length).trim()}${suffix}`;
    if (!taken.has(name.toLocaleLowerCase("fr"))) return name;
  }
  return base;
}

/** Nom effectif de la page (saisi, sinon proposé d'après le canal). */
export function effectiveName(
  state: Pick<LandingFormState, "name">,
  channelTitle: string,
  takenNames: readonly string[] = [],
): string {
  return state.name.trim() || suggestedPageName(channelTitle, takenNames);
}

/** Adresse effective proposée : saisie, sinon d'après le nom. */
export function effectiveSlug(
  state: Pick<LandingFormState, "slug" | "name">,
  channelTitle: string,
  takenNames: readonly string[] = [],
): string {
  return state.slug.trim() || slugifyLanding(effectiveName(state, channelTitle, takenNames));
}

/**
 * L'adresse d'une page enregistrée va-t-elle changer (avertissement « les liens déjà collés ne marcheront plus ») ?
 * Seulement pour une adresse saisie et différente : une adresse vidée garde l'adresse enregistrée (le serveur la garde).
 */
export function slugWillChange(slug: string, saved: { slug: string } | null): boolean {
  const s = slug.trim().toLowerCase();
  return !!saved && s !== "" && s !== saved.slug;
}

/**
 * Exemple affiché dans le champ « Adresse de la page » : l'adresse enregistrée d'une page existante (gardée si le
 * champ est vidé), sinon l'adresse proposée d'après le nom (ou le nom proposé, sans doublon).
 */
export function slugPlaceholder(
  state: Pick<LandingFormState, "slug" | "name">,
  saved: { slug: string } | null,
  channelTitle: string,
  takenNames: readonly string[] = [],
): string {
  if (saved) return saved.slug;
  return slugifyLanding(effectiveName({ name: state.name }, channelTitle, takenNames));
}

/** Nombre de réglages d'« Avancé » qui s'écartent des valeurs par défaut (compteur du bloc replié). */
export function advancedModifiedCount(
  state: LandingFormState,
  saved?: Pick<LandingFormState, "name" | "slug"> | null,
): number {
  let n = 0;
  if (state.language !== DEFAULT_LANDING_LANG) n++;
  if (state.tiktokPixel.trim()) n++;
  if (state.metaPixel.trim()) n++;
  if (state.cookieBanner) n++;
  if (state.showPhoto) n++;
  if (state.footnote.trim()) n++;
  if (!state.isActive) n++;
  if (saved) {
    // Un nom ou une adresse vidés gardent ceux de la page : ce n'est pas une modification.
    if (state.name.trim() && state.name.trim() !== saved.name.trim()) n++;
    if (slugWillChange(state.slug, saved)) n++;
  } else {
    if (state.name.trim()) n++;
    if (state.slugTouched && state.slug.trim()) n++;
  }
  return n;
}

// ─── Pub reliée à une source ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Campagnes proposées pour « Relier à une pub » : celles du canal de la page d'abord, puis celles de son univers, puis
 * les autres (l'ordre reçu est gardé dans chaque groupe : campagnes en cours d'abord, puis par nom).
 */
export function orderAdGroups<G extends { channelIds: readonly string[]; vertical: string | null }>(
  groups: readonly G[],
  channelId: string,
  vertical: string | null,
): G[] {
  const rank = (g: G) =>
    channelId && g.channelIds.includes(channelId) ? 0 : vertical && g.vertical === vertical ? 1 : 2;
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    .map((x) => x.g);
}

/**
 * La pub est-elle déjà reliée ailleurs : à une source active d'une autre page (`usedBy`, lu en base), ou à une autre
 * source de ce formulaire (non retirée) ? Sa dépense est alors partagée (jamais comptée deux fois), mais le choix est
 * sans doute une erreur : l'option le signale.
 */
export function adUsedElsewhere(
  ad: { id: string; usedBy: ReadonlyArray<{ pageId: string }> },
  state: Pick<LandingFormState, "pageId" | "sources">,
  sourceIndex: number,
): boolean {
  if (ad.usedBy.some((u) => u.pageId !== state.pageId)) return true;
  return state.sources.some((s, j) => j !== sourceIndex && !s.removed && s.adId === ad.id);
}

/** Exceptions « venu d'une pub » (phase 11) : elles ne visent jamais une personne venue d'une page. */
const AD_SOURCE_KINDS = new Set(["AD_ANY", "AD_TIKTOK", "AD_META"]);

/**
 * Le canal a-t-il une exception « pub » active sans exception pour les pages (« n'importe quelle page
 * d'atterrissage », ou cette page) ? Une personne venue de la page tomberait alors sur la règle par défaut, pas sur
 * celle de la pub : le formulaire le signale, avec un lien vers « Qui peut entrer et quand ».
 */
export function missingLandingException(
  rules: ReadonlyArray<{
    scope: string;
    sourceKind: string | null;
    landingPageId: string | null;
    isActive: boolean;
  }>,
  pageId: string | null,
): boolean {
  const active = rules.filter((r) => r.isActive && r.scope === "SOURCE_KIND");
  if (!active.some((r) => r.sourceKind && AD_SOURCE_KINDS.has(r.sourceKind))) return false;
  return !active.some(
    (r) =>
      r.sourceKind === "LANDING_ANY" ||
      (r.sourceKind === "LANDING_PAGE" && !!pageId && r.landingPageId === pageId),
  );
}

// ─── Aperçu en direct ────────────────────────────────────────────────────────────────────────────────────────────

/** Lien du bouton dans l'aperçu (aucun clic ne part : l'aperçu n'a ni script ni lien actif). */
export const PREVIEW_INVITE_LINK = "https://t.me/+apercu";

/**
 * Entrée du rendu pour l'aperçu téléphone : le même rendu que la page publique (`renderLandingHtml`), en mode
 * aperçu (aucun script, aucun envoi, aucun pixel), avec le vrai titre du canal.
 */
export function previewInput(
  state: LandingFormState,
  ctx: { channelTitle: string; photoUrl: string | null },
): LandingRenderInput {
  const tiktok = checkPixel("tiktok", state.tiktokPixel);
  const meta = checkPixel("meta", state.metaPixel);
  return {
    pageId: state.pageId ?? "apercu",
    lang: state.language,
    channelTitle: ctx.channelTitle,
    headline: state.headline.trim() || "Votre phrase d'accroche",
    subtext: state.subtext,
    buttonText: state.buttonText,
    footnote: state.footnote,
    photoUrl: state.showPhoto ? ctx.photoUrl : null,
    inviteLink: PREVIEW_INVITE_LINK,
    sourceKey: DEFAULT_LANDING_SOURCE,
    tiktokPixelId: tiktok.state === "ok" ? tiktok.id : null,
    metaPixelId: meta.state === "ok" ? meta.id : null,
    cookieBanner: state.cookieBanner,
    preview: true,
  };
}

/** Photo du canal pour l'aperçu, servie à l'équipe connectée (`app/(admin)/pages/photo/[channelId]`). */
export function landingPhotoPreviewUrl(channelId: string): string {
  return `/pages/photo/${encodeURIComponent(channelId)}`;
}

/**
 * Aperçu d'une page enregistrée (« Voir la page » de sa fiche) : la page telle qu'elle est en ligne, avec le vrai
 * titre et la photo du canal, mais en mode aperçu (aucun script, aucun envoi, aucun pixel, bouton sans vrai lien).
 * La fiche ne mène jamais à la vraie page publique : l'équipe y serait comptée comme une vraie visite et les pixels
 * enverraient leurs événements aux régies.
 */
export function savedPagePreviewInput(
  page: SavedLandingPage,
  channel: { id: string; title: string; hasPhoto: boolean },
): LandingRenderInput {
  return previewInput(formFromPage(page), {
    channelTitle: channel.title,
    photoUrl: channel.hasPhoto ? landingPhotoPreviewUrl(channel.id) : null,
  });
}

/** Adresse publique à coller dans la pub pour une source (lien principal : sans source). */
export function sourcePublicUrl(baseUrl: string, slug: string, key: string): string {
  return landingPublicUrl(baseUrl, slug, key);
}

/** Adresse sans « https:// », pour l'affichage (« go.goolink.eu/j/promo?src=tk01 »). */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

// ─── Validation complète (action serveur) ────────────────────────────────────────────────────────────────────────

/** Page validée, prête à enregistrer. */
export type CleanLandingPage = {
  channelId: string;
  name: string;
  /** Adresse demandée ; null : à proposer d'après le nom (première adresse libre). */
  slug: string | null;
  language: LandingLang;
  headline: string;
  subtext: string | null;
  buttonText: string | null;
  footnote: string | null;
  tiktokPixelId: string | null;
  metaPixelId: string | null;
  cookieBanner: boolean;
  showPhoto: boolean;
  isActive: boolean;
  /** Sources gardées (le lien principal "" toujours en tête), sans les sources retirées. */
  sources: Array<{ key: string; adId: string | null }>;
};

/** Champs du formulaire qui peuvent porter une erreur. */
export type LandingField =
  | "channelId"
  | "headline"
  | "subtext"
  | "buttonText"
  | "footnote"
  | "tiktokPixel"
  | "metaPixel"
  | "name"
  | "slug"
  | "sources";

export type LandingFormErrors = Partial<Record<LandingField, string>> & {
  /** Erreur par source (index dans `state.sources`). */
  sourceErrors?: Record<number, string>;
};

export type LandingValidation =
  { ok: true; value: CleanLandingPage } | { ok: false; errors: LandingFormErrors; message: string };

function cleanText(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

function tooLong(text: string, max: number): boolean {
  return [...text].length > max;
}

/**
 * Validation complète d'un formulaire reçu (JSON du navigateur : tout est relu, rien n'est cru). `adIds` : pubs
 * existantes de nos campagnes ; `channelIds` : canaux proposés. Nom vide : celui de la page existante
 * (`existingName`), sinon le nom proposé par le formulaire (titre du canal, sans doublon avec `takenNames`). Renvoie
 * la page nettoyée, ou les erreurs par champ et le premier message (affiché en tête).
 */
export function validateLandingForm(
  raw: unknown,
  ctx: {
    channelIds: ReadonlySet<string>;
    adIds: ReadonlySet<string>;
    channelTitle?: string;
    /** Nom de la page modifiée (gardé si le champ est vidé). */
    existingName?: string | null;
    /** Noms des autres pages (nom proposé sans doublon, comme dans le formulaire). */
    takenNames?: readonly string[];
  },
): LandingValidation {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: LandingFormErrors = {};
  const channelId = typeof r.channelId === "string" ? r.channelId : "";
  if (!channelId || !ctx.channelIds.has(channelId)) errors.channelId = "Choisissez le canal.";

  const headline = cleanText(r.headline);
  if (!headline) errors.headline = "Écrivez la phrase d'accroche.";
  else if (tooLong(headline, LANDING_TEXT_LIMITS.headline))
    errors.headline = `Phrase d'accroche : ${LANDING_TEXT_LIMITS.headline} caractères au plus.`;
  const subtext = cleanText(r.subtext);
  if (tooLong(subtext, LANDING_TEXT_LIMITS.subtext))
    errors.subtext = `Sous-texte : ${LANDING_TEXT_LIMITS.subtext} caractères au plus.`;
  const buttonText = cleanText(r.buttonText);
  if (tooLong(buttonText, LANDING_TEXT_LIMITS.buttonText))
    errors.buttonText = `Texte du bouton : ${LANDING_TEXT_LIMITS.buttonText} caractères au plus.`;
  const footnote = cleanText(r.footnote);
  if (tooLong(footnote, LANDING_TEXT_LIMITS.footnote))
    errors.footnote = `Petite ligne : ${LANDING_TEXT_LIMITS.footnote} caractères au plus.`;

  const language = isLandingLang(r.language) ? r.language : DEFAULT_LANDING_LANG;
  const tiktok = checkPixel("tiktok", typeof r.tiktokPixel === "string" ? r.tiktokPixel : "");
  if (tiktok.state === "invalid") errors.tiktokPixel = tiktok.message;
  const meta = checkPixel("meta", typeof r.metaPixel === "string" ? r.metaPixel : "");
  if (meta.state === "invalid") errors.metaPixel = meta.message;

  const name =
    cleanText(r.name) ||
    ctx.existingName?.trim() ||
    suggestedPageName(ctx.channelTitle ?? "", ctx.takenNames ?? []);
  if (tooLong(name, LANDING_NAME_MAX))
    errors.name = `Nom de la page : ${LANDING_NAME_MAX} caractères au plus.`;
  const slugRaw = typeof r.slug === "string" ? r.slug.trim().toLowerCase() : "";
  const slugError = slugProblem(slugRaw);
  if (slugError) errors.slug = slugError;

  const sourcesRaw = Array.isArray(r.sources) ? r.sources : [];
  const sources: Array<{ key: string; adId: string | null }> = [];
  const sourceErrors: Record<number, string> = {};
  const seen: string[] = [];
  sourcesRaw.forEach((s0, i) => {
    const s = (s0 && typeof s0 === "object" ? s0 : {}) as Record<string, unknown>;
    const isDefault = s.main === true;
    if (s.removed === true && !isDefault) return;
    const rawKey = typeof s.key === "string" ? s.key : "";
    const key = isDefault ? DEFAULT_LANDING_SOURCE : normalizeSourceKey(rawKey);
    if (!isDefault) {
      const problem = sourceKeyProblem(rawKey, seen);
      if (problem) {
        sourceErrors[i] = problem;
        return;
      }
    } else if (seen.includes(DEFAULT_LANDING_SOURCE)) return;
    const adId = typeof s.adId === "string" && s.adId ? s.adId : null;
    if (adId && !ctx.adIds.has(adId)) {
      sourceErrors[i] = "Cette pub n'existe plus : choisissez-en une autre, ou « Aucune pub ».";
      return;
    }
    seen.push(key!);
    sources.push({ key: key!, adId });
  });
  if (!sources.some((s) => s.key === DEFAULT_LANDING_SOURCE))
    sources.unshift({ key: DEFAULT_LANDING_SOURCE, adId: null });
  if (sources.length > MAX_LANDING_SOURCES)
    errors.sources = `${MAX_LANDING_SOURCES} sources au plus par page (lien principal compris).`;
  if (Object.keys(sourceErrors).length > 0) errors.sourceErrors = sourceErrors;

  const firstSource = Object.values(sourceErrors)[0];
  const message =
    errors.channelId ??
    errors.headline ??
    errors.subtext ??
    errors.buttonText ??
    errors.footnote ??
    errors.tiktokPixel ??
    errors.metaPixel ??
    errors.name ??
    errors.slug ??
    errors.sources ??
    firstSource;
  if (message) return { ok: false, errors, message };
  return {
    ok: true,
    value: {
      channelId,
      name,
      slug: slugRaw || null,
      language,
      headline,
      subtext: subtext || null,
      buttonText: buttonText || null,
      footnote: footnote || null,
      tiktokPixelId: tiktok.state === "ok" ? tiktok.id : null,
      metaPixelId: meta.state === "ok" ? meta.id : null,
      cookieBanner: r.cookieBanner === true,
      showPhoto: r.showPhoto === true,
      isActive: r.isActive !== false,
      sources: sortFormSources(sources),
    },
  };
}

// ─── Sources à écrire ────────────────────────────────────────────────────────────────────────────────────────────

/** Source déjà en base (active ou retirée). */
export type ExistingSource = { id: string; key: string; adId: string | null; isActive: boolean };

/** Ce qu'il faut écrire pour passer des sources en base aux sources voulues. */
export type SourcePlan = {
  create: Array<{ key: string; adId: string | null }>;
  /** Source retirée remise en service (même nom : ses anciens chiffres la retrouvent). */
  reactivate: Array<{ id: string; key: string; adId: string | null }>;
  /** Pub reliée changée sur une source active. */
  updateAd: Array<{ id: string; key: string; adId: string | null }>;
  /** Sources retirées (liens révoqués ensuite) : jamais supprimées, leurs chiffres restent. */
  deactivate: Array<{ id: string; key: string }>;
  /** Une pub a changé (reliée, changée, retirée, ou une source reliée retirée) : recalcul des statistiques. */
  adsChanged: boolean;
};

/** Plan d'écriture des sources (pure). Le lien principal n'est jamais retiré. */
export function planSourceChanges(
  existing: readonly ExistingSource[],
  wanted: ReadonlyArray<{ key: string; adId: string | null }>,
): SourcePlan {
  const plan: SourcePlan = {
    create: [],
    reactivate: [],
    updateAd: [],
    deactivate: [],
    adsChanged: false,
  };
  const byKey = new Map(existing.map((s) => [s.key, s]));
  const wantedKeys = new Set(wanted.map((w) => w.key));
  for (const w of wanted) {
    const e = byKey.get(w.key);
    if (!e) {
      plan.create.push({ key: w.key, adId: w.adId });
      if (w.adId) plan.adsChanged = true;
    } else if (!e.isActive) {
      plan.reactivate.push({ id: e.id, key: w.key, adId: w.adId });
      if (w.adId || e.adId) plan.adsChanged = true;
    } else if ((e.adId ?? null) !== (w.adId ?? null)) {
      plan.updateAd.push({ id: e.id, key: w.key, adId: w.adId });
      plan.adsChanged = true;
    }
  }
  for (const e of existing)
    if (e.isActive && !wantedKeys.has(e.key) && e.key !== DEFAULT_LANDING_SOURCE) {
      plan.deactivate.push({ id: e.id, key: e.key });
      if (e.adId) plan.adsChanged = true;
    }
  return plan;
}

/** Textes et réglages affichés d'une page (ce qui change le HTML servi). */
export type LandingContentFields = {
  language: string;
  headline: string;
  subtext: string | null;
  buttonText: string | null;
  footnote: string | null;
  tiktokPixelId: string | null;
  metaPixelId: string | null;
  cookieBanner: boolean;
  showPhoto: boolean;
  isActive: boolean;
  slug: string;
  name: string;
};

const CONTENT_KEYS: ReadonlyArray<keyof LandingContentFields> = [
  "language",
  "headline",
  "subtext",
  "buttonText",
  "footnote",
  "tiktokPixelId",
  "metaPixelId",
  "cookieBanner",
  "showPhoto",
  "isActive",
  "slug",
  "name",
];

/** Les textes ou réglages affichés de la page changent-ils (nouvelle version du HTML en mémoire) ? */
export function pageContentChanged(
  before: LandingContentFields,
  after: LandingContentFields,
): boolean {
  return CONTENT_KEYS.some((k) => (before[k] ?? null) !== (after[k] ?? null));
}

/** Textes par défaut affichés en exemple dans les champs (langue de la page). */
export function formPlaceholders(lang: LandingLang): { buttonText: string; footnote: string } {
  const d = landingDefaults(lang);
  return { buttonText: d.buttonText, footnote: d.footnoteExample };
}

/** Langues proposées, dans l'ordre (français d'abord). */
export const LANDING_LANG_OPTIONS = LANDING_LANGS.map((value) => ({
  value,
  label: LANDING_LANG_LABELS[value],
}));
