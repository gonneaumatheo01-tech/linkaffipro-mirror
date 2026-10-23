/**
 * Faux fournisseurs déterministes : tests, et IA de repli quand aucune clé Anthropic n'est réglée (Réglages → IA).
 * Le faux LLM reconnaît la tâche par la ligne « Tâche : <clé> » du message utilisateur (prompts des agents) et rend un
 * JSON valide ; texte choisi par une empreinte du message, donc stable pour une même demande.
 */
import type { LlmRequest, LlmResponse } from "../types";
import type { ImageGenerateInput, ImageProvider } from "./image";
import type { AgentLlmProvider } from "./llm";
import type { ProviderFile, ReplaceInput, VideoProvider } from "./video";

const HOOKS = [
  "Ce soir, on ne fait pas les choses à moitié 🔥",
  "Tu sais ce qui manque à ta soirée ?",
  "Petit secret entre nous 🤫",
  "Dernière chance avant minuit ⏳",
  "Celle-là, tu ne l'as pas vue venir 😏",
  "On t'attendait, tu le sais ?",
  "Juste un clic et tout change ✨",
  "Rien de tel qu'un vendredi soir pour oser",
];
const BODIES = [
  "Une rencontre, un message, et la suite t'appartient.",
  "Les plus rapides ont déjà commencé, ne reste pas sur le banc.",
  "Ose le premier pas, le reste suit tout seul.",
  "Une ambiance que tu ne trouveras nulle part ailleurs.",
  "Ceux qui hésitent regardent, les autres en profitent.",
  "Un moment rien que pour toi, sans détour.",
  "Tu mérites mieux qu'une soirée banale.",
  "Laisse-toi surprendre, c'est le moment.",
];
const TOPICS = ["soirée", "rencontre", "surprise", "urgence", "défi", "confidence", "nouveauté", "week-end"];

export function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type FakeLlmOptions = {
  /** Réponse imposée par tâche (tests). */
  responses?: Partial<Record<string, string | ((req: LlmRequest) => string)>>;
  /** Coût simulé par appel (centimes). */
  costCents?: number;
  /** Erreurs à lever aux N premiers appels (tests de reprise). */
  failFirst?: number;
};

export function taskOf(req: LlmRequest): string {
  return /T[âa]che\s*:\s*([a-z-]+)/i.exec(req.user)?.[1]?.toLowerCase() ?? "redaction";
}

