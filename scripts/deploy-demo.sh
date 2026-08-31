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
  --exclude=.cache --exclude=/apps/web/dist --exclude=/versions --exclude=/market-research --exclude=/out \
  ./ $HOST:/opt/seamster/app/

echo "→ зависимости и фронт"
ssh $HOST "export PATH=/opt/seamster/node22/bin:\$PATH && cd /opt/seamster/app \
  && pnpm install --silent && cd apps/web && pnpm build >/dev/null \
  && chown -R seamster:seamster /opt/seamster/app"

if [ "$1" = "--site" ]; then
  echo "→ ревью-сайт"
  pnpm site --versions versions --out out/site >/dev/null
  rsync -az --delete out/site/ $HOST:/opt/seamster/site/
  rsync -az --delete out/holding/ $HOST:/opt/seamster/holding/
  ssh $HOST "chown -R seamster:seamster /opt/seamster/site /opt/seamster/holding && chmod -R a+rX /opt/seamster/site /opt/seamster/holding"
fi

echo "→ рестарт"
ssh $HOST "systemctl restart seamster-app && sleep 2 && systemctl is-active seamster-app \
  && curl -s -o /dev/null -w 'health %{http_code}\n' http://127.0.0.1:8131/app/api/health"
echo "✓"
