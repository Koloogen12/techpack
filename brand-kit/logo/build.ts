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
