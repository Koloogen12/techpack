#!/usr/bin/env bash
# Ночной прогон золотого набора по словарям: живой разбор эталонных снимков,
# точность словарей и узлов — в отчёт и историю.
#
#   ./scripts/golden-nightly.sh                     локально: ключи из .env,
#                                                   отчёты в golden/reports/
#   ./scripts/golden-nightly.sh --container NAME    на сервере: внутри контейнера,
#                                                   ключи из его окружения, отчёты
#                                                   в томе данных (/data/golden),
#                                                   итог одной строкой в Телеграм
#
# Кэш разбора отключён намеренно: ночь обязана спросить модель заново, иначе
# дрейф модели при том же промпте не виден.
#
# cron на проде (root, каталог стека — см. deploy/hetzner/README.md):
#   30 4 * * * /opt/stacks/seamster/scripts/golden-nightly.sh --container seamster-app-1 >> /var/log/seamster-golden.log 2>&1
set -euo pipefail

if [ "${1:-}" = "--container" ]; then
  name=${2:?имя контейнера}
  echo "[$(date -Is)] золотой набор: $name"
  docker exec \
    -e SEAMSTER_GOLDEN_LIVE=1 -e SEAMSTER_GOLDEN_NOCACHE=1 -e SEAMSTER_GOLDEN_OUT=/data/golden \
    "$name" sh -c 'cd /app && npx vitest run golden/vocabulary.test.ts; code=$?; npx tsx golden/scripts/nightly-notify.ts "$code"; exit $code'
  exit
fi

cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
SEAMSTER_GOLDEN_LIVE=1 SEAMSTER_GOLDEN_NOCACHE=1 npx vitest run golden/vocabulary.test.ts
tail -1 golden/reports/vocabulary-history.jsonl
