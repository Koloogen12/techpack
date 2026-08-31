#!/usr/bin/env tsx
/**
 * Консьерж-админка — панель состояния сервиса.
 *
 *   pnpm admin [--out out/admin.html]
 *
 * Пока сервис ведёт человек руками, у него десяток команд и четыре каталога
 * с файлами. Вопрос, на который до сих пор нельзя было ответить без обхода
 * всех четырёх: ЧТО СЕЙЧАС ТРЕБУЕТ МОЕГО ВНИМАНИЯ.
 *
 * Панель НИЧЕГО НЕ ЗАПУСКАЕТ. Она собирается из тех же файлов, что пишут
 * генератор и примерка, показывает состояние и называет следующую команду
 * буквально — её видно, можно скопировать и прочитать глазами до запуска.
 * Кнопка «перегенерировать всё» в режиме, где каждая генерация уходит
 * фабрике, — это не удобство, а способ однажды отправить не то.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { reportCliError } from './report-error.js';
import { dirname } from 'node:path';
import { ArtworkLibrary } from '@seamster/library';
import { VersionStore } from '@seamster/versions';
import { buildAdminReport } from './admin-report.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};

try {
  const store = new VersionStore(flag('versions', 'versions'));
  const library = new ArtworkLibrary(flag('library', 'brand-library/artwork'));
  const { rows, attention, html } = buildAdminReport(store, library, flag('rfq', 'rfq-log.csv'));

  const out = flag('out', 'out/admin.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);

  const blocking = attention.filter((a) => a.blocking).length;
  console.log(`\n✓ ${out}`);
  console.log(
    `  изделий: ${rows.length} · требует внимания: ${attention.length}` +
      (blocking ? ` · из них закрывают выпуск: ${blocking}` : ''),
  );
  console.log();
} catch (error) {
  // Сообщение человеку и код возврата — всё. Стек поверх объяснения
  // читается как «мы не знаем, что случилось», хотя мы знаем.
  reportCliError(error);
  process.exit(1);
}
