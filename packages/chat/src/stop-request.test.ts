import { describe, expect, it } from "vitest";
import { isStopRequest, mentionsStopRequest } from "./stop-request";

describe("demande d'arrêt écrite sans /stop (règle 5 : pas de spam)", () => {
  it.each([
    "stop",
    "STOP",
    "Stop.",
    "STOP !!!",
    "stop stp",
    "Stop svp merci",
    "stop stop",
    "please stop",
    "STOP 🛑",
    "stop ✋",
    "Arrête de m'écrire",
    "arrêtez de m'écrire svp",
    "ne m'écris plus",
    "Laisse-moi tranquille",
    "désinscription",
    "unsubscribe",
    "Stop messaging me please",
    "leave me alone",
    "basta",
    "Basta por favor",
    "para",
    "deja de escribirme",
    "pare de me escrever",
    "chega",
    "hör auf",
    "Stopp bitte",
    "lass mich in Ruhe",
    "smettila",
    "non scrivermi più",
  ])("« %s » → /stop", (text) => {
    expect(isStopRequest(text)).toBe(true);
    expect(mentionsStopRequest(text)).toBe(true);
  });

  it.each([
    "stop 😂",
    "stop mdr",
    "arrête 🙈",
    "Arrête !",
    "arrête",
    "stop, t'es trop drôle",
    "stop je rigole",
    "para ti",
    "/stop",
    "",
    "Salut ça va ?",
    "j'arrête pas de penser à toi",
    "tu m'écris plus ?",
    "envoie-moi plus de messages",
  ])("« %s » → pas un /stop", (text) => {
    expect(isStopRequest(text)).toBe(false);
  });

  it("au milieu d'une phrase : seulement les demandes sans ambiguïté (pas de relance ensuite)", () => {
    expect(mentionsStopRequest("arrête de m'écrire, j'en ai marre")).toBe(true);
    expect(mentionsStopRequest("ok mais please stop messaging me now")).toBe(true);
    expect(mentionsStopRequest("bon, laisse-moi tranquille deux minutes")).toBe(true);
    expect(mentionsStopRequest("stop, t'es trop drôle")).toBe(false);
    expect(mentionsStopRequest("j'arrête pas de penser à toi")).toBe(false);
    expect(mentionsStopRequest("tu m'écris plus ?")).toBe(false);
    expect(mentionsStopRequest("laisse-moi tranquille mdr")).toBe(false);
  });
});
