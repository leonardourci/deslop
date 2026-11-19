#!/bin/sh
set -eu

if [ "$#" -gt 1 ]; then
  echo 'Usage: install.sh [release-tag]' >&2
  exit 2
fi

tag=${1-latest}
case "$tag" in
  latest) url='https://github.com/leonardourci/deslop/releases/latest/download/deslop.tgz' ;;
  ''|.|..|*[!a-zA-Z0-9._+-]*)
    echo 'Invalid release tag' >&2
    exit 2
    ;;
  *) url="https://github.com/leonardourci/deslop/releases/download/$tag/deslop.tgz" ;;
esac

temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' 0
trap 'exit 1' HUP INT TERM

curl -fsSL "$url" -o "$temp_dir/deslop.tgz"
npm install --global "$temp_dir/deslop.tgz"
