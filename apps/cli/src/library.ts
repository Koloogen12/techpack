#!/usr/bin/env tsx
/**
 * Библиотека артов бренда.
 *
 *   pnpm library                 — что в библиотеке есть
 *   pnpm library <имя>           — паспорт одного рисунка
 *
 * Рисунок — актив бренда, а не приложение к одному техпаку: одна и та же
 * графика идёт на футболку, худи и свитшот капсулы.
 */
import { reportCliError } from './report-error.js';
import { ArtworkLibrary } from '@seamster/library';
import { pluralRu } from './rfq-log.js';

const id = process.argv[2];
const library = new ArtworkLibrary();

try {
  if (!id) {
    const assets = library.list();
    if (assets.length === 0) {
      console.log(
        '\nБиблиотека пуста.\n' +
          '  Создайте рисунок: pnpm pattern --refs мотив.png --brief "…" --save имя',
      );
      process.exit(0);
    }

    console.log(
      `\nВ библиотеке ${assets.length} ` +
        `${pluralRu(assets.length, 'рисунок', 'рисунка', 'рисунков')}:\n`,
    );
    for (const a of assets) {
      const seam = a.seam
        ? a.seam.seamless
          ? a.seam.mirrored
            ? 'бесшовный (зеркальный)'
            : 'бесшовный'
          : 'ШОВ ВИДЕН'
        : '—';
      console.log(
        `  ${a.id.padEnd(18)} ${String(a.pixels.width).padStart(5)} px · ` +
          `${String(a.colors.length).padStart(2)} красок · ${seam.padEnd(22)} ` +
          // «Использован в N паках» — не украшение каталога: увидев, что
          // рисунок ушёл в три изделия, человек понимает, что правка
          // тронет все три.
          (a.used_in.length
            ? `в ${a.used_in.length} ${pluralRu(a.used_in.length, 'паке', 'паках', 'паках')}: ` +
              `${a.used_in.join(', ')}`
            : 'ещё не использован'),
      );
    }
    console.log('\nВ анкете: "patterns": [{ "asset": "<имя>", "repeat_cm": 24 }]');
    process.exit(0);
  }

  const a = library.get(id);
  console.log(
    `\n${a.id} — ${a.label_ru}\n` +
      `  файл:     ${a.file} · ${a.pixels.width}×${a.pixels.height} px\n` +
      `  бриф:     ${a.brief ?? 'принесён заказчиком'}\n` +
      `  отпечаток:${a.key ? ` ${a.key.slice(0, 16)}` : ' нет — рисунок не генерировался нами'}\n` +
      (a.seam
        ? `  стык:     ${a.seam.ratio} · ${a.seam.seamless ? 'бесшовный' : 'ШОВ ВИДЕН'}` +
          `${a.seam.mirrored ? ' (зеркальная укладка)' : ''}\n`
        : '') +
      `  краски:   ${a.colors.length}\n` +
      a.colors
        .map(
          (c) =>
            `    ${c.hex}  ${String(Math.round(c.share * 100)).padStart(3)}%` +
            (c.book_code
              ? `  ${c.book_code} (${c.book_source === 'brand' ? 'бренд' : 'подбор'})`
              : ''),
        )
        .join('\n') +
      `\n  вектор:   ${a.vector_available ? 'есть' : 'нет'}\n` +
      `  добавлен: ${a.created_at}\n` +
      `  паки:     ${a.used_in.length ? a.used_in.join(', ') : 'ещё не использован'}`,
  );
} catch (e: unknown) {
  reportCliError(e);
  process.exit(1);
}
