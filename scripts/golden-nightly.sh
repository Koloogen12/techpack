#!/usr/bin/env bash
# Ночной прогон золотого набора по словарям: живой разбор эталонных снимков,
# точность словарей и узлов — в golden/reports/. Ключи — из .env.
# cron: 0 4 * * * cd /opt/seamster && ./scripts/golden-nightly.sh >> /var/log/seamster-golden.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
SEAMSTER_GOLDEN_LIVE=1 npx vitest run golden/vocabulary.test.ts
tail -1 golden/reports/vocabulary-history.jsonl
