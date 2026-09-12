#!/bin/sh
set -eu
gp_repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/sh "$gp_repo/install-local.sh" "$@"
