/**
 * Page Agents → Kevin (`/agents/boss`, phase 26) : règles pures (formulaires du plafond et du prénom, jauge de la
 * dépense, libellés de l'équipe, export CSV des besoins non couverts). Dans le code, les identifiants restent `boss` ;
 * le client voit le prénom réglé (`Setting` `boss.name`, « Kevin » par défaut).
 */
import { csvDate, toCsv } from "@/lib/members/csv";

export const BOSS_PATH = "/agents/boss";
export const BOSS_NAME_KEY = "boss.name";
export const BOSS_BUDGET_KEY = "boss.budget";
export const BOSS_GROUP_KEY = "boss.groupChatId";
export const DEFAULT_BOSS_NAME = "Kevin";
/**
 * 30 € par mois par défaut depuis la phase 33 (planificateur des ordres) : même valeur que
 * `BOSS_ORDERS_DEFAULT_MONTHLY_CENTS` de `@linkaffipro/agents` (un test le vérifie ; pas d'import ici, module pur).
 */
export const DEFAULT_BOSS_BUDGET_CENTS = 3000;
/** Plafond saisissable : 0 à 500 € par mois. */
export const MAX_BOSS_BUDGET_EUROS = 500;
export const BOSS_TURNS_SHOWN = 50;

export type FormResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Prénom affiché (`Setting` `boss.name`, chaîne) ; vide ou illisible → « Kevin ». */
export function parseBossName(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : DEFAULT_BOSS_NAME;
}

/** Plafond mensuel (`Setting` `boss.budget` = `{ monthlyCents }`) ; absent ou illisible → 30 €. */
export function parseBossBudget(v: unknown): number {
  const c = (v as { monthlyCents?: unknown } | null | undefined)?.monthlyCents;
  return typeof c === "number" && Number.isFinite(c) && c >= 0 ? Math.round(c) : DEFAULT_BOSS_BUDGET_CENTS;
}

/** Champ « Plafond par mois (€) » → centimes. */
export function parseBossBudgetForm(fd: FormData): FormResult<number> {
  const raw = String(fd.get("euros") ?? "").trim().replace(/\s|€/g, "").replace(",", ".");
  if (!raw) return { ok: false, error: "Saisissez un montant en euros." };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Le plafond doit être un montant en euros, 0 ou plus." };
  if (n > MAX_BOSS_BUDGET_EUROS) return { ok: false, error: `Le plafond est de ${MAX_BOSS_BUDGET_EUROS} € par mois au plus.` };
  return { ok: true, data: Math.round(n * 100) };
}

/** Champ « Prénom » : 1 à 40 caractères, lettres, chiffres, espaces, tirets et apostrophes. */
export function parseBossNameForm(fd: FormData): FormResult<string> {
  const name = String(fd.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Saisissez un prénom." };
  if (name.length > 40) return { ok: false, error: "Le prénom fait 40 caractères au plus." };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u.test(name))
    return { ok: false, error: "Le prénom ne peut contenir que des lettres, des chiffres, des espaces, des tirets et des apostrophes." };
  return { ok: true, data: name };
}

/** Jauge de la dépense du mois : part utilisée (0 à 100) et ton. */
export function bossBudgetGauge(spentCents: number, capCents: number): { percent: number; tone: "success" | "warning" | "danger" } {
  if (capCents <= 0) return { percent: spentCents > 0 ? 100 : 0, tone: spentCents > 0 ? "danger" : "warning" };
  const percent = Math.min(100, Math.round((spentCents / capCents) * 100));
  return { percent, tone: spentCents >= capCents ? "danger" : percent >= 80 ? "warning" : "success" };
}

/** Lien Telegram du bot (« https://t.me/kevin_bot »), sans « @ ». */
export function telegramLink(username: string): string {
  return `https://t.me/${username.replace(/^@/, "")}`;
}

export const TEAM_MEMBER_ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrateur",
  MANAGER: "Responsable",
  MEMBER: "Membre",
};

const RESP_TEAMS: Record<string, string> = {
  dating: "Rencontres",
  casino: "Casino",
  sports: "Paris sportifs",
  algo: "Algorithme",
  ads: "Pubs",
};
const RESP_KINDS: Record<string, string> = {
  media: "médias",
  secret: "clés",
  choice: "choix",
  validation: "validations",
};

/** « Casino, Paris sportifs · médias, clés » depuis `TeamMember.responsibilities` ; « — » si rien. */
export function responsibilitiesLabel(v: unknown): string {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const list = (x: unknown, labels: Record<string, string>) =>
    Array.isArray(x) ? x.filter((k): k is string => typeof k === "string" && k in labels).map((k) => labels[k]!) : [];
  const teams = list(o.teams, RESP_TEAMS);
  const kinds = list(o.kinds, RESP_KINDS);
  const parts = [teams.join(", "), kinds.join(", ")].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

/** Disponibilité d'un membre : disponible, absent jusqu'au …, ou indisponible. */
export function availabilityOf(m: { available: boolean; awayUntil: Date | null }, now: Date): { away: boolean; until: Date | null } {
  if (m.awayUntil && m.awayUntil.getTime() > now.getTime()) return { away: true, until: m.awayUntil };
  return { away: !m.available, until: null };
}

/** Rôle d'un tour : message de l'admin ou réponse du Boss. */
export function turnAuthor(role: string, name: string): string {
  return role === "BOSS" ? name : "Vous";
}

export const TURN_STATUS_LABELS: Record<string, string> = {
  done: "Fait",
  confirm: "À confirmer",
  refused: "Refusé",
  error: "Erreur",
  unmet: "Pas encore prévu",
  clarify: "Précision demandée",
  answered: "Répondu",
  running: "En cours",
};

export type UnmetCsvRow = { text: string; count: number; firstAt: Date; lastAt: Date };

export const UNMET_CSV_HEADERS = ["Demande", "Nombre de fois", "Première fois (Paris)", "Dernière fois (Paris)"];

export function unmetCsv(rows: readonly UnmetCsvRow[]): string {
  return toCsv(
    UNMET_CSV_HEADERS,
    rows.map((r) => [r.text, r.count, csvDate(r.firstAt), csvDate(r.lastAt)]),
  );
}
