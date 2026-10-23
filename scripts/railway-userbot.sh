#!/usr/bin/env bash
# =====================================================================
# Service Railway « userbot » : diagnostic, recréation propre et déploiement.
# À lancer depuis le Mac (CLI railway connectée), racine du dépôt ou n'importe où :
#   bash scripts/railway-userbot.sh diag     → étape 0 seulement, ne modifie rien
#   bash scripts/railway-userbot.sh deploy   → tout enchaîner :
#       1. arrêt du userbot local (jamais deux clients sur une même session Telegram)
#       2. suppression de l'ancien service userbot (API)
#       3. recréation d'un service VIDE, comme worker, + variables (DATABASE_URL,
#          APP_ENCRYPTION_KEY, RAILWAY_DOCKERFILE_PATH, TZ, overlap 0)
#       4. région alignée sur worker/Postgres (eu-west), restart policy ALWAYS
#       5. railway up --ci puis vérification des logs
# Tout est journalisé dans logs/railway-userbot-<date>.log (dossier ignoré par git).
# Aucune valeur de variable secrète n'est écrite dans le journal (noms seulement).
# =====================================================================
set -u
set -o pipefail

PROJECT_ID="d0a46384-0c18-4cde-9ed8-2ce381fd3ed1"
ENV_ID="844cf704-fb0d-44dc-adf6-0c142cf3ed3c"
ENV_NAME="production"
OLD_USERBOT_ID="d220491d-4035-4b34-bdc4-8aee65c6eb5f"
WORKER_ID="d40c3616-0194-4b43-a13d-77248d6edea5"
SERVICE="userbot"
MODE="${1:-deploy}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs
LOG="logs/railway-userbot-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

step() { printf '\n==================== %s ====================\n' "$*"; }
run()  { printf '\n$ %s\n' "$*"; "$@"; }
die()  { printf '\nERREUR : %s\nJournal : %s\n' "$*" "$LOG"; exit 1; }

echo "Journal : $LOG"
echo "Mode    : $MODE"
echo "Dossier : $ROOT"
date

# ---------------------------------------------------------------- préalables
step "Préalables"
[ -f pnpm-workspace.yaml ] || die "pnpm-workspace.yaml introuvable : lance le script depuis le dépôt LinkAffiPro."
[ -f apps/userbot/Dockerfile ] || die "apps/userbot/Dockerfile introuvable."
command -v railway >/dev/null 2>&1 || die "CLI railway introuvable dans le PATH."
run railway --version
run railway whoami || die "CLI railway non connectée (railway login)."
run railway status || echo "(dossier non lié ? railway link -p $PROJECT_ID -e $ENV_NAME)"

# ---------------------------------------------------------------- étape 0 : diagnostic
step "0. État actuel"
run railway service list 2>/dev/null || true

echo
echo "--- variables du worker (noms seulement, + valeur de RAILWAY_DOCKERFILE_PATH) :"
WORKER_VARS="$(railway variables --service worker --kv 2>/dev/null || true)"
printf '%s\n' "$WORKER_VARS" | cut -d= -f1 | sort | tr '\n' ' '; echo
WORKER_DOCKERFILE="$(printf '%s\n' "$WORKER_VARS" | sed -n 's/^RAILWAY_DOCKERFILE_PATH=//p' | head -1)"
echo "RAILWAY_DOCKERFILE_PATH (worker) = '${WORKER_DOCKERFILE}'"

echo
echo "--- variables du userbot actuel (noms seulement) :"
railway variables --service "$SERVICE" --kv 2>/dev/null | cut -d= -f1 | sort | tr '\n' ' '; echo

echo
echo "--- derniers déploiements du userbot :"
run railway deployment list --service "$SERVICE" --limit 5 || true
LAST_DEPLOY="$(railway deployment list --service "$SERVICE" --limit 1 --json 2>/dev/null | grep -o '"id" *: *"[0-9a-f-]*"' | head -1 | sed 's/.*"\([0-9a-f-]*\)"$/\1/')"
if [ -n "${LAST_DEPLOY}" ]; then
  echo
  echo "--- étapes du dernier déploiement ($LAST_DEPLOY) : l'étape en échec et son error expliquent le FAILED"
  railway api --allow-errors 'query($id: String!) { deploymentEvents(id: $id) { edges { node { step createdAt completedAt payload { error } } } } }' --var id="$LAST_DEPLOY" || true
fi

echo
echo "--- instances worker vs userbot (région, replicas, source) :"
railway api --allow-errors "query { w: serviceInstance(serviceId: \"$WORKER_ID\", environmentId: \"$ENV_ID\") { region numReplicas restartPolicyType source { repo image } } u: serviceInstance(serviceId: \"$OLD_USERBOT_ID\", environmentId: \"$ENV_ID\") { region numReplicas restartPolicyType source { repo image } } }" || true

if [ "$MODE" = "diag" ]; then
  step "Diagnostic terminé (aucune modification)"
  echo "Journal : $LOG"
  exit 0
