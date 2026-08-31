#!/usr/bin/env tsx
/**
 * Словесный знак seamster.
 *
 *   pnpm brand:logo
 *
 * Знак НЕ набирается шрифтом: гарнитуры варианта 09 у нас нет, есть только его
 * контуры. Поэтому буквы берутся из исходной генерации как контуры и от слова
 * отрезается хвост «ly» — форма букв при этом не трогается ни на единицу.
 *
 * В исходнике сквозь «l» и «y» шла пунктирная строчка. Она уходит вместе с
 * хвостом, и это не потеря: строчка читалась ритмом только потому, что между
 * узкими буквами много фона. Перенесённая на плотное «seam» или «ster», та же
 * линия читается зачёркиванием, а в мелком кегле — сором у букв. Проверено на
 * обоих отрезках, оба отклонены. Не возвращать.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathBox, unionBox } from '../../packages/templates/src/svg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'source/v09-seamsterly.svg');

const INK = '#0E0E0E';
const PAPER = '#F4F2EF';

const src = readFileSync(SOURCE, 'utf8');
const tags = [...src.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
const dOf = (i: number): string => /\bd="([^"]*)"/.exec(tags[i]!)![1]!;

/**
 * s · e+контрсчёт · a+контрсчёт · m · s · t · e+контрсчёт · r, слева направо.
 * Хвост «ly» (пути 10, 14 с контрсчётами 11, 15) и штрихи строчки (16..19)
 * в набор не входят. Порядок здесь не важен — важен состав.
 */
const LETTERS = [9, 6, 7, 2, 3, 1, 8, 12, 4, 5, 13].map(dOf);

/** Сдвиг в начало координат: числа в d идут парами x,y, дуг в исходнике нет. */
function shift(path: string, dx: number, dy: number): string {
  let n = -1;
  return path.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (num) => {
    n++;
    return String(Number((Number(num) + (n % 2 === 0 ? dx : dy)).toFixed(2)));
  });
}

const box = unionBox(LETTERS.map(pathBox).filter((b) => b !== null))!;
const w = Number((box.maxX - box.minX).toFixed(2));
const h = Number((box.maxY - box.minY).toFixed(2));
const d = LETTERS.map((p) => shift(p, -box.minX, -box.minY)).join(' ');

/**
 * Контрсчёты внутри букв — отдельные подпути, а не вырезы. Дырку из них делает
 * fill-rule="evenodd": без него «e» и «a» зальются целиком.
 */
function mark(fill: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="${Math.round(w)}" height="${Math.round(h)}" role="img" aria-label="seamster">` +
    `<title>seamster</title>` +
    `<path fill="${fill}" fill-rule="evenodd" d="${d}"/></svg>\n`
  );
}

writeFileSync(join(HERE, 'seamster.svg'), mark(INK));
writeFileSync(join(HERE, 'seamster-paper.svg'), mark(PAPER));

// Карточка для превью и шапок: знак на фирменной бумаге с охранным полем.
const pad = Number((h * 0.9).toFixed(2));
writeFileSync(
  join(HERE, 'seamster-card.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + pad * 2} ${h + pad * 2}" ` +
    `width="${Math.round(w + pad * 2)}" height="${Math.round(h + pad * 2)}">` +
    `<rect width="100%" height="100%" fill="${PAPER}"/>` +
    `<g transform="translate(${pad} ${pad})">` +
    `<path fill="${INK}" fill-rule="evenodd" d="${d}"/></g></svg>\n`,
);

console.log(`знак собран: ${w}×${h}, охранное поле ${pad}`);

// ------------------------------------------------------------------ монограмма
/**
 * Плашка-квадрат со строчной «s» — для favicon и мест, где словесный знак не
 * помещается по ширине: шапка в узком окне, аватар, иконка приложения.
 *
 * Буква берётся из того же слова, а не рисуется заново: монограмма и знак
 * обязаны быть одной рукой, иначе на одном экране их видно как двух разных.
 */
const S = dOf(9);
const sBox = pathBox(S)!;
const sw = sBox.maxX - sBox.minX;
const sh = sBox.maxY - sBox.minY;

/** Плашка со строчной «s»: поле вокруг буквы и скругление — долями стороны. */
const SIDE = 100;
const sd = shift(S, -sBox.minX, -sBox.minY);

function plaque(inset: number, radius: number): string {
  const scale = Number(((SIDE * (1 - inset * 2)) / Math.max(sw, sh)).toFixed(4));
  const place =
    `translate(${((SIDE - sw * scale) / 2).toFixed(2)} ${((SIDE - sh * scale) / 2).toFixed(2)}) ` +
    `scale(${scale})`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIDE} ${SIDE}" width="${SIDE}" height="${SIDE}" ` +
    `role="img" aria-label="seamster"><title>seamster</title>` +
    `<rect width="${SIDE}" height="${SIDE}" rx="${(radius * SIDE).toFixed(0)}" fill="${INK}"/>` +
    `<g transform="${place}"><path fill="${PAPER}" d="${sd}"/></g></svg>\n`
  );
}

// Скругление как у плашки прототипа — 9 из 30 стороны.
writeFileSync(join(HERE, 'seamster-mark.svg'), plaque(0.26, 9 / 30));
// Favicon живёт на 16 px: буква крупнее и угол острее, иначе на вкладке каша.
writeFileSync(join(HERE, 'favicon.svg'), plaque(0.13, 0.2));

// Та же буква без плашки: ложится в готовый чёрный квадрат прототипа.
writeFileSync(
  join(HERE, 'seamster-s.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sw.toFixed(2)} ${sh.toFixed(2)}" ` +
    `width="${Math.round(sw)}" height="${Math.round(sh)}" role="img" aria-label="s">` +
    `<path fill="${PAPER}" d="${sd}"/></svg>\n`,
);

console.log(`монограмма: ${SIDE}×${SIDE}, буква ${sw.toFixed(0)}×${sh.toFixed(0)}`);
