/**
 * Phase 33 — la voix de Kevin (`docs/KEVIN-VOIX.md`). Tourne en CI : toute phrase ajoutée par les phases suivantes
 * doit passer `voiceCheck`.
 * 1. Les règles du contrôle (chaque règle repère son cas).
 * 2. Les couples avant / après de la charte : chaque « après » passe.
 * 3. Toutes les tables `*_VARIANTS` exportées par les modules de Kevin (boss/**, inspiration/kevin*) : chaque
 *    variante, rendue avec ses valeurs d'exemple, passe. Zéro échec.
 * 4. Parcours des littéraux des modules de Kevin : aucun texte de 4 mots ou plus avec une formule interdite, du
 *    vouvoiement ou du jargon interne (hors consignes envoyées à l'IA et blocs `voix-hors-charte`).
 * 5. Réponses IA simulées, réécriture (`rewriteForVoice`) et texte final (`kevinText`) avec une fausse IA.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FORBIDDEN_PHRASES,
  JARGON_WORDS,
  KEVIN_VOICE,
  kevinText,
  pick,
  resetVoiceRotation,
  rewriteForVoice,
  voiceCheck,
  voiceEntryTexts,
  voiceNumberProblems,
  type VoiceTable,
} from "./voice";

const BOSS_DIR = fileURLToPath(new URL(".", import.meta.url));
const SRC_DIR = join(BOSS_DIR, "..");

const codes = (text: string, opts?: Parameters<typeof voiceCheck>[1]) => voiceCheck(text, opts).problems.map((p) => p.code);

describe("voiceCheck : chaque règle de la charte", () => {
  it("formules interdites (début, fin, IA)", () => {
    for (const t of [
      "Voici les chiffres du mois.",
      "Bien sûr ! Le casino est en pause.",
      "C'est fait. N'hésite pas si besoin.",
      "C'est fait. N’hésite pas si besoin.",
      "Je reste à ta disposition.",
      "En tant qu'IA, je ne peux pas.",
      "Excellente question, je regarde.",
      "J'espère que ça t'aide.",
      "Il est important de noter que le plafond est bas.",
      "En résumé : tout va bien.",
      "Certainement, je lance.",
      "Absolument, c'est lancé.",
    ])
      expect(codes(t), t).toContain("formule");
  });

  it("vouvoiement (mais « rendez-vous » passe)", () => {
    expect(codes("Vous pouvez valider le post.")).toContain("vouvoiement");
    expect(codes("Votre canal est prêt.")).toContain("vouvoiement");
    expect(codes("Rendez-vous demain à 9 h pour le rapport.")).toEqual([]);
  });

  it("longueur : plus de 8 lignes sans demande de détail", () => {
    const long = Array.from({ length: 9 }, (_, i) => `Ligne ${i + 1}.`).join("\n");
    expect(codes(long)).toContain("longueur");
    expect(codes(long, { allowLong: true })).not.toContain("longueur");
  });

  it("puces : plus de 4 sans demande de liste", () => {
    const list = ["Les paris :", "• a", "• b", "• c", "• d", "• e"].join("\n");
    expect(codes(list)).toContain("puces");
    expect(codes(list, { allowList: true })).not.toContain("puces");
  });

  it("emojis : un au plus, jamais de série ; ✅ ⚠️ ❌ permis en tête des lignes d'une liste", () => {
    expect(codes("C'est fait 🎉 et lancé 🚀")).toContain("emojis");
    expect(codes("Top 🔥🔥")).toContain("emojis");
    expect(codes("C'est fait ✅")).toEqual([]);
    expect(codes(["Paris du jour :", "✅ PSG - OM · plus de 2,5 buts", "❌ Lyon - Lens · corners", "⚠️ Nice - Brest · en retard"].join("\n"))).toEqual([]);
  });

  it("titres et gras en série", () => {
    expect(codes("<b>Point du jour</b>\nTout va bien.")).toContain("titre");
    expect(codes("<b>a</b> <b>b</b> <b>c</b>")).toContain("gras");
    expect(codes("## Résumé\nTout va bien.")).toContain("titre");
    expect(codes("Le canal <b>Roulette Pro</b> est prêt.")).toEqual([]);
  });

  it("phrase de plus de 30 mots", () => {
    const long = `${Array.from({ length: 31 }, () => "mot").join(" ")}.`;
    expect(codes(long)).toContain("phrase_longue");
    expect(codes("Une phrase. Une autre. Une adresse https://fal.ai/dashboard/keys, ex. la clé.")).toEqual([]);
  });

  it("jargon interne : mots, statuts anglais, identifiants techniques", () => {
    for (const w of JARGON_WORDS) expect(codes(`La ${w} est prête.`), w).toContain("jargon");
    expect(codes("Le post est en PENDING.")).toContain("jargon");
    expect(codes("Statut DONE.")).toContain("jargon");
    expect(codes("Erreur BLOCKED_BUDGET.")).toContain("jargon");
    expect(codes("Le post cmh2x9k0a0001qz8y7w6v5u4t est parti.")).toContain("identifiant");
    expect(codes("Le post 3f2b1c4d-1111-2222-3333-444455556666 est parti.")).toContain("identifiant");
    // Les étiquettes, commandes et adresses ne comptent pas.
    expect(codes("Envoie la vidéo avec #casino #roulette, puis /start.")).toEqual([]);
  });

  it("même phrase que le message précédent", () => {
    expect(codes("Rien à confirmer.", { previous: "Rien à confirmer." })).toContain("repetition");
    expect(codes("Je ne trouve pas ce canal. Tu veux la liste ?", { previous: "Je ne trouve pas ce canal. Autre chose ?" })).toContain("repetition");
    expect(codes("Fait.", { previous: "C'est lancé." })).toEqual([]);
  });

  it("listes de la charte reprises dans la consigne de l'IA", () => {
    for (const f of ["Voici", "Bien sûr", "N'hésite pas", "J'espère que"]) expect(KEVIN_VOICE).toContain(f);
    for (const j of JARGON_WORDS) expect(KEVIN_VOICE).toContain(j);
    expect(FORBIDDEN_PHRASES).toContain("certainement");
  });
});

/** Couples avant / après tirés des textes réels du code (aussi dans `docs/KEVIN-VOIX.md`). */
export const BEFORE_AFTER: ReadonlyArray<readonly [string, string]> = [
  [
    "Je ne sais pas encore faire ça. Je sais par exemple :\n• Produire un pari de test en simulation (cotes d'essai, aucune vraie mise, canal Test)\n• Lister les paris du jour (match, pari, cote, état)\n• Donner le bilan des paris\n• Lister les catégories\n• Tester le bookmaker\nÉcris aide pour tout voir.",
    "Ça je sais pas encore faire : monter des shorts, l'équipe Montage arrive bientôt. Par contre je peux te sortir les stats de tes vidéos casino, tu veux ?",
  ],
  [
    "Pari de test lancé en simulation : il apparaît dans les paris du jour, puis sur le canal Test.",
    "C'est lancé. Le pari arrive sur le canal Test dans quelques minutes, pour de faux, aucune mise.",
  ],
  ["Produire un pari de test (corners) ?\nCotes d'essai, aucune vraie mise, publié sur le canal Test.", "Je te sors un pari corners sur le canal Test, pour de faux ?"],
  ["Roulette Pro : agents activés ▶️", "Ok, les agents bossent de nouveau sur Roulette Pro."],
  [
    "Canal Test, Paris sportifs, 3 jours du 25 au 27 octobre, 2 paris par jour, thème hors-jeux, simulation",
    "Je fais tourner le canal Test comme un canal paris pendant 3 jours, du 25 au 27 : 2 paris par jour sur les hors-jeux, pour de faux. Je te fais un point chaque soir.",
  ],
  [
    "J'ai bien reçu ce message transféré : je ne fais rien de ce qu'il contient. Dis-moi ce que tu veux en faire.",
    "Bien reçu ce message transféré. Je ne fais rien de ce qu'il contient : tu veux que j'en fasse quoi ?",
  ],
  ["Je n'ai rien lu dans ce message. Écris-moi ce que tu veux en quelques mots (ou aide).", "Je n'ai rien lu dans ce message. Tu me dis ce que tu veux en quelques mots ?"],
  [
    "Salut 👋 Écris « commencer » pour la mise en route, ou demande-moi par exemple « combien j'ai dépensé ce mois ? ». « aide » liste tout ce que je sais faire.",
    "Salut 👋 Tu veux faire quoi ? Par exemple « combien j'ai dépensé ce mois ? », ou « commencer » pour la mise en route.",
  ],
  ["(t'es un bot ? : pas de réponse prévue, l'IA improvisait)", "Je suis le bot de l'équipe, pas une personne. Je pilote les agents avec toi."],
  ["Trop tard : la confirmation a expiré (10 minutes). Redemande-moi si tu veux toujours.", "Trop tard, ça a expiré (10 minutes). Tu me redemandes si tu veux toujours ?"],
  ["D'accord, j'annule : rien n'a changé.", "Ok, je laisse tomber, rien n'a bougé."],
  ["Oups, je n'ai pas réussi : erreur interne. Réessaie ou écris aide.", "Oups, ça n'a pas marché de mon côté. Tu réessaies ?"],
  [
    "(La confirmation précédente est annulée : « Passer l'équipe Casino en vrai ? ».)\nMettre le casino en pause ?\nOUI pour confirmer, NON pour annuler (10 minutes).",
    "Ça remplace ta demande d'avant (« Passer l'équipe Casino en vrai ? »), elle est annulée.\nJe mets le casino en pause ?\nRéponds OUI pour confirmer ou NON pour annuler (tu as 10 minutes).",
  ],
  [
    "🧭 <b>Ce que je sais faire</b> — écris-moi comme tu parles (texte ou vocal), Kevin s'occupe du reste.\n<b>Équipes</b> : met une équipe en pause · change le niveau d'une équipe",
    "Parle-moi comme à un collègue, par écrit ou en vocal. Des phrases qui marchent :\n• Équipes : « mets le casino en pause », « passe le dating en vrai »",
  ],
  [
    "👋 <b>Kevin</b> : 2 choses bloquent.\n• Plafond vidéo de l'équipe Rencontres atteint (100 €), 1 mission arrêtée : monte-le dans Agents → Réglages ou attends le mois prochain.",
    "Petit point de <b>Kevin</b> : 2 choses bloquent.\n• L'équipe Rencontres a atteint son plafond vidéo (100 €), 1 post arrêté. Tu le montes dans Agents → Réglages ou on attend le mois prochain ?",
  ],
  [
    "Équipe Casino en pause automatique (3 missions échouées de suite) : écris « reprends casino » quand c'est réglé.",
    "L'équipe Casino s'est mise en pause toute seule après 3 posts ratés de suite. Écris « reprends casino » quand c'est réglé.",
  ],
  ["⏸ Pause générale. Simulation partout : tout part sur le canal Test.", "Tout est en pause générale. Tout est encore en test : tout part sur le canal Test."],
  ["Tout est prêt 👍 (12/12)", "C'est bon, tout est en place (12/12) ✅"],
  ["Je te l'ai déjà demandé, la voici :", "Je t'ai déjà posé la question, la revoilà :"],
  ["💶 Dépensé ce mois : 12,50 € (projection équipes à fin de mois : 40 €)", "12,50 € dépensés ce mois-ci. À ce rythme, les équipes finiront vers 40 €."],
  ["Aucun post à valider 👍", "Rien à valider pour l'instant ✅"],
  [
    "Rencontres : ▶️ active, simulation, niveau 0 · aujourd'hui 2 créés, 1 publié, 0 en attente",
    "Rencontres : active, pour de faux, niveau 0. Aujourd'hui 2 créés, 1 publié, 0 en attente.",
  ],
  ["Test de connexion à sportaza lancé : je t'envoie le résultat dans une minute.", "Je teste sportaza, je te dis dans une minute si ça passe."],
  [
    "Lancer le banc d'essai vidéo de Léa ?\nÇa dépense quelques euros chez le fournisseur vidéo (dans le plafond du mois).",
    "On teste les réglages vidéo de Léa ?\nÇa dépense quelques euros, dans le plafond du mois.",
  ],
];

