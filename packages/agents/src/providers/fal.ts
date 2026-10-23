/**
 * Client fal.ai par `fetch` direct (pas de SDK : aucune dépendance, `fetch` injectable pour les tests).
 * - file d'attente REST : `POST https://queue.fal.run/<modèle>` (`Authorization: Key <clé>`) → `request_id`,
 *   `status_url`, `response_url` ; état puis résultat relus aux adresses RENVOYÉES (une adresse reconstruite avec le
 *   chemin complet du modèle renvoie 405 : seules propriétaire/app servent) ;
 * - stockage : `POST /storage/upload/initiate` → `upload_url` + `file_url`, puis `PUT` des octets (repli sur
 *   `rest.alpha.fal.ai`) ; nos médias sont envoyés chez fal, jamais servis par notre site ;
 * - vidéo : Wan 2.2 Animate « replace » ; photo : Flux + LoRA.
 */
import { falImageCents, falVideoCents, FAL_IMAGE_SIZES } from "./costs";
import { downloadBytes, ProviderError, requestJson, type HttpDeps } from "./http";
import type { ImageGenerateInput, ImageProvider } from "./image";
import type { ProviderFile, VideoJobRef, VideoPoll, VideoProvider, VideoResolution } from "./video";

export const FAL_QUEUE_BASE = "https://queue.fal.run";
export const FAL_STORAGE_HOSTS = ["https://rest.fal.ai", "https://rest.alpha.fal.ai"] as const;
export const FAL_VIDEO_MODEL = "fal-ai/wan/v2.2-14b/animate/replace";
export const FAL_IMAGE_MODEL = "fal-ai/flux-lora";
const LABEL = "fal.ai";

/** Propriétaire/app d'un modèle (`fal-ai/wan/v2.2-14b/animate/replace` → `fal-ai/wan`) : base des adresses d'état. */
export function falAppPath(modelId: string): string {
  return modelId.split("/").slice(0, 2).join("/");
}

export type FalClientOptions = { apiKey: string; fetch?: typeof fetch };

