/**
 * Réponses HTTP enregistrées (forme de la documentation officielle, 23 octobre 2026) pour tester le client fal.ai sans
 * réseau, et un faux `fetch` qui les rejoue dans l'ordre des routes.
 */
export const REQ_ID = "764cabcf-b745-4b3e-ae38-1200304cf45b";

export const fal = {
  submit: {
    request_id: REQ_ID,
    response_url: `https://queue.fal.run/fal-ai/wan/requests/${REQ_ID}`,
    status_url: `https://queue.fal.run/fal-ai/wan/requests/${REQ_ID}/status`,
    cancel_url: `https://queue.fal.run/fal-ai/wan/requests/${REQ_ID}/cancel`,
    queue_position: 0,
  },
  inQueue: { status: "IN_QUEUE", queue_position: 2, response_url: `https://queue.fal.run/fal-ai/wan/requests/${REQ_ID}` },
  inProgress: { status: "IN_PROGRESS", logs: [] },
  completed: { status: "COMPLETED", logs: [], response_url: `https://queue.fal.run/fal-ai/wan/requests/${REQ_ID}` },
  completedWithError: { status: "COMPLETED", error: "Video decoding failed" },
  imageSubmit: {
    request_id: "img-1",
    response_url: "https://queue.fal.run/fal-ai/flux-lora/requests/img-1",
    status_url: "https://queue.fal.run/fal-ai/flux-lora/requests/img-1/status",
  },
  imageResult: {
    images: [{ url: "https://v3.fal.media/files/lion/photo.jpg", width: 768, height: 1024, content_type: "image/jpeg" }],
    has_nsfw_concepts: [false],
    seed: 7,
    prompt: "lea_trigger",
  },
  imageNsfw: { images: [{ url: "https://v3.fal.media/files/lion/black.jpg", width: 768, height: 1024 }], has_nsfw_concepts: [true] },
  initiate: { upload_url: "https://storage.fal.ai/upload/abc?sig=x", file_url: "https://v3.fal.media/files/abc/source.mp4" },
  unauthorized: { detail: "Invalid Key Authorization header format" },
  validation: { detail: [{ loc: ["body", "video_url"], msg: "field required", type: "value_error.missing" }] },
  serverError: { detail: "Internal Server Error" },
  rateLimited: { detail: "Too many requests" },
};

export type Route = {
  method?: string;
  match: string | RegExp;
  status?: number;
  body?: unknown;
  bytes?: Uint8Array;
  headers?: Record<string, string>;
  /** Utilisable une seule fois (réponses successives d'une même adresse). */
  once?: boolean;
  throws?: string;
};

export type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

/** Faux `fetch` : première route qui correspond ; aucune route → 599 (le test échoue lisiblement). */
export function fixtureFetch(routes: Route[]) {
  const calls: Call[] = [];
  const used = new Set<Route>();
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* texte */
      }
    }
    calls.push({ method, url, headers, body });
    const route = routes.find(
      (r) => !used.has(r) && (r.method ?? "GET") === method && (typeof r.match === "string" ? url === r.match : r.match.test(url)),
    );
    if (!route) return new Response(JSON.stringify({ detail: `aucune route pour ${method} ${url}` }), { status: 599 });
    if (route.once) used.add(route);
    if (route.throws) throw new Error(route.throws);
    if (route.bytes) return new Response(route.bytes as unknown as ConstructorParameters<typeof Response>[0], { status: route.status ?? 200, headers: route.headers ?? {} });
    return new Response(route.body === undefined ? "" : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json", ...(route.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}