export function createFakeLlm(opts: FakeLlmOptions = {}): AgentLlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  let failures = opts.failFirst ?? 0;
  return {
    name: "fake",
    fake: true,
    calls,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      calls.push(req);
      if (failures > 0) {
        failures--;
        throw new Error("Panne simulée du faux fournisseur");
      }
      const task = taskOf(req);
      const forced = opts.responses?.[task];
      if (forced !== undefined) {
        return { text: typeof forced === "function" ? forced(req) : forced, costCents: opts.costCents ?? 0 };
      }
      if (task === "controle-media")
        return { text: JSON.stringify({ defect: "non", reason: "Aucun défaut visible (simulation)." }), costCents: opts.costCents ?? 0 };
      if (task === "controle") return { text: JSON.stringify({ verdict: "oui", reason: "Texte naturel." }), costCents: opts.costCents ?? 0 };
      const h = hashOf(req.user);
      const hook = HOOKS[h % HOOKS.length]!;
      const body = BODIES[(h >>> 8) % BODIES.length]!;
      const topic = TOPICS[(h >>> 16) % TOPICS.length]!;
      const text = `<b>${hook}</b>\n${body}`;
      return { text: JSON.stringify({ text, hook, topic }), costCents: opts.costCents ?? 0 };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Faux fournisseurs de médias (phase 20) : tests, et simulation tant qu'aucune clé fal.ai n'est réglée.
// ---------------------------------------------------------------------------------------------------------------

/** Petite image de test (PNG 16 × 16 orange) quand la persona n'a pas d'image de référence. */
export const FAKE_TEST_IMAGE: ProviderFile = {
  bytes: Uint8Array.from(
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGN4VmFDEmIY1TCqYfhqAACh3JoQLIL4OAAAAABJRU5ErkJggg==", "base64"),
  ),
  mimeType: "image/png",
  filename: "simulation-test.png",
};

export const FAKE_ASSET_URL = "fake://media-asset/";
export const FAKE_TEST_IMAGE_URL = "fake://test-image.png";

/** Lecture d'un `MediaAsset` par le faux fournisseur (le registre la branche sur la base). */
export type FakeAssetLoader = (assetId: string) => Promise<ProviderFile | null>;

export type FakeMediaOptions = {
  loadAsset?: FakeAssetLoader;
  /** Délai simulé avant que la vidéo soit « prête » (0 = tout de suite). */
  delayMs?: number;
  now?: () => Date;
  /** Échecs simulés aux N premières soumissions (tests). */
  failFirst?: number;
};

async function fakeDownload(url: string, memory: Map<string, ProviderFile>, loadAsset?: FakeAssetLoader): Promise<ProviderFile> {
  if (url === FAKE_TEST_IMAGE_URL) return FAKE_TEST_IMAGE;
  const mem = memory.get(url);
  if (mem) return mem;
  if (url.startsWith(FAKE_ASSET_URL) && loadAsset) {
    const file = await loadAsset(url.slice(FAKE_ASSET_URL.length));
    if (file) return { ...file, filename: `simulation-${file.filename}` };
  }
  throw new Error("Faux fournisseur : fichier introuvable");
}

/** Faux remplacement : renvoie la vidéo source telle quelle (marquée « simulation » au rangement), coût 0. */
export function createFakeVideoProvider(opts: FakeMediaOptions = {}): VideoProvider & { submitted: ReplaceInput[] } {
  const memory = new Map<string, ProviderFile>();
  const submitted: ReplaceInput[] = [];
  const clock = opts.now ?? (() => new Date());
  let failures = opts.failFirst ?? 0;
  let n = 0;
  return {
    name: "fake",
    submitted,
    estimateCents: () => 0,
    async startReplace(input) {
      submitted.push(input);
      if (failures > 0) {
        failures--;
        throw new Error("Panne simulée du faux fournisseur vidéo");
      }
      const readyAt = clock().getTime() + (opts.delayMs ?? 0);
      const url = input.sourceAssetId ? `${FAKE_ASSET_URL}${input.sourceAssetId}` : `fake://memory/${++n}`;
      if (!input.sourceAssetId) memory.set(url, { ...input.sourceVideo, filename: `simulation-${input.sourceVideo.filename}` });
      return { jobId: `fake-${readyAt}`, estimatedCents: 0, ref: { responseUrl: url } };
    },
    async poll(jobId, ref) {
      const readyAt = Number(/^fake-(\d+)$/.exec(jobId)?.[1] ?? 0);
      if (clock().getTime() < readyAt) return { status: "running" };
      if (!ref?.responseUrl) return { status: "failed", error: "Faux fournisseur : travail inconnu" };
      return { status: "done", outputUrl: ref.responseUrl, actualCents: 0 };
    },
    download: (url) => fakeDownload(url, memory, opts.loadAsset),
  };
}

/** Fausse photo : la première image de référence de la persona, sinon une image de test ; coût 0. */
export function createFakeImageProvider(opts: FakeMediaOptions = {}): ImageProvider & { calls: ImageGenerateInput[] } {
  const calls: ImageGenerateInput[] = [];
  let failures = opts.failFirst ?? 0;
  return {
    name: "fake",
    calls,
    estimateCents: () => 0,
    async generate(input) {
      calls.push(input);
      if (failures > 0) {
        failures--;
        throw new Error("Panne simulée du faux fournisseur d'images");
      }
      return { images: [{ url: input.referenceAssetId ? `${FAKE_ASSET_URL}${input.referenceAssetId}` : FAKE_TEST_IMAGE_URL }], cents: 0 };
    },
    download: (url) => fakeDownload(url, new Map(), opts.loadAsset),
  };
}
