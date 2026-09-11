#!/usr/bin/env tsx
/**
 * Привязка уже размеченных силуэтов к категориям, появившимся позже.
 *
 *   pnpm templates:promote [--dry]
 *
 * Каталогизация (`templates:catalog`) просит модель выбрать категорию из
 * нашего реестра, а изделие, которого в реестре нет, описать словами в
 * `category_other`. Пока верхней одежды в реестре не было, все 123 листа
 * семейства ушли в свободный текст: «бомбер (варсити-куртка)», «пуховик
 * с ветрозащитной планкой», «куртка-харрингтон на молнии». Признаки у них
 * разобраны полностью и стоят денег, а в подбор они не идут — присвоить
 * их было нечему.
 *
 * Скрипт переносит это описание в категорию по словарю. Он не заменяет
 * каталогизацию и ничего не решает за модель: он читает ЕЁ ЖЕ ответ,
 * данный до того, как категория появилась. Новый приём датасета traits
 * переносит, поэтому правка переживает `templates:ingest`.
 *
 * Идемпотентен: лист с уже проставленной категорией не трогается.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Category } from '@seamster/kb';

const MANIFEST = 'packages/kb/data/templates/template_manifest.json';

/**
 * Словарь: что в описании означает какую категорию.
 *
 * Порядок важен — первое совпадение выигрывает. Сначала то, что уводит
 * лист ИЗ верхней одежды (кардиган размечен внутри этого семейства), затем
 * то, чего мы не умеем вовсе, затем сами куртки.
 */
const RULES: { has: RegExp; category: Category | null; why: string }[] = [
  { has: /кардиган/i, category: 'cardigan', why: 'кардиган лежит в этом семействе датасета' },
  // Жилета в реестре нет: у него нет рукава, и табель мер верха ему не подходит.
  // Присвоить куртку значило бы подобрать силуэт с рукавами к вещи без них.
  { has: /жилет/i, category: null, why: 'жилета в реестре нет' },
  // Короткие куртки с рибом по низу: бомбер, варсити, харрингтон, олимпийка,
  // блузон. Это один силуэт под разными именами — риб держит низ, длина до
  // талии, воротник-стойка.
  {
    has: /бомбер|варсити|харрингтон|олимпийк|блузон/i,
    category: 'bomber',
    why: 'короткая куртка с рибом по низу',
  },
  // Всё остальное в семействе — куртка: пуховик, парка, анорак, ветровка,
  // джинсовая, рабочая, коуч. Длина до бедра, застёжка во всю длину.
  {
    has: /пуховик|парк[аи]|анорак|ветровк|куртк|джекет|джакет|коуч|трактор|trucker|work jacket/i,
    category: 'jacket',
    why: 'куртка до бедра',
  },
  // Пальто в этом датасете почти нет, но слово встречается в «куртке-пальто».
  // Оно уже поймано правилом куртки выше — здесь остаются настоящие пальто.
  { has: /пальто/i, category: 'coat', why: 'длина ниже бедра' },

  // --- Низ. Семейство размечено целиком, а привязать его было не к чему до
  // 10 сентября 2026, когда появились юбка и брюки. Сто семьдесят шесть
  // листов простаивали по той же причине, что верхняя одежда.
  //
  // Шорты, легинсы и бельё в реестре отсутствуют: у шорт своя длина по
  // шаговому шву, у белья своя размерная логика. Ставим null осознанно —
  // брючный силуэт на шортах дал бы линию низа в другом месте.
  {
    has: /шорты|трусы|бельё|белье|боксеры|брифы|стринги|бикини|носки/i,
    category: null,
    why: 'в реестре нет',
  },
  { has: /легинс/i, category: null, why: 'легинсов в реестре нет' },
  { has: /юбк[аи]|юбка-шорты/i, category: 'skirt', why: 'юбка' },
  { has: /брюк|джинс|джоггер|палаццо|чинос|клёш|клеш/i, category: 'trousers', why: 'брюки' },

  // --- Верх, размеченный до появления своих категорий.
  { has: /рубашк|сорочк/i, category: 'shirt', why: 'рубашка' },
  { has: /блузк/i, category: 'blouse', why: 'блузка' },
  { has: /плать/i, category: 'dress', why: 'платье' },
  { has: /свитер|джемпер|пуловер/i, category: 'sweater', why: 'свитер' },
  // Аксессуары и всё остальное в реестре не значатся вовсе.
  {
    has: /очки|бейсболк|кепк|рюкзак|сумк|шапк|балаклав|шарф|халат|комбинезон|костюм/i,
    category: null,
    why: 'в реестре нет',
  },
];

interface Entry {
  id: string;
  group: string;
  svg_back: string | null;
  traits?: { category: Category | null; category_other: string | null } | null;
}

const dry = process.argv.includes('--dry');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { entries: Entry[] };

let promoted = 0;
let skipped = 0;
const byCategory = new Map<string, number>();
const unmatched: string[] = [];

for (const entry of manifest.entries) {
  const t = entry.traits;
  if (!t || t.category !== null || !t.category_other) continue;

  const rule = RULES.find((r) => r.has.test(t.category_other!));
  if (!rule || rule.category === null) {
    if (!rule) unmatched.push(t.category_other);
    skipped += 1;
    continue;
  }

  t.category = rule.category;
  promoted += 1;
  byCategory.set(rule.category, (byCategory.get(rule.category) ?? 0) + 1);
}

const inSearch = manifest.entries.filter((e) => e.traits?.category && e.svg_back).length;

console.log(`привязано листов: ${promoted}`);
for (const [category, n] of [...byCategory].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${category}: ${n}`);
}
console.log(`оставлено без категории: ${skipped}`);
if (unmatched.length) {
  console.log('не разобрано словарём:');
  for (const u of [...new Set(unmatched)].slice(0, 10)) console.log(`  · ${u}`);
}
console.log(`всего проходит в подбор (категория + вид спинки): ${inSearch}`);

if (dry) {
  console.log('\n--dry: файл не тронут');
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nманифест переписан: ${MANIFEST}`);
}
