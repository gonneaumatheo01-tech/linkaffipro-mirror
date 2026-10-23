#!/usr/bin/env bash
# =====================================================================
# Mise en production de la phase 18 (comptes Telegram réels) — à lancer depuis le Mac, CLI railway connectée.
#   bash scripts/railway-phase18-prod.sh deploy
#       1. vérifie que la migration manquante est bien dans le dépôt
#       2. railway up web  → attend le déploiement (les migrations Prisma s'appliquent au démarrage de web)
#          → vérifie /api/health et montre les lignes « migration » des logs
#       3. railway up worker → attend le déploiement → /api/health
#       4. montre l'état du userbot (attendu : « aucun compte actif » tant qu'aucun compte n'est relié en prod)
#   bash scripts/railway-phase18-prod.sh fille
#       passe la persona Léa de la prod en identité « une fille » (honnête : dit être une IA si on le lui demande ; textes du Mac)
#   bash scripts/railway-phase18-prod.sh diag
#       pourquoi le userbot ne répond pas : logs filtrés + état en base (lecture seule)
#   bash scripts/railway-phase18-prod.sh up
#       typecheck + tests du userbot, puis railway up du service userbot (nouveau code), attente, logs
#   bash scripts/railway-phase18-prod.sh restart
#       liste les comptes Telegram de la base de prod, redémarre le conteneur userbot (sans rebuild), montre ses logs
#   bash scripts/railway-phase18-prod.sh check
#       état du service userbot (déploiements + 60 s de logs), ne change rien
#   bash scripts/railway-phase18-prod.sh userbot
#       à lancer APRÈS avoir relié le compte dans Réglages → Comptes Telegram (prod) :
#       arrête le userbot local, redéploie le service userbot, montre ses logs (attendu : « comptes connectes »).
# Journal : logs/railway-phase18-<date>.log (dossier ignoré par git, aucun secret dedans).
# =====================================================================
set -u
set -o pipefail

MODE="${1:-deploy}"
HEALTH_URL="https://app.linkaffipro.com/api/health"
MIGRATION_DIR="packages/db/prisma/migrations/20261022120000_phase18_account_dm_welcome_dm"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs
LOG="logs/railway-phase18-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

step() { printf '\n==================== %s ====================\n' "$*"; }
run()  { printf '\n$ %s\n' "$*"; "$@"; }
die()  { printf '\nERREUR : %s\nJournal : %s\n' "$*" "$LOG"; exit 1; }

# Attend que le dernier déploiement d'un service soit SUCCESS (ou échoue). $1 = service, $2 = minutes max.
wait_deploy() {
  local svc="$1" max="$2" i line
  for i in $(seq 1 $((max * 4))); do
    line="$(railway deployment list --service "$svc" --limit 1 2>/dev/null | grep -E '[0-9a-f-]{36}' | head -1)"
    case "$line" in
      *SUCCESS*) echo "$svc : $line"; return 0 ;;
      *FAILED*|*CRASHED*) echo "$svc : $line"; return 1 ;;
    esac
    sleep 15
  done
  echo "$svc : toujours pas SUCCESS après $max min ($line)"; return 1
}

# Capture N secondes de logs d'un service. $1 = service, $2 = secondes.
tail_logs() {
  local svc="$1" secs="$2" pid
  railway logs --service "$svc" &
  pid=$!
  sleep "$secs"
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
}

health() {
  echo "GET $HEALTH_URL"
  curl -fsS --max-time 15 "$HEALTH_URL" || echo "(health injoignable pour l'instant)"
  echo
}

echo "Journal : $LOG"
echo "Mode    : $MODE"
date

step "Préalables"
[ -f pnpm-workspace.yaml ] || die "lance le script depuis le dépôt LinkAffiPro."
command -v railway >/dev/null 2>&1 || die "CLI railway introuvable."
run railway whoami || die "CLI railway non connectée."

