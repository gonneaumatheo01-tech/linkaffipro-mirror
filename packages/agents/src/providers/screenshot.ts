/**
 * Capture d'écran chez un bookmaker (phase 23). Seules actions permises : se connecter, chercher, afficher, capturer
 * (jamais de mise, de dépôt ni de modification du compte : règle codée dans l'adaptateur).
 */
export type CaptureRequest = {
  bookmaker: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  marketLabel: string;
  selectionLabel: string;
  line: number | null;
  /** Cote attendue (décimale), comparée à la cote lue sur le site. */
  expectedOdds: number;
  /** Adresse directe du match si le fournisseur la donne. */
  eventUrl?: string | null;
};

export type CaptureErrorKind =
  | "login_failed"
  | "captcha"
  | "two_factor"
  | "geo_blocked"
  | "not_found"
  | "market_missing"
  | "timeout"
  | "forbidden_action"
  | "unknown";

export type CaptureResult =
  | { ok: true; png: Uint8Array; readOdds: number; pageUrl: string }
  | { ok: false; kind: CaptureErrorKind; message: string };

export type ScreenshotProvider = {
  name: string;
  capture(req: CaptureRequest): Promise<CaptureResult>;
  /** « Tester la connexion » : connexion + capture de la page d'accueil. */
  testConnection(bookmaker: string): Promise<CaptureResult>;
};