fi

# ---------------------------------------------------------------- étape 1 : arrêter le userbot local
step "1. Arrêt du userbot local"
stop_local_userbot() {
  local pid cwd found=0
  for pid in $(pgrep -f 'tsx' 2>/dev/null); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    case "$cwd" in
      */apps/userbot)
        found=1
        echo "arrêt du userbot local : pid $pid (cwd $cwd)"
        kill "$pid" 2>/dev/null
        ;;
    esac
  done
  if command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | grep -qi userbot; then
    found=1
    echo "userbot géré par pm2 : arrêt + suppression pour qu'il ne redémarre pas"
    pm2 stop userbot >/dev/null 2>&1; pm2 delete userbot >/dev/null 2>&1
  fi
  return $found
}
stop_local_userbot && echo "aucun userbot local en cours d'exécution (rien à arrêter)" || true
sleep 3
# second passage : ce qui survit est tué sans ménagement
for pid in $(pgrep -f 'tsx' 2>/dev/null); do
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  case "$cwd" in */apps/userbot) echo "pid $pid encore vivant : kill -9"; kill -9 "$pid" 2>/dev/null;; esac
done
echo "processus tsx restants (doivent être hors apps/userbot) :"
pgrep -fl 'tsx' 2>/dev/null || echo "(aucun)"

# ---------------------------------------------------------------- étape 2 : supprimer l'ancien service
step "2. Suppression de l'ancien service userbot ($OLD_USERBOT_ID)"
DEL_OUT="$(railway api --allow-errors 'mutation($id: String!) { serviceDelete(id: $id) }' --var id="$OLD_USERBOT_ID" 2>&1)"
echo "$DEL_OUT"
if echo "$DEL_OUT" | grep -q '"serviceDelete" *: *true'; then
  echo "ancien service supprimé."
elif echo "$DEL_OUT" | grep -qi 'not found\|does not exist\|introuvable'; then
  echo "ancien service déjà absent."
else
  echo
  echo "La suppression par l'API n'a pas abouti. À faire dans le dashboard : service userbot → Settings → Delete Service,"
  echo "puis bannière violette « staged changes » → Deploy. Ensuite relance : bash scripts/railway-userbot.sh deploy"
  echo "(le script repartira de l'étape 2 : l'arrêt du userbot local est déjà fait, ne le relance pas.)"
  exit 2
fi

# ---------------------------------------------------------------- étape 3 : recréer un service vide
step "3. Création d'un service vide « $SERVICE »"
CREATED=0
for i in 1 2 3 4 5 6; do
  if railway add --service "$SERVICE"; then CREATED=1; break; fi
  echo "création refusée (le nom se libère ?) — nouvel essai dans 10 s ($i/6)"
  sleep 10
done
[ "$CREATED" = 1 ] || die "impossible de créer le service $SERVICE (voir ci-dessus)."