# ---------------------------------------------------------------- mode fille : passe la persona Léa en identité « une fille » (textes du Mac, sans mode illusion) en PROD
if [ "$MODE" = "fille" ]; then
  step "Persona Léa en PROD → identité « une fille », 23 ans, personnalité / ton / exemples de style du Mac (sans mode illusion)"
  [ -f scripts/persona-fille.mjs ] || die "scripts/persona-fille.mjs introuvable."
  echo "(la persona est relue à chaque message : effet immédiat, sans redémarrage)"
  railway ssh --service userbot -- node --import tsx --input-type=module -e "$(cat scripts/persona-fille.mjs)" 2>&1 | tail -30 \
    || die "mise à jour impossible par ssh (voir ci-dessus)."
  step "Résumé"
  grep -E 'AVANT|APRES|INTROUVABLE' "$LOG" | cut -c1-400
  echo "Journal : $LOG"
  exit 0
fi

# ---------------------------------------------------------------- mode diag : pourquoi le userbot ne répond pas (lecture seule)
if [ "$MODE" = "diag" ]; then
  step "Dernières lignes des logs du userbot (messages reçus, raisons de silence, erreurs)"
  TMP_UB="logs/.ub-logs-$$.txt"
  railway logs --service userbot -n 400 > "$TMP_UB" 2>&1 &
  LP=$!; sleep 25; kill "$LP" 2>/dev/null; wait "$LP" 2>/dev/null
  grep -E 'message recu|pas de reponse|reason|erreur|error|vocal|compte connecte|comptes connectes|arret|demarre|pas de bot fantome|FLOOD|AUTH_KEY' "$TMP_UB" | tail -40 \
    || echo "(aucune ligne utile dans les 400 dernières lignes)"
  rm -f "$TMP_UB"

  step "État en base de PROD : compte, persona, clé Venice, dernières conversations (lecture seule)"
  JS='import { prisma } from "@linkaffipro/db";
const accounts = await prisma.telegramUserAccount.findMany({ select: { label: true, status: true, isActive: true, lastError: true, personaId: true, persona: { select: { name: true, isActive: true } }, bot: { select: { id: true, name: true, mode: true, isActive: true, personaId: true } } } });
console.log("COMPTES :", JSON.stringify(accounts, null, 2));
const setting = await prisma.setting.findUnique({ where: { key: "assistant.venice" } });
const v = (setting?.value ?? {});
console.log("REGLAGE assistant.venice :", JSON.stringify({ present: !!setting, cleChiffreePresente: !!v.apiKeyEncrypted, activation: v.activation ?? null, defaultModel: v.defaultModel ?? null, monthlyCapEur: v.monthlyCapEur ?? null }));
const since = new Date(Date.now() - 3 * 3600 * 1000);
for (const a of accounts) {
  if (!a.bot) continue;
  const convs = await prisma.conversation.findMany({ where: { botId: a.bot.id, updatedAt: { gte: since } }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, status: true, stage: true, stoppedAt: true, isMinor: true, closedReason: true, personaId: true, memberMessages: true, assistantTurns: true, lastInboundAt: true, lastAssistantAt: true, retryAt: true } });
  console.log("CONVERSATIONS (3 h) du bot", a.bot.name, ":", JSON.stringify(convs, null, 2));
  for (const c of convs) {
    const msgs = await prisma.conversationMessage.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: "desc" }, take: 6, select: { direction: true, author: true, createdAt: true, turnId: true, claimedAt: true, text: true, media: true } });
    console.log("  messages", c.id, ":", JSON.stringify(msgs.map((m) => ({ ...m, text: (m.text ?? "").slice(0, 60) })), null, 2));
    const events = await prisma.conversationEvent.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: "desc" }, take: 8 });
    console.log("  evenements", c.id, ":", JSON.stringify(events, null, 2).slice(0, 2500));
  }
  const usage = await prisma.aiConversationUsage.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5, select: { createdAt: true, ok: true, error: true, purpose: true, model: true, conversationId: true } });
  console.log("APPELS IA (3 h) :", JSON.stringify(usage, null, 2));
}
await prisma.$disconnect();'
  railway ssh --service userbot -- node --import tsx --input-type=module -e "$JS" 2>&1 | tail -150 \
    || echo "(lecture impossible par ssh)"

  step "Résumé"
  grep -E 'pas de reponse|reason|erreur|error|cleChiffreePresente|"isActive"|"persona"|no_persona|no_api_key' "$LOG" | tail -20
  echo "Journal : $LOG"
  exit 0
