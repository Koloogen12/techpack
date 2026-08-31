#!/usr/bin/env bash
# Блок домена в общем Caddyfile.
#
#   ./deploy/hetzner/caddy.sh
#
# Caddyfile общий на все продукты сервера, поэтому он только ДОПИСЫВАЕТСЯ и
# никогда не перезаписывается целиком: перезапись стёрла бы блоки соседей
# вместе с их сертификатами. Перезапускать контейнер Caddy тоже нельзя —
# при ошибке в конфиге он не поднимется и лягут все домены разом. reload в
# этом смысле безопасен: битый конфиг он отвергает, оставляя рабочий.
set -euo pipefail

HOST=${SEAMSTER_HOST:-root@167.233.109.195}
DOMAIN=${SEAMSTER_DOMAIN:-seamster.pro}

ssh "$HOST" "DOMAIN=$DOMAIN bash -s" <<'EOF'
set -euo pipefail
CF=/opt/caddy/Caddyfile
cp "$CF" "$CF.bak.$(date +%s)"

if grep -q "^${DOMAIN} {" "$CF"; then
  echo "блок ${DOMAIN} уже есть"
else
  # Весь домен идёт в один контейнер: у кабинета единственный сервис, он же
  # раздаёт статику. Проксирование по полному имени контейнера, а не по имени
  # сервиса, — обязательно: алиас «app» в сети edge может принадлежать сразу
  # нескольким продуктам, и запросы начнут уходить к соседям.
  cat >> "$CF" <<BLOCK

${DOMAIN} {
    encode zstd gzip
    reverse_proxy seamster-app-1:8131
}
BLOCK
  echo "блок ${DOMAIN} добавлен"
fi

docker exec caddy-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec caddy-caddy-1 caddy reload  --config /etc/caddy/Caddyfile
echo "конфиг перечитан"
EOF
