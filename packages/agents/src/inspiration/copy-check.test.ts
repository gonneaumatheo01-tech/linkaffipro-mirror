import { describe, expect, it } from "vitest";
import { copiedSequence, copyWords, decodeCopyEntities, shingleHashes, shortQuote, textHash } from "./copy-check";

describe("jamais de copie (8 mots consécutifs)", () => {
  const ref = "🔥 Cote boostée ce soir sur le PSG, écris-moi en DM pour le VIP, places limitées !";
  const hashes = shingleHashes(ref);
  it("8 mots consécutifs repris (casse, accents et ponctuation ignorés) → copie", () => {
    expect(copiedSequence("Ce soir : cote boostée ce soir sur le psg ecris moi en dm pour gagner", hashes)).toBeTruthy();
  });
  it("7 mots repris → pas une copie ; texte écrit à neuf → pas une copie", () => {
    expect(copiedSequence("cote boostée ce soir sur le PSG, on en parle demain", hashes)).toBeNull();
    expect(copiedSequence("Match du soir : notre analyse et la cote du jour en bas.", hashes)).toBeNull();
  });
  it("empreinte stable, citation coupée à 10 mots", () => {
    expect(textHash("Bonjour, le MONDE !")).toBe(textHash("bonjour le monde"));
    expect(shortQuote("un deux trois quatre cinq six sept huit neuf dix onze douze")).toBe("un deux trois quatre cinq six sept huit neuf dix …");
  });
});

describe("jamais de copie : contournements détectés (relecture adverse)", () => {
  const ref = "Écris-moi en DM pour le VIP, les places sont limitées ce soir seulement";
  const hashes = shingleHashes(ref);
  const tail = "Écris-moi en DM pour le VIP, les places sont limitées";
  const cases: [string, string][] = [
    ["balises HTML", "<b>Écris-moi</b> en <i>DM</i> pour le <u>VIP</u>, les places sont <b>limitées</b>"],
    ["balises au milieu d'un mot", "Écris-moi en DM pour le VIP, les pla<b>ces</b> sont limi<i>tées</i>"],
    ["entités nommées et numériques", "&Eacute;cris-moi en DM pour le VIP, les places sont limit&eacute;es"],
    ["entités numériques et apostrophe", "&#201;cris-moi&#32;en DM pour le VIP, les places sont limit&#xE9;es"],
    ["entités doublement encodées", "&amp;#201;cris-moi en DM pour le VIP, les places sont limitées"],
    ["gras mathématique", "𝗘𝗰𝗿𝗶𝘀-𝗺𝗼𝗶 𝗲𝗻 𝗗𝗠 𝗽𝗼𝘂𝗿 𝗹𝗲 𝗩𝗜𝗣, 𝗹𝗲𝘀 𝗽𝗹𝗮𝗰𝗲𝘀 𝘀𝗼𝗻𝘁 𝗹𝗶𝗺𝗶𝘁𝗲𝗲𝘀"],
    ["pleine chasse", "Ｅｃｒｉｓ－ｍｏｉ ｅｎ ＤＭ ｐｏｕｒ ｌｅ ＶＩＰ， ｌｅｓ ｐｌａｃｅｓ ｓｏｎｔ ｌｉｍｉｔｅｅｓ"],
    ["petites capitales", "ᴇᴄʀɪꜱ-ᴍᴏɪ ᴇɴ ᴅᴍ ᴘᴏᴜʀ ʟᴇ ᴠɪᴘ, ʟᴇꜱ ᴘʟᴀᴄᴇꜱ ꜱᴏɴᴛ ʟɪᴍɪᴛᴇᴇꜱ"],
    ["sosies cyrilliques", "Écris-mоi еn DM pоur lе VIP, lеs plаcеs sоnt limitéеs"],
    ["espaces de largeur nulle", "Éc​ris-moi en D‍M pour le V⁠IP, les pla­ces sont li‌mi﻿tées"],
    ["mot coupé par un tiret", "Écris-moi en DM pour le VIP, les places sont limi-tées"],
    ["mot coupé en fin de ligne", "Écris-moi en DM pour le VIP, les places sont limi-\ntées"],
    ["tiret typographique", "Écris‑moi en DM pour le VIP, les pla‐ces sont limitées"],
    ["trait d'union retiré", "Écris moi en DM pour le VIP, les places sont limitées"],
    ["mots recollés", "Écrismoi en DM pour le VIP, les places sont limitées"],
    ["trait d'union retiré et mot coupé dans le même texte", "Écris moi en DM pour le VIP, les places sont limi-tées"],
    ["tout à la fois", "<b>𝗘𝗰𝗿𝗶𝘀 𝗺𝗼𝗶</b> en&nbsp;D\u200BM pour le VIP, les places sont limi-\nt&eacute;es"],
  ];
  it.each(cases)("%s → copie détectée", (_label, text) => {
    expect(copiedSequence(text, hashes)).toBeTruthy();
  });
  it("la base sert de témoin", () => {
    expect(copiedSequence(tail, hashes)).toBeTruthy();
  });
  it("texte écrit à neuf (même sujet) → pas une copie", () => {
    expect(copiedSequence("<b>Le VIP ouvre ce soir</b> : demande ton accès en privé, il reste peu de places", hashes)).toBeNull();
    expect(copiedSequence("Une place au VIP ? Envoie-moi un message, je réponds à tous avant minuit", hashes)).toBeNull();
  });
  it("normalisation : décodage, balises, invisibles", () => {
    expect(decodeCopyEntities("l&#39;offre &amp; &laquo;VIP&raquo; &eacute;t&eacute;")).toBe(`l'offre & "VIP" ete`);
    expect(copyWords("<b>Lim</b>itées&nbsp;&#39;ce​ soir")).toEqual(["limitees", "ce", "soir"]);
    // Le découpage de base ne change pas pour un texte ordinaire (empreintes d'avant toujours valables).
    expect(copyWords("Écris-moi en DM, places limitées !")).toEqual(["ecris", "moi", "en", "dm", "places", "limitees"]);
  });
});
