#!/usr/bin/env tsx
/**
 * Отчёт по рассылке на просчёт — результат эксперимента H1.
 *
 *   pnpm rfq:report rfq/responses.csv
 *   pnpm rfq:report --init rfq/responses.csv   # завести пустой журнал
 *
 * Считает три числа, ради которых рассылка и делается: сколько ответили,
 * сколько берутся, по какой цене. Всё остальное — впечатления.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyRfqLog, parseRfqLog, summariseRfq, pluralRu, RAT1_TAKE_RATE } from './rfq-log.js';

const args = process.argv.slice(2);
const init = args.includes('--init');
const path = args.find((a) => !a.startsWith('--'));

if (!path) {
  console.error('Укажите файл журнала: pnpm rfq:report rfq/responses.csv');
  process.exit(1);
}

if (init) {
  if (existsSync(path)) {
    console.error(`\n✗ ${path} уже существует — не перезаписываю.`);
    process.exit(1);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, emptyRfqLog());
  console.log(`\n✓ ${path}\n  Заполняйте по мере ответов. Пустая колонка — это тоже данные:`);
  console.log('  молчание фабрики считается наравне с отказом.');
  process.exit(0);
}

const { responses, problems } = parseRfqLog(readFileSync(path, 'utf8'));

for (const p of problems) console.log(`  ⚠ ${p}`);

if (responses.length === 0) {
  console.log('\nЖурнал пуст. Отправьте листы и заполняйте по мере ответов.');
  process.exit(0);
}

const s = summariseRfq(responses);
const pct = (x: number): string => `${Math.round(x * 100)}%`;

console.log(
  `\nРассылка на просчёт — ${s.sent} ${pluralRu(s.sent, 'фабрика', 'фабрики', 'фабрик')}\n`,
);
console.log(`  ответили          ${s.replied} из ${s.sent}  (${pct(s.reply_rate)})`);
console.log(`  берутся за заказ  ${s.takes} из ${s.sent}  (${pct(s.take_rate)})`);
if (s.median_reply_days !== null) console.log(`  медиана ответа    ${s.median_reply_days} дн`);

console.log('');
if (s.median_price !== null && s.price_range) {
  console.log(
    `  цена за изделие   медиана ${s.median_price} ₽ · ` +
      `разброс ${s.price_range[0]}–${s.price_range[1]} ₽`,
  );
}
if (s.median_moq !== null) console.log(`  минимальная партия медиана ${s.median_moq} шт`);
if (s.median_lead_days !== null)
  console.log(`  срок              медиана ${s.median_lead_days} дн`);

// Вердикт по стоп-крану 1. Считается от ОТПРАВЛЕННЫХ: молчание фабрики —
// это ответ «нет», а не отсутствие данных.
const passed = s.take_rate >= RAT1_TAKE_RATE;
console.log(
  `\n${passed ? '✓' : '✗'} Стоп-кран 1: берутся ${pct(s.take_rate)} при пороге ` +
    `${pct(RAT1_TAKE_RATE)} — ${passed ? 'пройден' : 'НЕ ПРОЙДЕН'}.`,
);
if (!passed) {
  console.log(
    '  Провал стоп-крана означает пересборку ценности, а не наращивание кода\n' +
      '  (CTO-SPEC.md §3). Прежде чем что-то менять, посмотрите заметки отказов:',
  );
  for (const r of responses.filter((x) => !x.takes && x.note)) {
    console.log(`    · ${r.factory}: ${r.note}`);
  }
}

// Глагол склоняется вместе с существительным: «1 фабрика не ответили» —
// мелочь, но именно по таким мелочам отчёт читается как сгенерированный,
// а не написанный.
const silent = s.sent - s.replied;
// Правило объясняется, только когда оно сработало: абзац про молчание при
// нуле молчавших — это объяснение того, чего не было.
if (silent > 0) {
  console.log(
    `\nМолчание считается наравне с отказом: ${silent} ` +
      `${pluralRu(silent, 'фабрика', 'фабрики', 'фабрик')} ` +
      `${pluralRu(silent, 'не ответила', 'не ответили', 'не ответили')},\n` +
      `и в доле «берутся» они учтены как «нет». Считать долю от ответивших —\n` +
      `обычный способ получить красивую цифру вместо честной.`,
  );
}
