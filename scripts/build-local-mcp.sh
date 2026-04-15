#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[build-local-mcp] %s\n' "$*"
}

die() {
  printf '[build-local-mcp] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Command not found: $1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

load_nvm_and_use_node22() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
    die "nvm is not available at ${NVM_DIR}/nvm.sh"
  fi

  # shellcheck source=/dev/null
  . "${NVM_DIR}/nvm.sh"

  if ! nvm use 22 >/dev/null; then
    die "Node.js 22 is not installed. Run: nvm install 22"
  fi

  log "Using Node $(node -v)"
}

main() {
  [[ -f "${REPO_ROOT}/pnpm-workspace.yaml" ]] || die "Not a claude-context repo: ${REPO_ROOT}"

  require_cmd pnpm
  load_nvm_and_use_node22

  cd "${REPO_ROOT}"

  log "Building @zilliz/claude-context-core"
  pnpm --filter @zilliz/claude-context-core build

  log "Building @zilliz/claude-context-mcp"
  pnpm --filter @zilliz/claude-context-mcp build

  [[ -f "${REPO_ROOT}/packages/mcp/dist/index.js" ]] || die "Build artifact not found: packages/mcp/dist/index.js"
  log "Done: packages/mcp/dist/index.js"
}

main "$@"