fi

# ---------------------------------------------------------------- mode up : redéploie le code du userbot (build), puis logs
if [ "$MODE" = "up" ]; then
  step "Contrôle local du userbot (typecheck + tests)"
  run pnpm --filter userbot typecheck || die "typecheck du userbot rouge : rien n'a été déployé."
  run pnpm --filter userbot test || die "tests du userbot rouges : rien n'a été déployé."

  step "Déploiement du userbot (railway up --ci : build 3 à 15 min selon Railway)"
  echo "attendu dans le build : « load build definition from apps/userbot/Dockerfile » et l'installation de ffmpeg"
  run railway up --service userbot --ci || die "build du userbot en échec (voir ci-dessus) ; l'ancien conteneur continue de tourner."
  wait_deploy userbot 12 || echo "ATTENTION : pas encore SUCCESS ; relance « bash scripts/railway-phase18-prod.sh check » plus tard."
  sleep 15

  step "Logs du userbot (60 s) — attendu : « comptes connectes … connectes=1 » (et aucun « ffmpeg absent »)"
  tail_logs userbot 60

  step "Résumé"
  grep -E 'SUCCESS|FAILED|CRASHED|comptes connectes|compte connecte|ffmpeg|vocal|connexion impossible' "$LOG" | tail -12
  echo "Journal : $LOG"
  exit 0
fi

# ---------------------------------------------------------------- mode activate : active le compte (bouton « Activer » cassé avant le correctif), puis restart
if [ "$MODE" = "activate" ]; then
  step "Activation du compte Telegram en PROD (isActive) + persona du bot si le compte n'en a pas"
  JS='import { prisma } from "@linkaffipro/db";
const rows = await prisma.telegramUserAccount.findMany({ where: { status: "ACTIVE" }, select: { id: true, label: true, isActive: true, personaId: true, botId: true, bot: { select: { name: true, personaId: true, persona: { select: { name: true, isActive: true } } } } } });
for (const a of rows) {
  const data = {};
  if (!a.isActive) data.isActive = true;
  if (!a.personaId && a.bot?.personaId) data.personaId = a.bot.personaId;
  if (Object.keys(data).length) await prisma.telegramUserAccount.update({ where: { id: a.id }, data });
  console.log(JSON.stringify({ compte: a.label, bot: a.bot?.name ?? null, avant: { isActive: a.isActive, personaId: a.personaId }, modifie: data, personaDuBot: a.bot?.persona ? { nom: a.bot.persona.name, active: a.bot.persona.isActive } : null }, null, 2));
}
if (rows.length === 0) console.log("AUCUN compte avec status ACTIVE en base de prod.");
await prisma.$disconnect();'
  railway ssh --service userbot -- node --import tsx --input-type=module -e "$JS" 2>&1 | tail -40 \
    || die "lecture/écriture impossible par ssh (voir ci-dessus)."
  MODE="restart"
fi

