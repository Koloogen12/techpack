import type { Point } from './geometry.js';

/**
 * Примитивы построения путей. Общие для всех видов чертежа: перед, спинка
 * и бок обязаны рисоваться одними и теми же средствами, иначе кривые на них
 * получатся разного характера и набор перестанет читаться как один чертёж.
 */

export const f = (n: number): string => (Math.round(n * 1000) / 1000).toString();
export const M = (p: Point): string => `M ${f(p.x)} ${f(p.y)}`;
export const L = (p: Point): string => `L ${f(p.x)} ${f(p.y)}`;
export const C = (c1: Point, c2: Point, p: Point): string =>
  `C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p.x)} ${f(p.y)}`;

export const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
