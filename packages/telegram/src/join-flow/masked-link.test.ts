import { describe, expect, it } from "vitest";
import { maskedLinkPrefix, pickMaskedLink } from "./masked-link";

describe("lien d'invitation dont Telegram masque la fin (créé par un autre administrateur du canal)", () => {
  it("partie visible d'un lien masqué (« … » ou « ... »), rien pour un lien entier ou une adresse inattendue", () => {
    expect(maskedLinkPrefix("https://t.me/+GATEb_da…")).toBe("https://t.me/+GATEb_da");
    expect(maskedLinkPrefix("https://t.me/+GATEb_da...")).toBe("https://t.me/+GATEb_da");
    expect(maskedLinkPrefix("https://t.me/joinchat/AAAA…")).toBe("https://t.me/joinchat/AAAA");
    expect(maskedLinkPrefix("https://t.me/+GATEb_dating603")).toBeNull();
    expect(maskedLinkPrefix("…")).toBeNull();
    expect(maskedLinkPrefix("https://exemple.com/+abc…")).toBeNull();
  });

  const link = (url: string, isActive = true) => ({ telegramInviteLink: url, isActive });

  it("un seul lien de ce bot dans ce canal commence ainsi : retrouvé", () => {
    const l = link("https://t.me/+GATEb_dating603");
    expect(pickMaskedLink("https://t.me/+GATEb_da", [l])).toBe(l);
  });

  it("plusieurs liens possibles : jamais une provenance devinée (sauf un seul encore actif)", () => {
    const a = link("https://t.me/+GATEb_dating603");
    const b = link("https://t.me/+GATEb_daXXXX");
    expect(pickMaskedLink("https://t.me/+GATEb_da", [a, b])).toBeNull();
    const old = link("https://t.me/+GATEb_daOLD", false);
    expect(pickMaskedLink("https://t.me/+GATEb_da", [old, a])).toBe(a);
    expect(pickMaskedLink("https://t.me/+GATEb_da", [])).toBeNull();
  });

  it("la recherche en base peut ramener trop large (caractères « _ » et « % ») : seul le vrai début compte", () => {
    const wrong = link("https://t.me/+GATEbXdating603");
    const right = link("https://t.me/+GATEb_dating604");
    expect(pickMaskedLink("https://t.me/+GATEb_da", [wrong, right])).toBe(right);
  });
});