# ---------------------------------------------------------------- mode restart : relit les comptes (le userbot ne les lit qu'au démarrage)
if [ "$MODE" = "restart" ]; then
  step "Comptes Telegram présents dans la base de PROD (lus depuis le conteneur userbot)"
  echo "attendu : status ACTIVE et isActive true ; sinon le userbot ne démarre pas ce compte."
  JS='import { prisma } from "@linkaffipro/db"; const rows = await prisma.telegramUserAccount.findMany({ select: { label: true, status: true, isActive: true, lastError: true, botId: true, personaId: true, updatedAt: true } }); console.log(JSON.stringify(rows, null, 2)); await prisma.$disconnect();'
  railway ssh --service userbot -- node --import tsx --input-type=module -e "$JS" 2>&1 | tail -40 \
    || echo "(lecture impossible par ssh : on redémarre quand même, les logs diront le nombre de comptes)"

  step "Redémarrage du conteneur userbot (sans rebuild)"
  if ! railway service restart --service userbot --yes 2>&1; then
    railway restart --service userbot --yes 2>&1 || die "redémarrage refusé par la CLI : dans le dashboard, service userbot → ⋮ → Restart."
  fi
  echo "redémarré ; attente 30 s puis logs (attendu : « comptes connectes … connectes=1 »)"
  sleep 30
  tail_logs userbot 60

  step "Résumé"
  grep -E '"status"|"isActive"|"lastError"|programme userbot demarre|comptes connectes|aucun compte actif|connexion impossible|AUTH_KEY|FLOOD' "$LOG" | tail -12
  echo "Journal : $LOG"
  exit 0
fi

# ---------------------------------------------------------------- mode check : état seulement, ne change rien
if [ "$MODE" = "check" ]; then
  step "Déploiements du userbot"
  run railway deployment list --service userbot --limit 3 || true
  LAST="$(railway deployment list --service userbot --limit 1 2>/dev/null | grep -E '[0-9a-f-]{36}' | head -1)"
  case "$LAST" in
    *QUEUED*|*INITIALIZING*|*BUILDING*|*DEPLOYING*|*WAITING*)
      echo "le dernier déploiement est encore en cours : attente jusqu'à 15 min (contrôle toutes les 15 s)…"
      wait_deploy userbot 15 || echo "ATTENTION : toujours pas terminé après 15 min (Railway lent aujourd'hui) : relance « check » plus tard."
      sleep 15
      ;;
  esac
  step "Logs du userbot (60 s) — attendu : « comptes connectes » avec connectes >= 1"
  tail_logs userbot 60
  step "Résumé"
  grep -E 'SUCCESS|FAILED|CRASHED|BUILDING|DEPLOYING|programme userbot demarre|comptes connectes|aucun compte actif|connexion impossible|APP_ENCRYPTION_KEY|does not exist|AUTH_KEY|FLOOD' "$LOG" | tail -10
  echo "Journal : $LOG"
  exit 0
fi

# ---------------------------------------------------------------- mode userbot
if [ "$MODE" = "userbot" ]; then
  step "Arrêt du userbot local (jamais deux clients sur une même session)"
  pkill -f -- '--import tsx' 2>/dev/null && echo "processus --import tsx arrêtés" || echo "aucun processus --import tsx"
  sleep 2
  pgrep -fl 'import tsx' 2>/dev/null && echo "ATTENTION : il en reste (Ctrl+C dans leur terminal)" || echo "plus aucun userbot local"

  step "Redéploiement du service userbot (relit les comptes au démarrage)"
  run railway redeploy --service userbot --yes || die "redeploy refusé."
  echo "(un redeploy reconstruit l'image : 3 à 10 min selon la file d'attente Railway)"
  wait_deploy userbot 12 || echo "ATTENTION : toujours pas SUCCESS ; relance plus tard « bash scripts/railway-phase18-prod.sh check » pour voir l'état sans rien changer."

  step "Logs du userbot (90 s) — attendu : « comptes connectes » avec connectes >= 1"
  sleep 20
  tail_logs userbot 90

  step "Résumé"
  grep -E 'programme userbot demarre|comptes connectes|aucun compte actif|connexion impossible|APP_ENCRYPTION_KEY|does not exist' "$LOG" | tail -8
  echo "Journal : $LOG"
  exit 0
fi

# ---------------------------------------------------------------- mode deploy
[ "$MODE" = "deploy" ] || die "mode inconnu « $MODE » : deploy | fille | diag | up | activate | restart | check | userbot (rien n'a été fait)."
step "1. Migration manquante présente ?"
[ -f "$MIGRATION_DIR/migration.sql" ] || die "$MIGRATION_DIR/migration.sql introuvable."
echo "ok : $MIGRATION_DIR"
echo "dernières migrations du dépôt :"
ls packages/db/prisma/migrations | grep -E '^2026' | tail -4

