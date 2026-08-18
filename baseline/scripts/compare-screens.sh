#!/usr/bin/env bash
# Compare freshly captured screenshots against the Phase 0 reference images.
#
#   bash baseline/scripts/compare-screens.sh <new-screenshot-dir>
#   REF=<other-dir> bash baseline/scripts/compare-screens.sh <new-screenshot-dir>
#
# REF defaults to the committed Phase 0 images. Override it to compare two sets
# captured the same way — e.g. old build vs new build, both driven headlessly,
# which isolates the change under test from browser-rendering differences.
#
# Reports, per fixture, the fraction of pixels that differ and writes a visual
# diff (differing pixels in red) to <new-dir>/diff/.
#
# Reading the numbers:
#   0            identical.
#   < 0.5%       almost certainly antialiasing or font hinting. Look at the diff
#                image to confirm the changes are scattered, not clustered.
#   > 1%         something moved. Open the diff — clustered red means a layout,
#                font or colour change worth explaining.
#
# Requires ImageMagick (brew install imagemagick).
set -uo pipefail

REF="${REF:-baseline/screenshots}"
NEW="${1:-}"
if [ -z "$NEW" ] || [ ! -d "$NEW" ]; then
  echo "usage: bash baseline/scripts/compare-screens.sh <new-screenshot-dir>" >&2
  exit 2
fi
command -v magick >/dev/null || { echo "ImageMagick not found: brew install imagemagick" >&2; exit 2; }

mkdir -p "$NEW/diff"
printf "%-32s %10s %10s  %s\n" FIXTURE DIFF PIXELS RESULT
printf -- "-%.0s" {1..70}; echo

status=0
for ref in "$REF"/*.png; do
  name=$(basename "$ref")
  new="$NEW/$name"
  if [ ! -f "$new" ]; then
    printf "%-32s %10s %10s  %s\n" "$name" "-" "-" "MISSING in $NEW"
    status=1
    continue
  fi

  refdim=$(magick identify -format "%wx%h" "$ref")
  newdim=$(magick identify -format "%wx%h" "$new")
  if [ "$refdim" != "$newdim" ]; then
    printf "%-32s %10s %10s  %s\n" "$name" "-" "-" "SIZE $refdim vs $newdim — recapture at the same viewport"
    status=1
    continue
  fi

  # AE = count of differing pixels; fuzz absorbs subpixel antialiasing noise.
  differing=$(magick compare -metric AE -fuzz 2% "$ref" "$new" "$NEW/diff/$name" 2>&1 | tr -d '\n' | sed 's/[^0-9].*$//')
  [ -z "$differing" ] && differing=0
  total=$(magick identify -format "%[fx:w*h]" "$ref")
  pct=$(python3 -c "print(f'{100*$differing/$total:.3f}%')")
  verdict=$(python3 -c "
p = 100*$differing/$total
print('identical' if p == 0 else 'noise-level' if p < 0.5 else 'REVIEW' if p < 1 else 'CHANGED')
")
  printf "%-32s %10s %10s  %s\n" "$name" "$pct" "$differing" "$verdict"
  [ "$verdict" = "CHANGED" ] && status=1
done

echo
echo "Diff images: $NEW/diff/"
exit $status
