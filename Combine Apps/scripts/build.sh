#!/usr/bin/env sh
# Builds ArtCraft Studio and ArtCraft Docs and puts the two programs in dist/. They need nothing
# else, so target/ is only a build cache that can be deleted at any time.
#
#   scripts/build.sh          # build
#   scripts/build.sh --clean  # build, then delete the build cache (the next build starts over)
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
"$root/scripts/fetch-upstream.sh"
cd "$root"
cargo build --release -p craft-studio -p craft-docs
mkdir -p dist
cp -f target/release/craft-studio target/release/craft-docs dist/
echo "Built $root/dist/craft-studio and $root/dist/craft-docs"
if [ "${1:-}" = "--clean" ]; then
    cargo clean
fi