step "1b. Contrôle local avant d'envoyer (typecheck des 3 applis, comme le build Railway ; lint à titre indicatif)"
echo "Le build Railway de web s'arrête sur la moindre erreur TypeScript ; on vérifie ici d'abord (1 à 3 min)."
run pnpm exec turbo run typecheck --filter=web --filter=worker --filter=userbot \
  || die "typecheck rouge : corrige les erreurs ci-dessus (ou demande-le à Claude Code), puis relance. Rien n'a été déployé."
echo "typecheck vert."
if run pnpm lint; then echo "lint vert."; else echo "ATTENTION : lint rouge (n'empêche pas le déploiement, mais le CI GitHub restera rouge : à corriger ensuite)."; fi

step "2. Déploiement de web (les migrations s'appliquent au démarrage)"
UP_WEB="logs/.up-web-$$.txt"
railway up --service web --ci 2>&1 | tee "$UP_WEB"
UP_RC=${PIPESTATUS[0]}
if [ "$UP_RC" != 0 ]; then
  if grep -qE 'Type error|Failed to compile|error TS' "$UP_WEB"; then
    rm -f "$UP_WEB"; die "erreur TypeScript pendant le build (voir ci-dessus). Rien d'autre n'a été touché."
  fi
  rm -f "$UP_WEB"
  echo
  echo "Le build s'est arrêté sans erreur de code : c'est très probablement l'incident Railway en cours"
  echo "(https://status.railway.com : builds en échec, files d'attente). Ne relance pas en boucle : attends 15-30 min,"
  echo "regarde la page d'état, puis relance exactement la même commande. Rien d'autre n'a été touché."
  die "build de web en échec (incident Railway probable)."
fi
rm -f "$UP_WEB"
echo "build terminé, attente du démarrage (migrations + seed + Next)…"
wait_deploy web 10 || die "web n'est pas passé SUCCESS : vérifie « railway logs --service web » avant de continuer."
echo "lignes de migration dans les logs récents de web :"
TMP_WEB="logs/.web-logs-$$.txt"
railway logs --service web -n 400 > "$TMP_WEB" 2>&1 &
LP=$!; sleep 25; kill "$LP" 2>/dev/null; wait "$LP" 2>/dev/null
grep -iE 'migrat|applying|prisma|No pending' "$TMP_WEB" | tail -20 || echo "(aucune ligne de migration visible : si « No pending migrations » n'apparaît pas non plus, vérifie railway logs --service web)"
rm -f "$TMP_WEB"
health

step "3. Déploiement de worker"
run railway up --service worker --ci || die "build de worker en échec ; web est déjà à jour."
wait_deploy worker 10 || die "worker n'est pas passé SUCCESS : vérifie « railway logs --service worker »."
sleep 20
health

step "4. État du userbot en prod (60 s de logs)"
echo "attendu maintenant : « aucun compte actif » (la base de prod n'a encore aucun compte relié)"
tail_logs userbot 60

step "Résumé"
grep -E 'SUCCESS|FAILED|CRASHED|"status"|aucun compte actif|comptes connectes|does not exist|Applying migration' "$LOG" | tail -15
cat <<'FIN'

Suite, à la main (2 minutes) :
  1. https://app.linkaffipro.com → Réglages → Comptes Telegram : relier le compte (numéro, code reçu dans Telegram,
     mot de passe si validation en deux étapes), choisir la persona / le bot, activer.
  2. Puis :  bash scripts/railway-phase18-prod.sh userbot
     (arrête le userbot du Mac, redéploie le service, montre « comptes connectes »).
  3. Ne plus relancer le userbot local. L'ancienne session peut être fermée depuis Telegram → Appareils.
FIN
echo "Journal : $LOG"
