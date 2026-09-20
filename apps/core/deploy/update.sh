#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir="${DAO_CORE_REPO_DIR:-/opt/dao-rus}"
branch="${DAO_CORE_BRANCH:-main}"
core_dir="${repo_dir}/apps/core"
env_file="${core_dir}/.env.production"
compose_file="${core_dir}/compose.prod.yml"

if [[ "${EUID}" -ne 0 ]]; then
  echo "update.sh must be run as root" >&2
  exit 1
fi

if [[ ! -d "${repo_dir}/.git" ]]; then
  echo "Git repository not found at ${repo_dir}" >&2
  exit 1
fi

if [[ ! -f "${env_file}" ]]; then
  echo "Production environment file not found: ${env_file}" >&2
  exit 1
fi

cd "${repo_dir}"
git fetch origin "${branch}"
git switch "${branch}"
git pull --ff-only origin "${branch}"

chmod 600 "${env_file}"
cd "${core_dir}"

compose=(docker compose --env-file "${env_file}" -f "${compose_file}")

"${compose[@]}" config --quiet
"${compose[@]}" build --pull
"${compose[@]}" up -d --remove-orphans
"${compose[@]}" ps
