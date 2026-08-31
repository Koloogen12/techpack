#!/usr/bin/env bash
# Выкатка кабинета Seamster на общий сервер Hetzner.
#
#   ./deploy/hetzner/deploy.sh            код, сборка, запуск
#   ./deploy/hetzner/deploy.sh --no-build только код и перезапуск
#
# Сервер общий: на нём живут ContentOS, lovemyage и yoomp. Всё, что делает этот
# скрипт, ограничено каталогом /opt/stacks/seamster, файлом
# /etc/seamster/secrets.env и сетью edge. Команд с --all, prune, --volumes и
# --remove-orphans здесь нет и быть не должно: они выходят за пределы стека и
# роняют соседей, а не нас.
set -euo pipefail

HOST=${SEAMSTER_HOST:-root@167.233.109.195}
PRODUCT=seamster
STACK=/opt/stacks/$PRODUCT
DOMAIN=${SEAMSTER_DOMAIN:-seamster.pro}

say() { printf '\n→ %s\n' "$1"; }

# Исключения не косметические: node_modules и dist с macOS ломают сборку
# linux-образа, а .env с ключами не должен уезжать на сервер вообще.
#
# Пути якорные — ведущий слеш обязателен. Без него rsync исключает КАЖДЫЙ
# каталог с таким именем на любой глубине: «--exclude=versions» унёс с собой
# packages/versions, workspace-пакет, и pnpm молча оставил симлинк в пустоту —
# образ собрался, а контейнер упал на первом импорте.
EXCLUDES=(
  --exclude=.git --exclude=node_modules --exclude='**/node_modules'
  --exclude=/out --exclude=/.cache --exclude=/apps/web/dist --exclude=/apps/web/data
  --exclude=/market-research --exclude='/база svg'
  --exclude=/.claude --exclude='*.log' --exclude='.DS_Store' --exclude=.env
)

say "код → $STACK"
ssh "$HOST" "install -d -m 755 $STACK"
rsync -az --delete "${EXCLUDES[@]}" ./ "$HOST:$STACK/"

say "секреты"
ssh "$HOST" "PRODUCT=$PRODUCT bash -s" <<'EOF'
set -euo pipefail
install -d -m 700 "/etc/$PRODUCT"
F="/etc/$PRODUCT/secrets.env"
touch "$F"; chmod 600 "$F"
# Существующее значение не перезаписывается: смена ADMIN_TOKEN между выкатками
# обесценивает выданные ссылки, а перегенерация вслепую — молча.
set_if_absent() { grep -q "^$1=" "$F" || printf '%s=%s\n' "$1" "$2" >> "$F"; }
set_if_absent ADMIN_TOKEN "$(openssl rand -hex 24)"
set_if_absent ANTHROPIC_API_KEY "placeholder-replace-me"
set_if_absent COMETAPI_KEY "placeholder-replace-me"
set_if_absent TELEGRAM_BOT_TOKEN ""
set_if_absent TELEGRAM_ADMIN_ID ""
echo "переменных: $(grep -c '=' "$F")"
EOF

say ".env стека"
ssh "$HOST" "cat > $STACK/.env" <<EOF
DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
EOF

if [ "${1:-}" != "--no-build" ]; then
  say "сборка"
  ssh "$HOST" "STACK=$STACK PRODUCT=$PRODUCT bash -s" <<'EOF'
set -euo pipefail
cd "$STACK"
# .env даёт подстановку ${...} в сам compose, secrets.env — переменные внутрь
# контейнера. Нужны оба, поэтому склеиваются во временный файл: при указанном
# --env-file обычный .env каталога compose уже не читает.
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
cat .env "/etc/$PRODUCT/secrets.env" > "$TMP"
docker compose -f deploy/hetzner/compose.stack.yml --env-file "$TMP" build
EOF
fi

say "запуск"
ssh "$HOST" "STACK=$STACK PRODUCT=$PRODUCT bash -s" <<'EOF'
set -euo pipefail
cd "$STACK"
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
cat .env "/etc/$PRODUCT/secrets.env" > "$TMP"
docker compose -f deploy/hetzner/compose.stack.yml --env-file "$TMP" up -d
docker compose -f deploy/hetzner/compose.stack.yml --env-file "$TMP" ps
EOF

say "проверка"
ssh "$HOST" "DOMAIN=$DOMAIN bash -s" <<'EOF'
set -euo pipefail

# 1. Сам контейнер, минуя Caddy. Пока DNS смотрит на старый адрес, это
#    единственная проверка, которая говорит про приложение, а не про маршрут.
for i in $(seq 1 30); do
  body=$(docker run --rm --network edge alpine:3     wget -qO- --timeout=5 http://seamster-app-1:8131/app/api/health 2>/dev/null || true)
  [ -n "$body" ] && { echo "контейнер: $body"; break; }
  sleep 3
done
[ -n "${body:-}" ] || { echo "контейнер не ответил на /app/api/health"; exit 1; }

# 2. Маршрут. Caddy редиректит http на https, поэтому здесь ждём 308 — тот же
#    код, что отдают соседние домены. 404 означал бы, что блок не подхватился.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOMAIN" http://127.0.0.1/app/ || true)
case "$code" in
  308|200) echo "маршрут: $code" ;;
  404) echo "маршрут: 404 — блока $DOMAIN нет в Caddyfile"; exit 1 ;;
  *)   echo "маршрут: $code — неожиданный код"; exit 1 ;;
esac

# 3. Соседи на месте: сравнивать с кодами, снятыми до выкатки.
echo "соседи:"
for d in $(grep -oE '^[a-z0-9.*-]+\.[a-z]+' /opt/caddy/Caddyfile | sort -u); do
  printf '  %-24s %s\n' "$d" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -H "Host: $d" http://127.0.0.1/ || echo timeout)"
done
EOF

printf '\n✓ выкачено: https://%s/app/\n' "$DOMAIN"
