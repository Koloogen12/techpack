#!/bin/bash
# Деплой демо на seamster.pro. Запуск с машины разработчика из корня репо.
#
#   ./scripts/deploy-demo.sh          код + фронт + рестарт
#   ./scripts/deploy-demo.sh --site   плюс пересборка ревью-сайта из versions/
set -e
HOST=root@135.106.146.200

echo "→ код"
rsync -az --delete \
  --exclude=node_modules --exclude=.git --exclude=.env --exclude=out \
  --exclude=.cache --exclude=apps/web/dist --exclude=versions --exclude=market-research \
  ./ $HOST:/opt/seamsterly/app/

echo "→ зависимости и фронт"
ssh $HOST "export PATH=/opt/seamsterly/node22/bin:\$PATH && cd /opt/seamsterly/app \
  && pnpm install --silent && cd apps/web && pnpm build >/dev/null \
  && chown -R seamsterly:seamsterly /opt/seamsterly/app"

if [ "$1" = "--site" ]; then
  echo "→ ревью-сайт"
  pnpm site --versions versions --out out/site >/dev/null
  rsync -az --delete out/site/ $HOST:/opt/seamsterly/site/
  rsync -az --delete out/holding/ $HOST:/opt/seamsterly/holding/
  ssh $HOST "chown -R seamsterly:seamsterly /opt/seamsterly/site /opt/seamsterly/holding && chmod -R a+rX /opt/seamsterly/site /opt/seamsterly/holding"
fi

echo "→ рестарт"
ssh $HOST "systemctl restart seamsterly-app && sleep 2 && systemctl is-active seamsterly-app \
  && curl -s -o /dev/null -w 'health %{http_code}\n' http://127.0.0.1:8131/app/api/health"
echo "✓"
