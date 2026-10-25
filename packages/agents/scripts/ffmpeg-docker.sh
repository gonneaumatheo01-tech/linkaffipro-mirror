#!/usr/bin/env bash
# Phase 28 (chantier B) : ffmpeg RÉEL pour les tests et les fixtures du montage, sur un Mac sans ffmpeg ni Homebrew.
# Lance ffmpeg dans une image Docker locale `lap-ffmpeg` (alpine:3.22 + ffmpeg + polices Noto, Open Sans, FreeFont,
# proche de l'image du worker), construite au premier appel si elle manque.
# Les dossiers du dépôt, le dossier courant, /tmp et $TMPDIR sont montés AU MÊME CHEMIN : les chemins passés à ffmpeg
# restent valables tels quels. Les fichiers sont écrits avec l'utilisateur du Mac.
# Usage : packages/agents/scripts/ffmpeg-docker.sh <arguments ffmpeg>   (ffprobe-docker.sh pour ffprobe)
# Tests : MONTAGE_FFMPEG=docker npx vitest run src/montage/ffmpeg
set -euo pipefail
TOOL="${LAP_FFMPEG_TOOL:-ffmpeg}"
IMAGE="${LAP_FFMPEG_IMAGE:-lap-ffmpeg}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  printf 'FROM alpine:3.22\nRUN apk add --no-cache ffmpeg font-noto font-opensans ttf-freefont\n' \
    | docker build -q -t "$IMAGE" - >/dev/null
fi

MOUNTS=(-v "$ROOT:$ROOT" -v "/tmp:/tmp")
case "$PWD" in "$ROOT"|"$ROOT"/*|/tmp|/tmp/*) ;; *) MOUNTS+=(-v "$PWD:$PWD") ;; esac
if [ -n "${TMPDIR:-}" ] && [ -d "$TMPDIR" ]; then
  T="${TMPDIR%/}"
  case "$T" in /tmp|/tmp/*) ;; *) MOUNTS+=(-v "$T:$T") ;; esac
fi

# `exec` : le processus suivi par l'exécuteur Node est le client Docker ; un SIGTERM (délai dépassé) est relayé au
# conteneur (--sig-proxy par défaut, --init pour que ffmpeg le reçoive), --rm l'efface ensuite.
exec docker run --rm --init --user "$(id -u):$(id -g)" "${MOUNTS[@]}" -w "$PWD" --entrypoint "$TOOL" "$IMAGE" "$@"
