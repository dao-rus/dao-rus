#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "bootstrap.sh must be run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl git gnupg ufw

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  . /etc/os-release
  printf '%s\n' \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker

swap_path=/swapfile
if [[ ! -f "${swap_path}" ]]; then
  fallocate -l 2G "${swap_path}"
  chmod 600 "${swap_path}"
  mkswap "${swap_path}"
fi

if ! swapon --show=NAME --noheadings | grep -Fxq "${swap_path}"; then
  swapon "${swap_path}"
fi

if ! grep -Eq '^/swapfile[[:space:]]' /etc/fstab; then
  printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
fi

printf '%s\n' 'vm.swappiness=10' > /etc/sysctl.d/99-dao-core.conf
sysctl --system >/dev/null

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

install -d -m 0755 /opt/dao-rus

echo "DAO Core host prerequisites are ready."
echo "Clone the repository into /opt/dao-rus, create apps/core/.env.production, then run deploy/update.sh with bash."
