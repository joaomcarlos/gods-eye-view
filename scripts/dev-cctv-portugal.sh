#!/usr/bin/env bash
# Launch God's Eye View with the Cascais/Lisbon (Portugal) CCTV source pack:
# 78 MEO Beachcam + 2 SkylineWebcams + 3 IPCamLive HLS feeds + 39 YouTube embeds + 9 Windy webcam snapshots + 4 Lusoponte bridge traffic cams, plus
# Via Verde/Brisa highway traffic cameras (A1/A2/A3/A4) loaded live from the
# Via Verde public traffic-info API.
#
# This is a thin wrapper over dev-cctv.sh — it only sets the Portugal source
# pack defaults and delegates, so all the Google Maps / OpenSky credential
# resolution logic stays in one place. Override any var to customize.
set -euo pipefail

export CCTV_SOURCES_FILE="${CCTV_SOURCES_FILE:-config/cctv_sources.portugal.json}"
# The Portugal pack is a self-contained file pack; disable the live Austin /
# Caltrans / TfL open-data discovery so only the Portugal cameras register.
export CCTV_PREFER_AUSTIN="${CCTV_PREFER_AUSTIN:-0}"
# Enable the Via Verde/Brisa highway camera loader (live API fetch, complements
# the static file pack). Set CCTV_VIAVERDE_ENABLED=0 to disable.
export CCTV_VIAVERDE_ENABLED="${CCTV_VIAVERDE_ENABLED:-1}"
export CCTV_MAX_SOURCES="${CCTV_MAX_SOURCES:-150}"

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-cctv.sh" "$@"
