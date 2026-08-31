# Кабинет Seamster: один процесс Node, файловые данные в томе.
#
# Рантайм исполняет TypeScript через tsx, а не собранный JS — ровно так, как
# кабинет запускался всегда. Отсюда devDependencies в образе: убрать их значит
# менять способ запуска заодно с переездом, а это два изменения в одном шаге.
FROM node:22-bookworm-slim

# Chromium нужен самому продукту: кабинет печатает PDF техпака и лист на
# просчёт через playwright. Ставится со своими системными зависимостями —
# без --with-deps браузер запускается на машине разработчика и падает здесь.
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN corepack enable && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Один COPY вместо разбора манифестов по пакетам: в монорепо их восемнадцать,
# и любой новый пакет молча выпадал бы из списка. Что не нужно образу —
# отсечено .dockerignore.
COPY . .

RUN pnpm install --frozen-lockfile --silent \
 && pnpm exec playwright install --with-deps chromium \
 && pnpm --filter @seamster/web build \
 && pnpm store prune 2>/dev/null || true

# Данные — только в томе: каталог образа должен остаться пустым, иначе при
# первом запуске том накроет его и разница будет незаметна до потери данных.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8131 \
    DATA_DIR=/data \
    WEB_DIST=apps/web/dist

EXPOSE 8131

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8131/app/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "exec", "tsx", "apps/web/server/main.ts"]
