/**
 * Pretraitement des vocaux avant transcription (phase 18, partage depuis la phase 20 avec le worker pour les vocaux
 * de l'admin) : les gens parlent souvent bas, loin du micro
 * ou dans le bruit. Avant d'envoyer le son a Whisper, on le nettoie et on l'amplifie avec ffmpeg :
 *   - highpass 80 Hz : retire les grondements (vent, frottements, basses de la rue) ;
 *   - dynaudnorm : remonte les passages faibles sans saturer les forts (jusqu'a +30 dB) ;
 *   - loudnorm : ramene l'ensemble a -16 LUFS, le niveau d'une voix normale ;
 *   - mono 16 kHz FLAC : exactement ce que Whisper ecoute, sans perte et peu volumineux.
 * Sans ffmpeg (poste de dev sans Homebrew), on renvoie null et le vocal part tel quel.
 */
import { spawn } from "node:child_process";
import { silentVoiceLogger, type VoiceLogger } from "./voice-logger";

export type PreparedAudio = { bytes: Buffer; mime: string; name: string };

/** Chaine de filtres ffmpeg (ordre important : nettoyer, puis amplifier, puis niveler). */
export const VOICE_FILTERS =
  "highpass=f=80,dynaudnorm=p=0.9:m=30:s=5:g=15,loudnorm=I=-16:TP=-1.5:LRA=11";

/** Un vocal Telegram dure rarement plus de deux minutes : au-dela de 30 s de calcul, on abandonne. */
const FFMPEG_TIMEOUT_MS = 30_000;

let ffmpegKnown: Promise<boolean> | null = null;

/** ffmpeg est-il installe ? Verifie une seule fois par process. */
export function hasFfmpeg(logger: VoiceLogger = silentVoiceLogger): Promise<boolean> {
  ffmpegKnown ??= new Promise<boolean>((resolve) => {
    try {
      const probe = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
      probe.on("error", () => resolve(false));
      probe.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  }).then((ok) => {
    if (!ok) logger.warn("ffmpeg absent : les vocaux partent sans nettoyage ni amplification");
    return ok;
  });
  return ffmpegKnown;
}

/** Pour les tests : oublie le resultat de la detection de ffmpeg. */
export function resetFfmpegDetection(): void {
  ffmpegKnown = null;
}

/**
 * Nettoie et amplifie un vocal. Renvoie null (et journalise) si ffmpeg manque ou echoue :
 * l'appelant envoie alors les octets d'origine.
 */
export async function prepareVoice(
  bytes: Buffer,
  logger: VoiceLogger = silentVoiceLogger,
): Promise<PreparedAudio | null> {
  if (bytes.length === 0) return null;
  if (!(await hasFfmpeg(logger))) return null;
  return new Promise<PreparedAudio | null>((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let done = false;
    const finish = (value: PreparedAudio | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vn",
        "-af",
        VOICE_FILTERS,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "flac",
        "-f",
        "flac",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const timer = setTimeout(() => {
      logger.warn({ octets: bytes.length }, "ffmpeg trop long sur un vocal : envoye tel quel");
      ff.kill("SIGKILL");
      finish(null);
    }, FFMPEG_TIMEOUT_MS);
    ff.stdout.on("data", (d: Buffer) => out.push(d));
    ff.stderr.on("data", (d: Buffer) => err.push(d));
    ff.on("error", (e) => {
      logger.warn({ err: e.message }, "ffmpeg injoignable : vocal envoye tel quel");
      finish(null);
    });
    ff.on("close", (code) => {
      const prepared = Buffer.concat(out);
      if (code === 0 && prepared.length > 0) {
        finish({ bytes: prepared, mime: "audio/flac", name: "vocal.flac" });
      } else {
        logger.warn(
          { code, detail: Buffer.concat(err).toString("utf8").slice(0, 300) },
          "ffmpeg a echoue sur un vocal : envoye tel quel",
        );
        finish(null);
      }
    });
    // ffmpeg peut fermer son entree avant la fin de l'ecriture (fichier tronque) : jamais une exception.
    ff.stdin.on("error", () => undefined);
    ff.stdin.end(bytes);
  });
}