NEW_ID="$(railway api "query { project(id: \"$PROJECT_ID\") { services { edges { node { id name } } } } }" 2>/dev/null \
  | tr -d '\n ' | grep -o "{\"id\":\"[0-9a-f-]*\",\"name\":\"$SERVICE\"}" | head -1 | sed 's/.*"id":"\([0-9a-f-]*\)".*/\1/')"
echo "nouvel id du service $SERVICE : '${NEW_ID}'"

# ---------------------------------------------------------------- étape 4 : variables
step "4. Variables du service $SERVICE"
case "$WORKER_DOCKERFILE" in
  /*) DOCKERFILE_PATH="/apps/userbot/Dockerfile" ;;
  *)  DOCKERFILE_PATH="apps/userbot/Dockerfile" ;;
esac
KEY_SRC="worker"
printf '%s\n' "$WORKER_VARS" | grep -q '^APP_ENCRYPTION_KEY=' || KEY_SRC="web"
echo "RAILWAY_DOCKERFILE_PATH=$DOCKERFILE_PATH ; APP_ENCRYPTION_KEY référencée depuis le service $KEY_SRC"
run railway variables --service "$SERVICE" \
  --set "DATABASE_URL=\${{Postgres.DATABASE_URL}}" \
  --set "APP_ENCRYPTION_KEY=\${{${KEY_SRC}.APP_ENCRYPTION_KEY}}" \
  --set "RAILWAY_DOCKERFILE_PATH=${DOCKERFILE_PATH}" \
  --set "TZ=Europe/Paris" \
  --set "RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0" \
  || die "pose des variables échouée."
echo "variables posées (noms) :"
railway variables --service "$SERVICE" --kv 2>/dev/null | cut -d= -f1 | sort | tr '\n' ' '; echo

# ---------------------------------------------------------------- étape 5 : région + restart policy
step "5. Région (EU West, 1 replica) et restart policy"
instance_json() {  # région / replicas de l'instance (deux requêtes : les champs varient selon la version de l'API)
  railway api --allow-errors "query { serviceInstance(serviceId: \"$NEW_ID\", environmentId: \"$ENV_ID\") { region numReplicas restartPolicyType } }" 2>/dev/null
  railway api --allow-errors "query { serviceInstance(serviceId: \"$NEW_ID\", environmentId: \"$ENV_ID\") { multiRegionConfig } }" 2>/dev/null
}
if [ -n "$NEW_ID" ]; then
  INST="$(instance_json)"
  echo "$INST"
  REGION="$(echo "$INST" | grep -o '"region" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
  case "$REGION" in
    europe-west4*) echo "région OK : $REGION" ;;
    "") echo "ATTENTION : région illisible par l'API → vérifie dans le dashboard : userbot → Settings → Scale → Region = EU West (Amsterdam), 1 replica." ;;
    *)
      echo "région actuelle : $REGION → bascule vers eu-west"
      case "$REGION" in
        us-west*) OLD_FRIENDLY="us-west" ;;
        us-east*) OLD_FRIENDLY="us-east" ;;
        asia-southeast*) OLD_FRIENDLY="southeast-asia" ;;
        *) OLD_FRIENDLY="" ;;
      esac
      if railway scale --help >/dev/null 2>&1; then
        if [ -n "$OLD_FRIENDLY" ]; then
          run railway scale --service "$SERVICE" eu-west=1 "$OLD_FRIENDLY=0" || echo "ATTENTION : bascule de région refusée → dashboard : Settings → Scale → Region = EU West."
        else
          run railway scale --service "$SERVICE" eu-west=1 || echo "ATTENTION : bascule de région refusée → dashboard : Settings → Scale → Region = EU West."
        fi
      else
        echo "ATTENTION : pas de commande scale dans cette CLI → dashboard : Settings → Scale → Region = EU West."
      fi
      ;;
  esac
  railway api --allow-errors 'mutation($s: String!, $e: String!) { serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: { restartPolicyType: ALWAYS }) }' --var s="$NEW_ID" --var e="$ENV_ID" \
    || echo "ATTENTION : restart policy non réglée par l'API → dashboard : Settings → Restart policy = Always."
  echo "état de l'instance après réglages :"
  INST="$(instance_json)"
  echo "$INST"
  # Garde-fou : jamais plus d'un replica (deux clients sur une même session Telegram = session révoquée).
  N_REGIONS="$(echo "$INST" | tr -d ' \n' | grep -o '"numReplicas":[1-9][0-9]*' | wc -l | tr -d ' ')"
  N_LEGACY="$(echo "$INST" | grep -o '"numReplicas" *: *[0-9]*' | head -1 | grep -o '[0-9]*$')"
  if [ "${N_REGIONS:-0}" -gt 2 ] || { [ -n "$N_LEGACY" ] && [ "$N_LEGACY" -gt 1 ]; }; then
    die "plus d'un replica détecté (voir ci-dessus). Remets 1 replica dans une seule région (dashboard : Settings → Scale), puis déploie : railway up --service $SERVICE --ci"
  fi
else
  echo "ATTENTION : id du nouveau service introuvable → règle dans le dashboard : Settings → Scale → Region = EU West, 1 replica ; Restart policy = Always."
fi

# ---------------------------------------------------------------- étape 6 : déploiement
step "6. Déploiement (railway up --ci)"
echo "attendu dans les logs de build : « load build definition from apps/userbot/Dockerfile »"
if run railway up --service "$SERVICE" --ci; then
  echo "build terminé."
else
  echo "railway up a renvoyé une erreur (voir ci-dessus)."
fi
run railway deployment list --service "$SERVICE" --limit 3 || true
LAST_DEPLOY="$(railway deployment list --service "$SERVICE" --limit 1 --json 2>/dev/null | grep -o '"id" *: *"[0-9a-f-]*"' | head -1 | sed 's/.*"\([0-9a-f-]*\)"$/\1/')"
if [ -n "${LAST_DEPLOY}" ]; then
  echo "--- étapes du déploiement $LAST_DEPLOY :"
  railway api --allow-errors 'query($id: String!) { deploymentEvents(id: $id) { edges { node { step createdAt completedAt payload { error } } } } }' --var id="$LAST_DEPLOY" || true
fi

# ---------------------------------------------------------------- étape 7 : vérification
step "7. Logs d'exécution (90 s)"
echo "attendu : « programme userbot demarre » puis « comptes connectes »"
sleep 20
railway logs --service "$SERVICE" &
LOGS_PID=$!
sleep 90
kill "$LOGS_PID" 2>/dev/null
wait "$LOGS_PID" 2>/dev/null

step "Résumé"
echo "lignes clés du journal :"
grep -E 'programme userbot demarre|comptes connectes|APP_ENCRYPTION_KEY|connexion impossible|aucun compte actif|load build definition|Using detected Dockerfile|FAILED|SUCCESS|CRASHED' "$LOG" | tail -20
echo
echo "Journal complet : $LOG"
echo "Rappel : ne relance plus le userbot local (deux clients sur une même session Telegram = session révoquée)."
