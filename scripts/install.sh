#!/usr/bin/env bash
# Keystone online installer for Linux servers with Docker Compose v2.
set -Eeuo pipefail

REPO_URL="${KEYSTONE_REPO_URL:-https://github.com/yb1203/Keystone.git}"
BRANCH="${KEYSTONE_BRANCH:-main}"
INSTALL_DIR="${KEYSTONE_INSTALL_DIR:-$PWD/keystone}"

fail() {
  printf '\n[Keystone] %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

require_command git
require_command docker
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."
docker info >/dev/null 2>&1 || fail "Docker is not running or the current user cannot access it."

if [ -e "$INSTALL_DIR" ]; then
  [ -d "$INSTALL_DIR/.git" ] || fail "Install directory already exists and is not a Keystone Git repository: $INSTALL_DIR"
  git -C "$INSTALL_DIR" diff --quiet || fail "Install directory has uncommitted changes: $INSTALL_DIR"
  git -C "$INSTALL_DIR" diff --cached --quiet || fail "Install directory has staged changes: $INSTALL_DIR"
  printf '[Keystone] Updating %s\n' "$INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
else
  printf '[Keystone] Downloading Keystone to %s\n' "$INSTALL_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
printf '[Keystone] Building and starting containers...\n'
docker compose up -d --build --remove-orphans

printf '\n[Keystone] Deployment complete.\n'
printf '[Keystone] Open: http://SERVER_IP:3000\n'
printf '[Keystone] Data is stored inside the container; deleting the container clears the vault.\n'