export type FalSubmission = { requestId: string; statusUrl: string; responseUrl: string };
export type FalStatus = { status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED"; error?: string | null };

export function createFalClient(opts: FalClientOptions) {
  const fetchImpl = opts.fetch ?? fetch;
  const http: HttpDeps = { fetch: fetchImpl, label: LABEL, secret: opts.apiKey };
  const auth = { Authorization: `Key ${opts.apiKey}` };

  async function uploadOn(host: string, file: ProviderFile): Promise<string> {
    const init = await requestJson<{ upload_url?: string; file_url?: string }>(
      http,
      `${host}/storage/upload/initiate?storage_type=fal-cdn-v3`,
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: file.filename, content_type: file.mimeType }),
      },
    );
    if (!init.upload_url || !init.file_url) throw new ProviderError(`${LABEL} : envoi du fichier refusé (réponse incomplète)`, true);
    let put: Response;
    try {
      put = await fetchImpl(init.upload_url, { method: "PUT", headers: { "Content-Type": file.mimeType }, body: file.bytes as unknown as RequestInit["body"] });
    } catch (err) {
      throw new ProviderError(`${LABEL} : envoi du fichier impossible (${(err as Error).message || "réseau"})`.slice(0, 200), true);
    }
    if (!put.ok) throw new ProviderError(`${LABEL} : envoi du fichier refusé (${put.status})`, put.status >= 500 || put.status === 429, put.status);
    return init.file_url;
  }

  return {
    /** Envoie un fichier sur le stockage fal ; rend son adresse publique. Hôte officiel, puis l'hôte de repli. */
    async upload(file: ProviderFile): Promise<string> {
      let last: unknown = null;
      for (const host of FAL_STORAGE_HOSTS) {
        try {
          return await uploadOn(host, file);
        } catch (err) {
          last = err;
          // Clé refusée : inutile d'essayer l'autre hôte.
          if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) throw err;
        }
      }
      throw last instanceof Error ? last : new ProviderError(`${LABEL} : envoi du fichier impossible`, true);
    },

    async submit(modelId: string, input: Record<string, unknown>): Promise<FalSubmission> {
      const r = await requestJson<{ request_id?: string; status_url?: string; response_url?: string }>(http, `${FAL_QUEUE_BASE}/${modelId}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.request_id) throw new ProviderError(`${LABEL} : soumission sans identifiant`, true);
      const base = `${FAL_QUEUE_BASE}/${falAppPath(modelId)}/requests/${r.request_id}`;
      return { requestId: r.request_id, statusUrl: r.status_url || `${base}/status`, responseUrl: r.response_url || base };
    },

    async status(statusUrl: string): Promise<FalStatus> {
      const r = await requestJson<{ status?: string; error?: unknown }>(http, statusUrl, { method: "GET", headers: auth });
      const s = r.status;
      if (s !== "IN_QUEUE" && s !== "IN_PROGRESS" && s !== "COMPLETED") throw new ProviderError(`${LABEL} : état inconnu (${String(s).slice(0, 40)})`, true);
      const error = typeof r.error === "string" ? r.error : r.error ? JSON.stringify(r.error).slice(0, 200) : null;
      return { status: s, error };
    },

    async result<T>(responseUrl: string): Promise<T> {
      return requestJson<T>(http, responseUrl, { method: "GET", headers: auth });
    },

    async download(url: string): Promise<ProviderFile> {
      return downloadBytes(fetchImpl, LABEL, url);
    },
  };
}

export type FalClient = ReturnType<typeof createFalClient>;

/** Lecture d'un travail fal (pur après les appels) : état → `VideoPoll`, résultat → adresse de la vidéo. */
async function pollFal<T>(client: FalClient, jobId: string, ref: VideoJobRef | undefined, modelId: string, urlOf: (out: T) => string | null): Promise<VideoPoll> {
  const base = `${FAL_QUEUE_BASE}/${falAppPath(modelId)}/requests/${jobId}`;
  try {
    const st = await client.status(ref?.statusUrl || `${base}/status`);
    if (st.status === "IN_QUEUE") return { status: "queued" };
    if (st.status === "IN_PROGRESS") return { status: "running" };
    if (st.error) return { status: "failed", error: `${LABEL} : ${st.error}`.slice(0, 300) };
    const out = await client.result<T>(ref?.responseUrl || base);
    const url = urlOf(out);
    if (!url) return { status: "failed", error: `${LABEL} : résultat sans fichier` };
    return { status: "done", outputUrl: url };
  } catch (err) {
    if (err instanceof ProviderError) return err.transient ? { status: "running", transient: true, error: err.message } : { status: "failed", error: err.message };
    return { status: "running", transient: true, error: `${LABEL} : ${(err as Error).message}`.slice(0, 200) };
  }
}

export type FalVideoOptions = { client: FalClient };

export function createFalVideoProvider(opts: FalVideoOptions): VideoProvider {
  const { client } = opts;
  return {
    name: "fal",
    estimateCents: ({ durationSec, fps, resolution }) => falVideoCents(durationSec, fps, resolution),
    async startReplace(input) {
      const [videoUrl, imageUrl] = [await client.upload(input.sourceVideo), await client.upload(input.referenceImage)];
      const sub = await client.submit(FAL_VIDEO_MODEL, {
        video_url: videoUrl,
        image_url: imageUrl,
        resolution: input.resolution satisfies VideoResolution,
        video_quality: "high",
      });
      return {
        jobId: sub.requestId,
        estimatedCents: falVideoCents(input.durationSec, input.fps, input.resolution),
        ref: { statusUrl: sub.statusUrl, responseUrl: sub.responseUrl },
      };
    },
    poll: (jobId, ref) =>
      pollFal<{ video?: { url?: string } }>(client, jobId, ref, FAL_VIDEO_MODEL, (out) => (typeof out.video?.url === "string" ? out.video.url : null)),
    download: (url) => client.download(url),
  };
}

export type FalImageOptions = {
  client: FalClient;
  /** Attente entre deux lectures d'état (2 s) et délai maximal (3 min) : une photo prend quelques secondes. */
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

type FluxOutput = { images?: Array<{ url?: string; width?: number; height?: number }>; has_nsfw_concepts?: boolean[] };

export function createFalImageProvider(opts: FalImageOptions): ImageProvider {
  const { client } = opts;
  const pollMs = opts.pollMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    name: "fal",
    estimateCents: ({ count, aspect }) => falImageCents(count, aspect),
    async generate(input: ImageGenerateInput) {
      const count = Math.min(4, Math.max(1, Math.round(input.count)));
      const size = FAL_IMAGE_SIZES[input.aspect];
      const sub = await client.submit(FAL_IMAGE_MODEL, {
        prompt: input.prompt,
        image_size: size.name,
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: count,
        loras: [{ path: input.loraUrl, scale: input.loraScale ?? 0.8 }],
        enable_safety_checker: true,
        output_format: "jpeg",
      });
      for (let waited = 0; ; waited += pollMs) {
        const st = await client.status(sub.statusUrl).catch((err: unknown) => {
          if (err instanceof ProviderError && err.transient) return null;
          throw err;
        });
        if (st?.status === "COMPLETED") {
          if (st.error) throw new ProviderError(`${LABEL} : ${st.error}`.slice(0, 300), false);
          break;
        }
        if (waited >= timeoutMs) throw new ProviderError(`${LABEL} : photo toujours en cours après ${Math.round(timeoutMs / 1000)} s`, true);
        await sleep(pollMs);
      }
      const out = await client.result<FluxOutput>(sub.responseUrl);
      const flags = out.has_nsfw_concepts ?? [];
      // Image signalée par le filtre de fal : jamais gardée (fal la remplace d'ailleurs par une image noire).
      const images = (out.images ?? [])
        .map((img, i) => ({ img, flagged: flags[i] === true }))
        .filter((x) => !x.flagged && typeof x.img.url === "string")
        .map(({ img }) => ({ url: img.url!, width: img.width, height: img.height }));
      if (!images.length) throw new ProviderError(`${LABEL} : aucune photo utilisable (filtre de contenu ou résultat vide)`, false);
      return { images, cents: falImageCents(count, input.aspect) };
    },
    download: (url) => client.download(url),
  };
}
