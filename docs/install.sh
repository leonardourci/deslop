#!/bin/sh
set -eu

if [ "$#" -gt 1 ]; then
  echo 'Usage: install.sh [release-tag]' >&2
  exit 2
fi

tag=${1-latest}

temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' 0
trap 'exit 1' HUP INT TERM

if [ "$tag" = latest ]; then
  curl -fsSL https://api.github.com/repos/leonardourci/deslop/releases/latest \
    -H 'Cache-Control: no-cache' -o "$temp_dir/release.json"
  tag=$(node -e '
    const release = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (typeof release.tag_name !== "string") throw new Error("Latest release has no tag");
    process.stdout.write(release.tag_name);
  ' "$temp_dir/release.json")
fi

case "$tag" in
  ''|.|..|*[!a-zA-Z0-9._+-]*)
    echo 'Invalid release tag' >&2
    exit 2
    ;;
  *) url="https://github.com/leonardourci/deslop/releases/download/$tag/deslop.tgz" ;;
esac

curl -fsSL "$url" -o "$temp_dir/deslop.tgz"
npm install --global "$temp_dir/deslop.tgz"
