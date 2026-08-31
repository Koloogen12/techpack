#!/usr/bin/env bash
# Перенос файловых данных кабинета между машиной и томом на сервере.
#
#   ./deploy/hetzner/data.sh pull        том → ./apps/web/data-backup-<дата>
#   ./deploy/hetzner/data.sh push        локальные данные → том (только новое)
#   ./deploy/hetzner/data.sh push --force  то же, но с перезаписью совпадающих
#
# Состояние кабинета — не база, а каталог файлов: работы, профили, инвайты,
# лимиты, рефералы, журнал событий. По умолчанию push НЕ перезаписывает то,
# что уже лежит в томе: на сервере данные живых пользователей, а локальная
# копия почти всегда старше.
set -euo pipefail

HOST=${SEAMSTER_HOST:-root@167.233.109.195}
VOLUME=seamster_app-files
LOCAL=apps/web/data
MODE=${1:-pull}

case "$MODE" in
  pull)
    OUT="apps/web/data-backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$OUT"
    ssh "$HOST" "docker run --rm -v $VOLUME:/src:ro alpine:3 tar -C /src -cf - ." \
      | tar -C "$OUT" -xf -
    echo "снято в $OUT ($(du -sh "$OUT" | cut -f1))"
    ;;
  push)
    # Флаг -k у busybox-tar оставляет то, что уже есть в томе (GNU-шного
    # --skip-old-files в alpine нет). Перезапись — только по явному --force,
    # и это осознанная потеря серверных данных.
    FLAG="-xkf"
    if [ "${2:-}" = "--force" ]; then
      FLAG="-xf"
      echo "ВНИМАНИЕ: перезапись данных в томе"; sleep 3
    fi
    tar -C "$LOCAL" -cf - . \
      | ssh "$HOST" "docker run --rm -i -v $VOLUME:/dst alpine:3 tar -C /dst $FLAG -"
    ssh "$HOST" "docker restart seamster-app-1 >/dev/null && echo перезапущен"
    echo "залито из $LOCAL"
    ;;
  *)
    echo "режим: pull | push [--force]" >&2
    exit 1
    ;;
esac
