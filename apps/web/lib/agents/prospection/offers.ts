/**
 * Phase 31 — offres du client aux affiliés (`AffiliateOffer`) : lecture du formulaire (marque, marché, pays acceptés,
 * prime par joueur en euros, part du revenu en %, mixte, motif de lien, notes) et affichage des conditions. La forme
 * de `dealTypes` est celle lue par la note des canaux : `{ cpa?, revshare?, hybrid?: { cpa, revshare } }`. Règles pures.
 */
import { countryName } from "@/lib/agents/analyses";

export type DealTypes = { cpa?: number; revshare?: number; hybrid?: { cpa: number; revshare: number } };

export type OfferInput = {
  id: string | null;
  brand: string;
  vertical: "SPORTS" | "CASINO" | "BOTH";
  countries: string[];
  dealTypes: DealTypes;
  trackingHint: string | null;
  notes: string | null;
};

export type OfferParse = { ok: true; offer: OfferInput } | { ok: false; error: string; field: string };

export const OFFER_VERTICALS = [
  { value: "SPORTS", label: "Paris sportifs" },
  { value: "CASINO", label: "Casino" },
  { value: "BOTH", label: "Casino et paris" },
] as const;

const str = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v.trim() : "");

function amount(fd: FormData, name: string, max: number): number | null | "bad" {
  const s = str(fd.get(name)).replace(/\s|€|%/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : "bad";
}

export function parseOfferForm(fd: FormData): OfferParse {
  const idRaw = str(fd.get("offerId"));
  const id = idRaw && /^[a-z0-9]{8,40}$/i.test(idRaw) ? idRaw : null;
  if (idRaw && !id) return { ok: false, error: "Offre inconnue.", field: "offerId" };
  const brand = str(fd.get("brand")).replace(/\s+/g, " ");
  if (!brand) return { ok: false, error: "Donnez le nom de la marque.", field: "brand" };
  if (brand.length > 60) return { ok: false, error: "Le nom de la marque fait 60 caractères au plus.", field: "brand" };
  const verticalRaw = str(fd.get("vertical")).toUpperCase();
  const vertical = (["SPORTS", "CASINO", "BOTH"] as const).find((v) => v === verticalRaw);
  if (!vertical) return { ok: false, error: "Choisissez le marché de l'offre : paris sportifs, casino, ou les deux.", field: "vertical" };
  const countries = [
    ...new Set(
      fd
        .getAll("countries")
        .flatMap((v) => String(v).split(/[\s,;]+/))
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const bad = countries.find((c) => !/^[A-Z]{2}$/.test(c));
  if (bad) return { ok: false, error: `« ${bad} » n'est pas un code de pays (deux lettres, comme FR).`, field: "countries" };
  if (!countries.length) return { ok: false, error: "Indiquez au moins un pays accepté (FR, BE…).", field: "countries" };

  const cpa = amount(fd, "cpa", 10_000);
  const revshare = amount(fd, "revshare", 100);
  const hCpa = amount(fd, "hybridCpa", 10_000);
  const hRev = amount(fd, "hybridRevshare", 100);
  if (cpa === "bad") return { ok: false, error: "Prime par joueur : un montant en euros de 0 à 10 000.", field: "cpa" };
  if (revshare === "bad") return { ok: false, error: "Part du revenu : un pourcentage de 0 à 100.", field: "revshare" };
  if (hCpa === "bad") return { ok: false, error: "Mixte, prime par joueur : un montant en euros de 0 à 10 000.", field: "hybridCpa" };
  if (hRev === "bad") return { ok: false, error: "Mixte, part du revenu : un pourcentage de 0 à 100.", field: "hybridRevshare" };
  if ((hCpa === null) !== (hRev === null)) return { ok: false, error: "Pour une offre mixte, donnez la prime par joueur ET la part du revenu.", field: hCpa === null ? "hybridCpa" : "hybridRevshare" };
  const dealTypes: DealTypes = {};
  if (cpa !== null) dealTypes.cpa = cpa;
  if (revshare !== null) dealTypes.revshare = revshare;
  if (hCpa !== null && hRev !== null) dealTypes.hybrid = { cpa: hCpa, revshare: hRev };
  if (!Object.keys(dealTypes).length) return { ok: false, error: "Donnez au moins une condition : prime par joueur, part du revenu, ou mixte.", field: "cpa" };

  const trackingHint = str(fd.get("trackingHint")) || null;
  if (trackingHint && trackingHint.length > 200) return { ok: false, error: "Le motif de lien fait 200 caractères au plus.", field: "trackingHint" };
  const notes = str(fd.get("notes")) || null;
  if (notes && notes.length > 1000) return { ok: false, error: "Les notes font 1 000 caractères au plus.", field: "notes" };
  return { ok: true, offer: { id, brand, vertical, countries, dealTypes, trackingHint, notes } };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function dealTypesOf(v: unknown): DealTypes {
  if (!isObj(v)) return {};
  const out: DealTypes = {};
  if (n(v.cpa) !== null) out.cpa = n(v.cpa)!;
  if (n(v.revshare) !== null) out.revshare = n(v.revshare)!;
  if (isObj(v.hybrid) && n(v.hybrid.cpa) !== null && n(v.hybrid.revshare) !== null) out.hybrid = { cpa: n(v.hybrid.cpa)!, revshare: n(v.hybrid.revshare)! };
  return out;
}

const eur = (x: number) => `${x.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
const pct = (x: number) => `${x.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

/** « Prime par joueur 100 € · part du revenu 30 % · mixte 50 € + 15 % ». */
export function dealText(v: unknown): string {
  const d = dealTypesOf(v);
  const parts: string[] = [];
  if (d.cpa !== undefined) parts.push(`prime par joueur ${eur(d.cpa)}`);
  if (d.revshare !== undefined) parts.push(`part du revenu ${pct(d.revshare)}`);
  if (d.hybrid) parts.push(`mixte ${eur(d.hybrid.cpa)} + ${pct(d.hybrid.revshare)}`);
  const s = parts.join(" · ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Aucune condition";
}

export function offerCountriesText(v: unknown): string {
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return list.length ? list.map((c) => countryName(c.toUpperCase())).join(", ") : "Aucun pays";
}
