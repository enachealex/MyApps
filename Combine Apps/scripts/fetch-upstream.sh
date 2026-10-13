#!/usr/bin/env sh
# Checks out every upstream ArtCraft repository at the commit pinned in upstream.lock, under
# vendor/<name>: a shallow, detached checkout with upstream's own line endings, reset to exactly
# that commit, then patched with patches/<name>/*.patch (in name order). Safe to run before
# every build.
#
#   scripts/fetch-upstream.sh                      # all of them
#   scripts/fetch-upstream.sh wordcraft gridcraft  # just these
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$root/vendor"

grep -v '^[[:space:]]*#' "$root/upstream.lock" | while read -r name commit url; do
    [ -n "$name" ] || continue
    if [ $# -gt 0 ]; then
        case " $* " in *" $name "*) ;; *) continue ;; esac
    fi
    dir="$root/vendor/$name"
    if [ ! -d "$dir/.git" ]; then
        git init --quiet "$dir"
        git -C "$dir" remote add origin "$url"
    fi
    git -C "$dir" config core.autocrlf false
    have=$(git -C "$dir" rev-parse --verify --quiet HEAD 2>/dev/null || true)
    if [ "$have" != "$commit" ]; then
        printf '%-16s -> %.12s\n' "$name" "$commit"
        git -C "$dir" fetch --quiet --depth 1 origin "$commit"
        git -C "$dir" -c advice.detachedHead=false checkout --quiet --force FETCH_HEAD
    else
        printf '%-16s at %.12s\n' "$name" "$commit"
    fi
    patches=$(ls "$root/patches/$name"/*.patch 2>/dev/null || true)
    # Already exactly the commit plus its patches: leave the files alone, so cargo has nothing to
    # rebuild. Otherwise back to the commit, and patch.
    changed=$(git -C "$dir" diff --name-only HEAD | sort -u)
    touched=$(for patch in $patches; do git -C "$dir" apply --numstat "$patch" | cut -f3; done | sort -u)
    applied=yes
    for patch in $patches; do
        git -C "$dir" apply --reverse --check "$patch" 2>/dev/null || applied=no
    done
    [ "$changed" = "$touched" ] && [ "$applied" = yes ] && continue
    git -C "$dir" reset --quiet --hard
    for patch in $patches; do
        printf '%-16s    + %s\n' '' "$(basename "$patch")"
        git -C "$dir" apply --whitespace=nowarn "$patch"
    done
done
