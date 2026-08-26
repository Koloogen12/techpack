#!/usr/bin/env tsx
/**
 * История версий техпака.
 *
 *   pnpm versions                каталог артикулов
 *   pnpm versions <артикул>      история одного
 *   pnpm versions <артикул> <n>  что изменилось в версии n

 * Каталог версий по умолчанию `versions/`, меняется флагом --versions.
 */
import { isSpecFormError } from '@specform/core';
import { diffSpecs, summarise, VersionStore } from '@specform/versions';
import { CONFIDENCE_LABEL_RU } from '@specform/core';

const args = process.argv.slice(2);
const dirFlag = args.indexOf('--versions');
const dir = dirFlag >= 0 ? (args[dirFlag + 1] ?? 'versions') : 'versions';
const [article, nRaw] = args.filter((a, i) => !a.startsWith('--') && i !== dirFlag + 1);
const store = new VersionStore(dir);

try {
  if (!article) {
    const all = store.articles();
    if (!all.length) {
      console.log('\nВерсий пока нет. Первая появится после примерки: pnpm fit:apply <бланк>\n');
      process.exit(0);
    }
    for (const a of all) {
      const list = store.list(a);
      const last = list[list.length - 1]!;
      console.log(
        `${a.padEnd(16)} ${String(list.length).padStart(2)} верс. · последняя: ${last.reason_ru}`,
      );
    }
    process.exit(0);
  }

  const list = store.list(article);
  if (!list.length) {
    console.log(`\nУ артикула ${article} версий нет.\n`);
    process.exit(0);
  }

  if (!nRaw) {
    console.log(`\n${article}\n`);
    for (const v of list) {
      console.log(
        `  v${String(v.n).padEnd(3)} ${v.created_at.slice(0, 10)}  ` +
          `${v.fingerprint.slice(0, 12)}  ${v.reason_ru}`,
      );
    }
    console.log();
    process.exit(0);
  }

  const n = Number(nRaw);
  if (n <= 1) {
    console.log(`\nv1 — первая версия, сравнивать не с чем.\n`);
    process.exit(0);
  }

  const diff = diffSpecs(store.read(article, n - 1), store.read(article, n));
  console.log(`\n${article} · v${n - 1} → v${n}\n${summarise(diff)}\n`);
  for (const p of diff.points) {
    const from = p.from_cm === null ? '—' : p.from_cm.toFixed(1);
    const to = p.to_cm === null ? '—' : p.to_cm.toFixed(1);
    const status =
      p.from_confidence && p.to_confidence && p.from_confidence !== p.to_confidence
        ? `  ${CONFIDENCE_LABEL_RU[p.from_confidence]} → ${CONFIDENCE_LABEL_RU[p.to_confidence]}`
        : '';
    console.log(
      `  ${p.code}  ${p.name_ru.padEnd(26)} ${from.padStart(6)} → ${to.padStart(6)}${status}`,
    );
  }
  for (const id of diff.nodes.added) console.log(`  + узел ${id}`);
  for (const id of diff.nodes.removed) console.log(`  − узел ${id}`);
  console.log();
} catch (error) {
  if (isSpecFormError(error)) {
    console.error(`\n${error.userMessage}\n${error.userAction}\n`);
    process.exit(1);
  }
  throw error;
}
