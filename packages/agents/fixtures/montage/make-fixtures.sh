#!/usr/bin/env bash
# Phase 28 (chantier B) : fabrique les vidéos de test du montage (5 s chacune, < 1 Mo grâce à -crf 35).
#   casino.mp4        mire 1920x1080, 30 images/s, son 440 Hz (cas normal ; caméra, format, sous-titres, texte)
#   black-middle.mp4  la même avec une seconde entièrement noire au milieu (de 2 s à 3 s) : le contrôle qualité la voit
#   silent.mp4        la même avec un silence complet : le contrôle qualité le voit
#   sample.srt        sous-titres d'exemple (horodatage relatif au début du short), écrit à la main, pas par ce script
# ffmpeg : FFMPEG=<binaire> si donné, sinon `ffmpeg` s'il existe, sinon l'image Docker (packages/agents/scripts/ffmpeg-docker.sh).
# Relancer : bash packages/agents/fixtures/montage/make-fixtures.sh  (les fichiers sont écrasés ; résultat identique
# à l'octet près non garanti, sans importance pour les tests qui ne lisent que durée, taille, codecs, noir et silence).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${FFMPEG:-}" ]; then FF="$FFMPEG"
elif command -v ffmpeg >/dev/null 2>&1; then FF=ffmpeg
else FF="$DIR/../../scripts/ffmpeg-docker.sh"; fi

COMMON=(-hide_banner -loglevel error -nostdin -y)
ENC=(-c:v libx264 -crf 35 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 64k -shortest -movflags +faststart)

"$FF" "${COMMON[@]}" -f lavfi -i testsrc=duration=5:size=1920x1080:rate=30 \
  -f lavfi -i sine=frequency=440:duration=5:sample_rate=48000 "${ENC[@]}" "$DIR/casino.mp4"

"$FF" "${COMMON[@]}" -f lavfi -i testsrc=duration=5:size=1920x1080:rate=30 \
  -f lavfi -i sine=frequency=440:duration=5:sample_rate=48000 \
  -vf "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,2,3)'" "${ENC[@]}" "$DIR/black-middle.mp4"

"$FF" "${COMMON[@]}" -f lavfi -i testsrc=duration=5:size=1920x1080:rate=30 \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 -t 5 "${ENC[@]}" "$DIR/silent.mp4"

ls -l "$DIR"/*.mp4
