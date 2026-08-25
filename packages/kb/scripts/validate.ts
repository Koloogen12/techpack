/**
 * Прогон валидации справочников + отчёт по бэклогу верификации.
 *
 * Запуск: pnpm kb:validate
 *
 * Отчёт нужен не для красоты: он показывает, какая доля базы — экспертная оценка,
 * а не норматив. Приоритет верификации — по частоте использования значения
 * (CTO-SPEC.md §5, риск «KB-значения с verified:false дают брак»).
 */
import { isSpecFormError } from '@specform/core';
import { KnowledgeBase } from '../src/index.js';

function main(): void {
  let base: KnowledgeBase;
  try {
    base = KnowledgeBase.load();
  } catch (e) {
    if (isSpecFormError(e)) {
      console.error(`✗ ${e.message}`);
      if (typeof e.details.issues === 'string') console.error(e.details.issues);
    } else {
      console.error(e);
    }
    process.exit(1);
  }

  console.log('✓ все справочники прошли валидацию схем');
  console.log(`  категорий с шаблоном точек: ${base.supportedCategories().join(', ')}`);

  const gaps = base.unverified();
  const byBook = new Map<string, number>();
  for (const g of gaps) byBook.set(g.book, (byBook.get(g.book) ?? 0) + 1);

  console.log(`\nБэклог верификации — ${gaps.length} записей:`);
  for (const [book, count] of [...byBook].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${book}`);
  }

  const blocking = gaps.filter((g) => g.gap.includes('БЛОКИРУЮЩИЙ'));
  if (blocking.length) {
    console.log(`\n⚠️  Блокирующих пробелов: ${blocking.length}`);
    const shown = new Set<string>();
    for (const g of blocking) {
      if (shown.has(g.book)) continue;
      shown.add(g.book);
      console.log(`  ${g.book}: ${g.gap.split('.')[0]}.`);
    }
  }
}

main();
