/**
 * Faux client Prisma en mémoire, pour les tests unitaires du moteur (aucune base, aucun réseau). Ne couvre que ce que
 * le moteur utilise : requêtes « à plat » (le moteur n'utilise ni `include` ni filtre de relation), opérateurs
 * courants (`in`, `notIn`, `not`, `gt`, `gte`, `lt`, `lte`, `startsWith`, `contains`, `OR`, `AND`, `NOT`), `orderBy`,
 * `take`, `increment`, `upsert`, `$transaction`. `select` est ignoré (la ligne entière est renvoyée).
 */
import type { PrismaClient } from "@linkaffipro/db";

type Row = Record<string, unknown>;

const DEFAULTS: Record<string, () => Row> = {
  agentTeamConfig: () => ({
    enabled: true,
    simulation: true,
    paused: false,
    pausedReason: null,
    autonomyLevel: 0,
    monthlyBudgetCents: {},
    styleGuidelines: "",
    forbiddenWords: [],
    maxTextLength: 900,
    quietHours: [],
    settings: {},
    consecutiveFailures: 0,
    updatedById: null,
  }),
  channelAgentPlan: () => ({
    enabled: false,
    postsPerDay: 3,
    windowStart: "09:00",
    windowEnd: "22:00",
    minSpacingMinutes: 90,
    mix: { video: 0, photo: 0, text: 1 },
    personaId: null,
    campaignId: null,
    themes: [],
  }),
  agentMission: () => ({
    kind: "POST",
    channelId: null,
    status: "PENDING",
    currentStep: 0,
    steps: [],
    payload: {},
    costCents: 0,
    postId: null,
    validationId: null,
    scheduledFor: null,
    planDay: null,
    isTest: false,
    createdBy: "GRAND_CHEF",
    createdById: null,
    attempts: 0,
    lastError: null,
  }),
  agentRun: () => ({ stepIndex: 0, endedAt: null, durationMs: null, costCents: 0, inputSummary: null, outputSummary: null, error: null }),
  agentUsage: () => ({ cents: 0, calls: 0, alerted80: false, alerted100: false }),
  agentValidation: () => ({ status: "PENDING", mediaAssetId: null, decidedAt: null, remindedAt: null, editedText: null }),
  post: () => ({ status: "DRAFT", scheduledAt: null, sentAt: null, text: "", mediaAssetIds: [], buttons: [], isTemplate: false, publisher: "BOT", agentMissionId: null }),
  channel: () => ({ isActive: true, isTest: false, type: "CHANNEL", vertical: null, language: "fr", primaryBotId: null, username: null }),
  event: () => ({ memberId: null, channelId: null, botId: null, payload: {} }),
  mediaAsset: () => ({ teamKey: null, theme: null, personaId: null, kind: null, origin: null, tags: [], duration: null }),
  mediaUsage: () => ({ postId: null, missionId: null }),
};

let seq = 0;
const newId = () => `id${(++seq).toString(36).padStart(5, "0")}`;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

const OPS = new Set(["in", "notIn", "not", "gt", "gte", "lt", "lte", "startsWith", "contains", "equals"]);

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (x === y) return 0;
  if (x === null || x === undefined) return -1;
  if (y === null || y === undefined) return 1;
  return (x as number) < (y as number) ? -1 : 1;
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return cmp(a, b) === 0;
  return a === b || (a === undefined && b === null);
}

function matchValue(v: unknown, cond: unknown): boolean {
  if (!isPlainObject(cond) || !Object.keys(cond).every((k) => OPS.has(k))) return eq(v, cond);
  for (const [op, arg] of Object.entries(cond)) {
    switch (op) {
      case "equals":
        if (!eq(v, arg)) return false;
        break;
      case "in":
        if (!(arg as unknown[]).some((x) => eq(v, x))) return false;
        break;
      case "notIn":
        if ((arg as unknown[]).some((x) => eq(v, x))) return false;
        break;
      case "not":
        if (matchValue(v, arg)) return false;
        break;
      case "gt":
        if (v === null || v === undefined || cmp(v, arg) <= 0) return false;
        break;
      case "gte":
        if (v === null || v === undefined || cmp(v, arg) < 0) return false;
        break;
      case "lt":
        if (v === null || v === undefined || cmp(v, arg) >= 0) return false;
        break;
      case "lte":
        if (v === null || v === undefined || cmp(v, arg) > 0) return false;
        break;
      case "startsWith":
        if (typeof v !== "string" || !v.startsWith(arg as string)) return false;
        break;
      case "contains":
        if (typeof v !== "string" || !v.includes(arg as string)) return false;
        break;
    }
  }
  return true;
}

export function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (k === "OR") {
      if (!(cond as Row[]).some((w) => matches(row, w))) return false;
    } else if (k === "AND") {
      if (!(cond as Row[]).every((w) => matches(row, w))) return false;
    } else if (k === "NOT") {
      const list = Array.isArray(cond) ? (cond as Row[]) : [cond as Row];
      if (list.some((w) => matches(row, w))) return false;
    } else if (!(k in row) && isPlainObject(cond) && !Object.keys(cond).some((x) => OPS.has(x))) {
      // Clé unique composée (`teamKey_provider_month`).
      if (!matches(row, cond)) return false;
    } else if (!matchValue(row[k], cond)) return false;
  }
  return true;
}

function applyData(row: Row, data: Row): Row {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (isPlainObject(v) && ("increment" in v || "decrement" in v)) {
      const cur = Number(row[k] ?? 0);
      row[k] = cur + Number(v.increment ?? 0) - Number(v.decrement ?? 0);
    } else if (isPlainObject(v) && "set" in v) row[k] = v.set;
    else row[k] = v;
  }
  return row;
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  if (!list.length) return rows;
  return [...rows].sort((a, b) => {
    for (const o of list as Array<Record<string, "asc" | "desc">>) {
      for (const [k, dir] of Object.entries(o)) {
        const c = cmp(a[k], b[k]);
        if (c !== 0) return dir === "desc" ? -c : c;
      }
    }
    return 0;
  });
}

