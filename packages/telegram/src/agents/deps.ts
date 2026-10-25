/**
 * Dépendances des agents côté bot (phase 19) : base, mise en file (`@linkaffipro/queue`) et messager admin. La file
 * est créée à la première utilisation : un bot démarre même si la mise en file n'est pas encore disponible.
 */
import { portSiteOps, setBossRegisterPort, type AgentsDeps, type AgentsEnqueue } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { createAgentsEnqueue } from "@linkaffipro/queue";
import { createAdminMessenger } from "./admin-messenger";

let cached: AgentsDeps | null = null;

function lazyEnqueue(): AgentsEnqueue {
  let impl: ReturnType<typeof createAgentsEnqueue> | null = null;
  const get = () => (impl ??= createAgentsEnqueue());
  return {
    orchestrator: (job, opts) => get().orchestrator(job, opts),
    step: (teamKey, agent, job, opts) => get().step(teamKey, agent, job, opts),
  };
}

/**
 * Phase 26 : branche l'enregistrement du Boss (`registerBossFromToken`) sur le point d'accroche du dialogue admin
 * (`jeton boss <valeur>`, demande SECRET « jeton boss »). Import différé : pas de cycle service → prisma-deps → deps.
 */
export function installBossRegisterPort(): void {
  setBossRegisterPort(async (token) => {
    const { registerBossFromToken } = await import("../service");
    const db = prisma;
    const admin = await db.setting.findUnique({ where: { key: "admin.telegramUserId" } });
    const user =
      typeof admin?.value === "string" && /^\d+$/.test(admin.value)
        ? await db.user.findFirst({ where: { telegramUserId: BigInt(admin.value), role: "ADMIN" }, select: { id: true } })
        : null;
    const r = await registerBossFromToken(token, { via: "TELEGRAM", userId: user?.id ?? null });
    return { username: r.username };
  });
}

export function createBotAgentsDeps(): AgentsDeps {
  if (!cached) installBossRegisterPort();
  cached ??= {
    // Le client partagé omet `Channel.photoSmall` par défaut : même base, type élargi pour `AgentsDeps`.
    prisma: prisma as unknown as AgentsDeps["prisma"],
    enqueue: lazyEnqueue(),
    admin: createAdminMessenger(),
    // Phase 34 : opérations du site en processus (registre posé par le site dans son webhook ; ailleurs : indisponible).
    siteOps: portSiteOps,
    logger: {
      info: (o, m) => console.info(m ?? "[agents]", o),
      warn: (o, m) => console.warn(m ?? "[agents]", o),
      error: (o, m) => console.error(m ?? "[agents]", o),
    },
  } satisfies AgentsDeps;
  return cached;
}
