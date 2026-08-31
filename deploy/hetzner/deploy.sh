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
EXCLUDES=(
  --exclude=.git --exclude=node_modules --exclude='**/node_modules'
  --exclude=out --exclude=.cache --exclude=/apps/web/dist --exclude=/apps/web/data
  --exclude=versions --exclude=market-research --exclude='база svg'
  --exclude=.claude --exclude='*.log' --exclude='.DS_Store' --exclude=.env
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
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOMAIN" http://127.0.0.1/app/api/health || true)
  [ "$code" = "200" ] && { echo "health $code"; exit 0; }
  sleep 3
done
echo "health не ответил 200 (последний код: ${code:-нет})"
exit 1
EOF

printf '\n✓ выкачено: https://%s/app/\n' "$DOMAIN"