describe("charte : couples avant / après", () => {
  it("au moins 20 couples, chaque « après » passe le contrôle", () => {
    expect(BEFORE_AFTER.length).toBeGreaterThanOrEqual(20);
    for (const [, after] of BEFORE_AFTER) expect(voiceCheck(after).problems, after).toEqual([]);
  });
  it("les « avant » des exemples de la charte sont bien repérés quand ils enfreignent une règle", () => {
    expect(voiceCheck(BEFORE_AFTER[0]![0]).ok).toBe(false);
    expect(voiceCheck(BEFORE_AFTER[14]![0]).ok).toBe(false);
    expect(voiceCheck(BEFORE_AFTER[15]![0]).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------- tables

/** Fichiers TypeScript (hors tests) d'un dossier, récursivement. */
function tsFiles(dir: string, filter: (f: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p, filter));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts") && filter(p)) out.push(p);
  }
  return out.sort();
}

/** Ordres de Kevin (`orders/`) : textes envoyés par Kevin (récapitulatif, demandes, rapports, vues). */
const KEVIN_ORDER_FILES = ["recap.ts", "request.ts", "reports.ts", "agent-order.ts", "current.ts", "run.ts", "tick.ts", "unmet.ts", "validate.ts", "ask.ts"].map((f) =>
  join(SRC_DIR, "orders", f),
);

/** Autres textes envoyés par Kevin : commande « agents », rapport, questions au client, propositions d'inspiration. */
const KEVIN_SHARED_FILES = [
  "orchestrator/overview.ts",
  "orchestrator/overview-contract.ts",
  "orchestrator/overview-lines.ts",
  "orchestrator/overview-results.ts",
  "admin/report-command.ts",
  "human/requests.ts",
  "inspiration/proposals.ts",
  "inspiration/apply.ts",
].map((f) => join(SRC_DIR, f));

/** Modules de Kevin : tout `boss/`, les textes de Kevin de l'inspiration, ses ordres et ses textes partagés. */
const KEVIN_FILES = [
  ...tsFiles(BOSS_DIR),
  ...tsFiles(join(SRC_DIR, "inspiration"), (f) => /\/kevin[^/]*\.ts$/.test(f)),
  ...KEVIN_ORDER_FILES,
  ...tsFiles(join(SRC_DIR, "orders", "view")),
  ...KEVIN_SHARED_FILES,
  // Relecture : textes envoyés par Kevin depuis les validations, les demandes au client et l'ancien dialogue admin.
  ...tsFiles(join(SRC_DIR, "validation")),
  ...tsFiles(join(SRC_DIR, "human"), (f) => !f.endsWith("test-kit.ts")),
  ...tsFiles(join(SRC_DIR, "admin")),
].filter((f, i, all) => all.indexOf(f) === i);

describe("textes fixes de Kevin : toutes les tables *_VARIANTS", () => {
  beforeEach(() => resetVoiceRotation());

  it("chaque variante de chaque table passe voiceCheck (zéro échec)", { timeout: 120_000 }, async () => {
    const failures: string[] = [];
    let tables = 0;
    let texts = 0;
    for (const file of KEVIN_FILES) {
      let mod: Record<string, unknown>;
      try {
        mod = (await import(file)) as Record<string, unknown>;
      } catch (err) {
        failures.push(`${relative(SRC_DIR, file)} : module illisible (${(err as Error).message.slice(0, 160)})`);
        continue;
      }
      for (const [name, value] of Object.entries(mod)) {
        if (!name.endsWith("_VARIANTS") || !value || typeof value !== "object") continue;
        tables++;
        for (const [key, entry] of Object.entries(value as VoiceTable)) {
          const { texts: all, rules } = voiceEntryTexts(entry);
          if (all.length < 1) failures.push(`${name}.${key} : aucune variante`);
          for (const t of all) {
            texts++;
            const r = voiceCheck(t, rules);
            if (!r.ok) failures.push(`${relative(SRC_DIR, file)} ${name}.${key} : ${r.problems.map((p) => `${p.code} (${p.detail})`).join(", ")}\n    « ${t} »`);
          }
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
    expect(tables).toBeGreaterThanOrEqual(10);
    expect(texts).toBeGreaterThan(200);
  });

  it("les tables des modules livrés existent (une phrase ajoutée hors table serait invisible au contrôle)", { timeout: 120_000 }, async () => {
    const expected: Record<string, string> = {
      "fast.ts": "FAST_VARIANTS",
      "confirm.ts": "CONFIRM_VARIANTS",
      "guide.ts": "GUIDE_VARIANTS",
      "help.ts": "HELP_VARIANTS",
      "nudge.ts": "NUDGE_VARIANTS",
      "answer.ts": "ANSWER_VARIANTS",
      "facts.ts": "FACTS_VARIANTS",
      "catalog-read.ts": "CATALOG_READ_VARIANTS",
      "catalog-teams.ts": "CATALOG_TEAMS_VARIANTS",
      "catalog-univers.ts": "CATALOG_UNIVERS_VARIANTS",
    };
    for (const [file, table] of Object.entries(expected)) {
      const mod = (await import(join(BOSS_DIR, file))) as Record<string, unknown>;
      expect(mod[table], `${file} → ${table}`).toBeTruthy();
    }
  });

  it("rotation : jamais deux fois de suite la même variante dans une conversation, déterministe", () => {
    const v = ["a", "b", "c"];
    const seq = Array.from({ length: 6 }, () => pick(v, "test.rotation", 42n));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    resetVoiceRotation();
    expect(Array.from({ length: 6 }, () => pick(v, "test.rotation", 42n))).toEqual(seq);
  });
});

// ------------------------------------------------------------------------------------- parcours des littéraux

/** Consignes envoyées à l'IA (pas des textes de Kevin) : variables ou fonctions dont le nom le dit. */
const PROMPT_NAME = /(SYSTEM|PROMPT|KEVIN_VOICE|KEVIN_REPORT_TONE|FORBIDDEN_PHRASES|JARGON_WORDS|_RULES$|_GUIDE$|system|Prompt|prompt|Instructions?)/;

type Literal = { file: string; line: number; text: string; short?: boolean };

function literalsOf(file: string): Literal[] {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const lines = src.split("\n");
  // Blocs `voix-hors-charte:début` … `voix-hors-charte:fin`.
  const exempt = new Set<number>();
  let open = false;
  lines.forEach((l, i) => {
    if (l.includes("voix-hors-charte:début")) open = true;
    if (open || l.includes("voix-hors-charte")) exempt.add(i + 1);
    if (l.includes("voix-hors-charte:fin")) open = false;
  });
  const out: Literal[] = [];
  const skipped = (node: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if ((ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isPropertyAssignment(n)) && n.name && PROMPT_NAME.test(n.name.getText(sf))) return true;
      if (ts.isPropertyAssignment(n) && /^(description|label|short)$/.test(n.name.getText(sf))) return true;
      if (ts.isCallExpression(n)) {
        const callee = n.expression.getText(sf);
        // Journal, erreurs, chaînes de paramètres des outils (schéma pour l'IA), requêtes.
        if (/(logger|console)\??\.|^(str|int|oneOf|bool|num)$|agentEvent|agentAudit|Error$|RegExp$|normalizeText|\.(replace|test|match|split|startsWith|includes)$/.test(callee)) return true;
      }
      if (ts.isNewExpression(n) && /Error|RegExp/.test(n.expression.getText(sf))) return true;
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return true;
    }
    return false;
  };
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" x ");
    if (text !== null) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const words = text.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
      // Textes de moins de 4 mots aussi (« mission annulée », « Oups ») : seulement s'ils ressemblent à du français
      // écrit (une espace, un accent ou une ponctuation finale), jamais une clé ou un identifiant du code.
      const prose = words.length >= 4 || (words.length >= 1 && (/\s/.test(text.trim()) || /[à-ÿÀ-Ÿ]/u.test(text) || /[.!?…]$/.test(text.trim())));
      if (prose && !text.trim().startsWith("[") && !exempt.has(line) && !skipped(node)) out.push({ file, line, text, short: words.length < 4 });
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("parcours des modules de Kevin : aucun littéral hors charte", () => {
  it("aucune formule interdite, aucun vouvoiement, aucun mot de jargon dans un texte de Kevin", { timeout: 60_000 }, () => {
    const failures: string[] = [];
    for (const file of KEVIN_FILES) {
      for (const lit of literalsOf(file)) {
        // Texte court : formules et mots de jargon seulement (un statut anglais isolé y est souvent du code).
        const codes = lit.short ? ["formule", "vouvoiement"] : ["formule", "vouvoiement", "jargon", "identifiant"];
        const bad = voiceCheck(lit.text, { allowList: true, allowLong: true }).problems.filter(
          (p) => codes.includes(p.code) || (lit.short && p.code === "jargon" && JARGON_WORDS.includes(p.detail)),
        );
        if (bad.length) failures.push(`${relative(SRC_DIR, lit.file)}:${lit.line} ${bad.map((p) => `${p.code} (${p.detail})`).join(", ")} « ${lit.text.slice(0, 120)} »`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

// ----------------------------------------------------------------------------------- textes écrits par l'IA

/** Réponses IA simulées (du style attendu) : toutes passent. */
const AI_SAMPLES = [
  "Ce mois-ci tu as dépensé 42,10 €. L'équipe Rencontres en a pris 30 €, surtout en vidéos.",
  "Le casino tourne bien : 12 posts cette semaine, 340 vues et 18 clics.",
  "Rien n'est sorti sur Zone Interdite ce matin : l'équipe Casino est en pause. Tu veux que je la relance ?",
  "Deux posts attendent ton feu vert, le n°12 et le n°13. Tu veux les voir ?",
  "Je n'ai pas ce chiffre pour l'instant.",
  "C'est lancé. Je te dis quand c'est prêt.",
  "Fait. Le canal Test publie 3 posts par jour à partir de demain.",
  "Les paris de la semaine : 9 gagnés, 5 perdus, 64,3 % de réussite.",
  "L'équipe Algorithme propose de passer Roulette Pro à 4 posts par jour. Je l'applique ?",
  "Léa a encore 7 vidéos sources pas utilisées. Ça tient une bonne semaine.",
  "Ta pub « Casino octobre » coûte 3,20 € par inscription, au-dessus de ton seuil de 2,50 €. Je te conseille de la couper.",
  "Le dernier test de connexion à Sportaza a échoué : mot de passe refusé. Tu me renvoies le bon ?",
  "Pas de question en attente, tout est répondu ✅",
  "Paris du jour :\n✅ PSG - OM · plus de 2,5 buts à 1,85\n❌ Lyon - Lens · corners à 2,10\n⏳ Nice - Brest · tirs cadrés à 1,70",
  "Hier : 6 posts publiés, 1 refusé. Aujourd'hui il en reste 4 à partir.",
];

type FakeWriter = { write(req: { system: string; user: string }): Promise<{ text: string; costCents: number }>; calls: { system: string; user: string }[] };
function fakeWriter(out: string | ((user: string) => string), costCents = 1): FakeWriter {
  const calls: FakeWriter["calls"] = [];
  return {
    calls,
    async write(req) {
      calls.push(req);
      return { text: typeof out === "string" ? out : out(req.user), costCents };
    },
  };
}

describe("textes écrits par l'IA", () => {
  it("une série de réponses IA simulées passe le contrôle", () => {
    for (const t of AI_SAMPLES) expect(voiceCheck(t).problems, t).toEqual([]);
  });

  it("réécriture : charte et motif envoyés, texte accepté s'il passe et garde les chiffres", async () => {
    const bad = "Bien sûr ! Voici : tu as dépensé 42,10 € ce mois-ci. N'hésite pas !";
    const llm = fakeWriter("Tu as dépensé 42,10 € ce mois-ci.");
    const r = await rewriteForVoice(llm, bad, voiceCheck(bad).problems);
    expect(r.text).toBe("Tu as dépensé 42,10 € ce mois-ci.");
    expect(llm.calls[0]!.system).toContain(KEVIN_VOICE);
    expect(llm.calls[0]!.user).toContain("formule interdite");
    expect(llm.calls[0]!.user).toContain(bad);
  });

  it("réécriture refusée : chiffre ajouté ou modifié, ou encore hors charte", async () => {
    const bad = "Voici : 42,10 € dépensés.";
    expect((await rewriteForVoice(fakeWriter("Tu as dépensé 45 € ce mois-ci."), bad, voiceCheck(bad).problems)).text).toBeNull();
    expect((await rewriteForVoice(fakeWriter("Tu as dépensé 42,10 € sur 3 équipes."), bad, voiceCheck(bad).problems)).text).toBeNull();
    expect((await rewriteForVoice(fakeWriter("Bien sûr, 42,10 € dépensés."), bad, voiceCheck(bad).problems)).text).toBeNull();
    expect((await rewriteForVoice(null, bad, [])).text).toBeNull();
    const failing = { write: async () => Promise.reject(new Error("plafond")) };
    expect((await rewriteForVoice(failing, bad, [])).text).toBeNull();
  });

  it("kevinText : brouillon conforme gardé, sinon une réécriture, sinon le secours", async () => {
    const facts = { totalEuros: 42.1 };
    const ok = await kevinText({ llm: fakeWriter("x"), draft: "Tu as dépensé 42,10 € ce mois-ci.", facts, fallback: "Secours." });
    expect(ok).toMatchObject({ source: "draft", text: "Tu as dépensé 42,10 € ce mois-ci." });

    const llm = fakeWriter("42,10 € dépensés ce mois-ci.");
    const rewritten = await kevinText({ llm, draft: "Bien sûr ! 42,10 € dépensés ce mois-ci.", facts, fallback: "Secours." });
    expect(rewritten).toMatchObject({ source: "rewrite", text: "42,10 € dépensés ce mois-ci." });
    expect(llm.calls).toHaveLength(1);

    const still = await kevinText({ llm: fakeWriter("Voici 42,10 €."), draft: "Bien sûr ! 42,10 €.", facts, fallback: "Secours." });
    expect(still).toMatchObject({ source: "fallback", text: "Secours." });

    // Chiffre absent des faits dans le brouillon : secours directement (jamais réécrit).
    const invented = fakeWriter("x");
    expect(await kevinText({ llm: invented, draft: "Tu as dépensé 99 €.", facts, fallback: "Secours." })).toMatchObject({ source: "fallback" });
    expect(invented.calls).toHaveLength(0);

    expect(await kevinText({ llm: null, draft: "", fallback: "Secours." })).toMatchObject({ source: "fallback", text: "Secours." });
    expect(await kevinText({ llm: null, draft: "Rien à confirmer.", previous: "Rien à confirmer.", fallback: "Je n'ai rien en attente de ton OUI." })).toMatchObject({
      source: "fallback",
    });
  });

  it("contrôle des chiffres de la réécriture : ceux du texte d'origine et des faits seulement", () => {
    expect(voiceNumberProblems("12 posts, 340 vues.", { original: "Voici : 12 posts et 340 vues." })).toEqual([]);
    expect(voiceNumberProblems("13 posts.", { original: "12 posts." })).not.toEqual([]);
    expect(voiceNumberProblems("deux fois plus de vues.", { original: "12 posts." })).not.toEqual([]);
    expect(voiceNumberProblems("42,1 €.", { facts: { euros: 42.1 } })).toEqual([]);
  });
});
