#!/usr/bin/env bash
# Phase 28 (chantier B) : ffprobe RÉEL dans l'image Docker `lap-ffmpeg` (voir ffmpeg-docker.sh).
set -euo pipefail
LAP_FFMPEG_TOOL=ffprobe exec "$(dirname "${BASH_SOURCE[0]}")/ffmpeg-docker.sh" "$@"
