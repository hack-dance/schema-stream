#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
composition_root="$repository_root/media/schema-stream-demo"
asset_root="$repository_root/docs/assets"
master="$asset_root/schema-stream-demo.mp4"

mkdir -p "$asset_root"

cd "$composition_root"
bun x --yes hyperframes@0.7.54 check --strict
bun x --yes hyperframes@0.7.54 render \
  --output "$master" \
  --quality high \
  --fps 30

cd "$repository_root"
ffmpeg -y -hide_banner -i "$master" \
  -filter_complex "fps=15,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  -loop 0 \
  "$asset_root/schema-stream-demo.gif"

ffmpeg -y -hide_banner -ss 13.45 -i "$master" \
  -frames:v 1 \
  -update 1 \
  -q:v 2 \
  "$asset_root/schema-stream-demo-poster.jpg"

ffprobe -v error \
  -select_streams v:0 \
  -show_entries stream=width,height,avg_frame_rate,nb_frames \
  -show_entries format=duration,size \
  -of default=noprint_wrappers=1 \
  "$master"
