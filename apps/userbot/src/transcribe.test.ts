import { describe, expect, it, vi } from "vitest";

// Aucune base ni reseau dans ces tests : le pretraitement et l'appel Venice sont remplaces.
vi.mock("@linkaffipro/db", () => ({ prisma: {}, Prisma: {} }));

const { transcribe, usableTranscript } = await import("./transcribe");

/** Faux Venice : une reponse par appel, dans l'ordre ; garde ce qui a ete envoye. */
function fakeVenice(answers: Array<{ text: string; duration?: number } | { status: number }>) {
  const calls: Array<{ language: string | null; name: string; type: string }> = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const form = init?.body as FormData;
    const file = form.get("file") as File;
    const language = form.get("language");
    calls.push({ language: typeof language === "string" ? language : null, name: file.name, type: file.type });
    const answer = answers[calls.length - 1] ?? { status: 500 };
    if ("status" in answer) return new Response("boom", { status: answer.status });
    return Response.json({ text: answer.text, duration: answer.duration ?? 5 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const nettoye = async (bytes: Buffer) => ({ bytes: Buffer.concat([bytes, bytes]), mime: "audio/flac", name: "vocal.flac" });
const sansFfmpeg = async () => null;
const ogg = Buffer.from("OggS-faux-vocal");

describe("transcript exploitable", () => {
  it("accepte une vraie phrase, meme courte", () => {
    expect(usableTranscript("salut ca va", 4)).toBe(true);
    expect(usableTranscript("oui", null)).toBe(true);
  });

  it("refuse le vide, la ponctuation seule et les hallucinations de Whisper", () => {
    expect(usableTranscript("", 3)).toBe(false);
    expect(usableTranscript("...", 3)).toBe(false);
    expect(usableTranscript("Sous-titres réalisés par la communauté d'Amara.org", 8)).toBe(false);
    expect(usableTranscript("Merci d'avoir regardé cette vidéo !", 8)).toBe(false);
    expect(usableTranscript("Thank you for watching.", 8)).toBe(false);
  });

  it("refuse un mot repete en boucle et un seul mot pour un long vocal", () => {
    expect(usableTranscript("oui oui oui oui oui oui oui", 12)).toBe(false);
    expect(usableTranscript("hein", 15)).toBe(false);
    expect(usableTranscript("hein", 3)).toBe(true);
  });
});

describe("transcription des vocaux", () => {
  it("envoie le son nettoye (FLAC) et rend le texte du premier essai", async () => {
    const { fetchFn, calls } = fakeVenice([{ text: " salut ca va ? " }]);
    const texte = await transcribe("cle", ogg, "audio/ogg", { fetch: fetchFn, prepare: nettoye });
    expect(texte).toBe("salut ca va ?");
    expect(calls).toEqual([{ language: null, name: "vocal.flac", type: "audio/flac" }]);
  });

  it("retente en francais quand le premier essai ne donne rien d'exploitable", async () => {
    const { fetchFn, calls } = fakeVenice([
      { text: "Sous-titres réalisés par la communauté d'Amara.org", duration: 9 },
      { text: "tu fais quoi ce soir", duration: 9 },
    ]);
    const texte = await transcribe("cle", ogg, "audio/ogg", { fetch: fetchFn, prepare: nettoye });
    expect(texte).toBe("tu fais quoi ce soir");
    expect(calls.map((c) => c.language)).toEqual([null, "fr"]);
  });

  it("rend null apres deux essais vides (la persona demandera de repeter)", async () => {
    const { fetchFn, calls } = fakeVenice([{ text: "" }, { text: "." }]);
    expect(await transcribe("cle", ogg, "audio/ogg", { fetch: fetchFn, prepare: nettoye })).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("sans ffmpeg, envoie le vocal tel quel", async () => {
    const { fetchFn, calls } = fakeVenice([{ text: "ok" }]);
    expect(await transcribe("cle", ogg, "audio/ogg", { fetch: fetchFn, prepare: sansFfmpeg })).toBe("ok");
    expect(calls).toEqual([{ language: null, name: "vocal.ogg", type: "audio/ogg" }]);
  });

  it("ne jette jamais : erreur reseau ou reponse en echec donnent null", async () => {
    const { fetchFn } = fakeVenice([{ status: 503 }, { status: 503 }]);
    expect(await transcribe("cle", ogg, "audio/ogg", { fetch: fetchFn, prepare: nettoye })).toBeNull();
    const explose = vi.fn(async () => {
      throw new Error("reseau");
    }) as unknown as typeof fetch;
    expect(await transcribe("cle", ogg, "audio/ogg", { fetch: explose, prepare: nettoye })).toBeNull();
  });

  it("ignore un vocal vide ou trop gros sans appeler Venice", async () => {
    const { fetchFn, calls } = fakeVenice([]);
    expect(await transcribe("cle", Buffer.alloc(0), "audio/ogg", { fetch: fetchFn, prepare: nettoye })).toBeNull();
    expect(await transcribe("cle", Buffer.alloc(3 * 1024 * 1024), "audio/ogg", { fetch: fetchFn, prepare: nettoye })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