const clone = (r: Row): Row => ({ ...r });

function createModel(name: string, rows: Row[], keyField: string) {
  const findAll = (args: { where?: Row; orderBy?: unknown; take?: number; skip?: number } = {}) => {
    let out = sortRows(rows.filter((r) => matches(r, args.where)), args.orderBy);
    if (args.skip) out = out.slice(args.skip);
    if (args.take !== undefined) out = out.slice(0, args.take);
    return out;
  };
  const create = (data: Row): Row => {
    const now = new Date();
    const row: Row = { ...(DEFAULTS[name]?.() ?? {}), createdAt: now, updatedAt: now };
    if (keyField === "id") row.id = newId();
    applyData(row, data);
    if (name === "agentValidation" && row.number === undefined) row.number = rows.length + 1;
    rows.push(row);
    return row;
  };
  return {
    rows,
    async findUnique(args: { where: Row }) {
      const r = rows.find((x) => matches(x, args.where));
      return r ? clone(r) : null;
    },
    async findUniqueOrThrow(args: { where: Row }) {
      const r = rows.find((x) => matches(x, args.where));
      if (!r) throw new Error(`${name} introuvable`);
      return clone(r);
    },
    async findFirst(args: { where?: Row; orderBy?: unknown } = {}) {
      const r = findAll({ ...args, take: 1 })[0];
      return r ? clone(r) : null;
    },
    async findMany(args: { where?: Row; orderBy?: unknown; take?: number } = {}) {
      return findAll(args).map(clone);
    },
    async count(args: { where?: Row } = {}) {
      return findAll(args).length;
    },
    async create(args: { data: Row }) {
      if (keyField !== "id" && rows.some((r) => r[keyField] === args.data[keyField]))
        throw new Error(`Unique constraint failed on ${name}.${keyField}`);
      if (name === "agentMission" && args.data.postId && rows.some((r) => r.postId === args.data.postId))
        throw new Error("Unique constraint failed on postId");
      return clone(create(args.data));
    },
    async createMany(args: { data: Row[] }) {
      for (const d of args.data) create(d);
      return { count: args.data.length };
    },
    async update(args: { where: Row; data: Row }) {
      const r = rows.find((x) => matches(x, args.where));
      if (!r) throw new Error(`${name} introuvable (update)`);
      if (name === "agentMission" && args.data.postId && rows.some((x) => x !== r && x.postId === args.data.postId))
        throw new Error("Unique constraint failed on postId");
      applyData(r, { ...args.data, updatedAt: new Date() });
      return clone(r);
    },
    async updateMany(args: { where?: Row; data: Row }) {
      const list = rows.filter((x) => matches(x, args.where));
      for (const r of list) applyData(r, { ...args.data, updatedAt: new Date() });
      return { count: list.length };
    },
    async upsert(args: { where: Row; create: Row; update: Row }) {
      const r = rows.find((x) => matches(x, args.where));
      if (r) {
        applyData(r, { ...args.update, updatedAt: new Date() });
        return clone(r);
      }
      return clone(create(args.create));
    },
    async delete(args: { where: Row }) {
      const i = rows.findIndex((x) => matches(x, args.where));
      if (i < 0) throw new Error(`${name} introuvable (delete)`);
      return rows.splice(i, 1)[0];
    },
    async deleteMany(args: { where?: Row } = {}) {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--)
        if (matches(rows[i]!, args.where)) {
          rows.splice(i, 1);
          n++;
        }
      return { count: n };
    },
    async aggregate(args: { where?: Row; _sum?: Record<string, boolean> }) {
      const list = findAll({ where: args.where });
      const sum: Record<string, number> = {};
      for (const k of Object.keys(args._sum ?? {})) sum[k] = list.reduce((s, r) => s + Number(r[k] ?? 0), 0);
      return { _sum: sum };
    },
  };
}

export type FakeModel = ReturnType<typeof createModel>;
export type FakePrisma = PrismaClient & { _tables: Record<string, Row[]>; _model(name: string): FakeModel };

const KEY_FIELDS: Record<string, string> = { setting: "key" };

/** Crée un faux client ; `seed` : lignes initiales par modèle (`{ channel: [...], setting: [...] }`). */
export function createFakePrisma(seed: Record<string, Row[]> = {}): FakePrisma {
  const tables: Record<string, Row[]> = {};
  const models = new Map<string, FakeModel>();
  const model = (name: string) => {
    let m = models.get(name);
    if (!m) {
      tables[name] ??= [];
      m = createModel(name, tables[name]!, KEY_FIELDS[name] ?? "id");
      models.set(name, m);
    }
    return m;
  };
  for (const [name, list] of Object.entries(seed)) {
    const m = model(name);
    for (const r of list) {
      const now = new Date();
      m.rows.push({ ...(DEFAULTS[name]?.() ?? {}), createdAt: now, updatedAt: now, ...(KEY_FIELDS[name] ? {} : { id: newId() }), ...r });
    }
  }
  const client: Record<string, unknown> = {
    _tables: tables,
    _model: model,
    async $transaction(arg: unknown) {
      if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(proxy);
      return Promise.all(arg as Promise<unknown>[]);
    },
  };
  const proxy: unknown = new Proxy(client, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (typeof prop !== "string" || prop.startsWith("$") || prop === "then") return undefined;
      return model(prop);
    },
  });
  return proxy as FakePrisma;
}
