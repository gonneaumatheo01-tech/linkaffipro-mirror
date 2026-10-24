/**
 * Phase 26, défaut trouvé par le test d'intégration du scénario privé : un message TRANSFÉRÉ qui contient
 * « jeton boss <valeur> » (ou un jeton collé pendant la demande SECRET « jeton boss ») enregistrait un nouveau Boss et
 * désactivait l'actuel. Un transfert est une donnée : jamais d'enregistrement, message retiré quand même.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBossKit } from "./testing";
import { bossFastPath } from "./fast";
import { askHuman } from "../human/requests";
import { setBossRegisterPort } from "./register-port";

vi.mock("../missions/lifecycle", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  continueMission: vi.fn(async () => undefined),
}));

afterEach(() => setBossRegisterPort(null));

const TOKEN = "123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-ra";

describe("jeton du Boss dans un message transféré", () => {
  it("« jeton boss … » transféré : aucun enregistrement, message retiré, jamais envoyé à l'IA", async () => {
    const kit = await createBossKit();
    const port = vi.fn(async () => ({ username: "evil_bot" }));
    setBossRegisterPort(port);
    const r = await bossFastPath(kit.deps, { ...kit.input(`jeton boss ${TOKEN}`), forwarded: true });
    expect(port).not.toHaveBeenCalled();
    expect(r).toMatchObject({ handled: true, deleteMessage: true });
    expect(kit.llm.calls.interpret).toHaveLength(0);
  });

  it("jeton seul transféré pendant la demande SECRET « jeton boss » : la demande reste ouverte", async () => {
    const kit = await createBossKit();
    const port = vi.fn(async () => ({ username: "evil_bot" }));
    setBossRegisterPort(port);
    await askHuman(kit.deps, { kind: "SECRET", key: "boss.token", question: "Envoie-moi le jeton du Boss" });
    await bossFastPath(kit.deps, { ...kit.input(TOKEN), forwarded: true });
    expect(port).not.toHaveBeenCalled();
    expect(kit.tables("humanRequest")[0]).toMatchObject({ status: "PENDING" });
  });
});
