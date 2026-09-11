import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_REGISTRY } from '@seamster/kb';

/**
 * Кабинет обязан знать все изделия, которые знает движок.
 *
 * Реестр категорий — TypeScript, и компилятор ловит там любой пропуск.
 * Кабинет — JavaScript прототипа без проверки типов, и новая вещь выпадает
 * из него МОЛЧА: движок её умеет, справочник полон, тесты зелёные, а в
 * анкете её просто нет и выбрать нельзя.
 *
 * Так и случилось с брюками 10 сентября 2026: категория заведена целиком,
 * прошла гейт и уехала в прод, где ни один человек не мог её заказать.
 * Обнаружено сутки спустя и случайно. Этот тест закрывает дыру: он читает
 * тот же файл, который отдаётся браузеру, и сверяет три места разом.
 */
const logic = readFileSync(join(process.cwd(), 'apps/web/proto/logic.js'), 'utf8');

/** Достаёт тело объектной карты по имени: `const CAT_RU = { … };` */
function mapBody(name: string): string {
  const start = logic.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`в кабинете нет карты ${name}`);
  const end = logic.indexOf('\n};', start);
  return logic.slice(start, end);
}

/** Тело списка вариантов первого вопроса анкеты — там же, где 'Худи'. */
function questionnaireOptions(): string {
  const anchor = logic.indexOf("          'Худи',");
  if (anchor < 0) throw new Error('в анкете не найден список категорий');
  const end = logic.indexOf('].map((l) => mkOpt(', anchor);
  return logic.slice(anchor, end);
}

describe('кабинет знает все категории движка', () => {
  const ruLabels = CATEGORIES.map((c) => CATEGORY_REGISTRY[c].ru);

  it('карта английских ключей содержит каждую категорию', () => {
    const body = mapBody('CAT_RU');
    const missing = CATEGORIES.filter((c) => !new RegExp(`\\b${c}:`).test(body));
    expect(missing).toEqual([]);
  });

  it('обратная карта переводит русское название в ключ', () => {
    const body = mapBody('CAT_OF');
    const missing = ruLabels.filter((ru) => !body.toLowerCase().includes(ru.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it('анкета предлагает каждую категорию на выбор', () => {
    const body = questionnaireOptions().toLowerCase();
    const missing = ruLabels.filter((ru) => !body.includes(ru.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it('в кабинете нет категорий, которых не знает движок', () => {
    const body = mapBody('CAT_RU');
    const keys = [...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
    const unknown = keys.filter((k) => !(CATEGORIES as readonly string[]).includes(k));
    expect(unknown).toEqual([]);
  });
});
