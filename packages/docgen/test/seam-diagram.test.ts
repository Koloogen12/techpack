import { describe, expect, it } from 'vitest';
import { kb } from '@seamster/kb';
import { seamDiagramSvg } from '../src/seam-diagram.js';

/**
 * Схема шва — то, по чему технолог читает узел. Проверяется не «функция
 * вернула строку», а то, что каждый код шва, на который ссылаются узлы,
 * действительно получает рисунок, и что рисунок отличает вещи, которые
 * обязан отличать.
 */
describe('схема шва', () => {
  const base = kb();
  const nodes = base.nodesFor('hoodie');

  it('строится для каждого шва, который используют узлы худи', () => {
    const missing = nodes
      .map((n) => n.seam_code)
      .filter((code) => !seamDiagramSvg(base.seamOrNull(code)?.diagram, { stitchCode: '301' }));
    expect(missing).toEqual([]);
  });

  it('без описания устройства рисунка нет — пустая рамка честнее выдумки', () => {
    expect(seamDiagramSvg(undefined)).toBeNull();
  });

  it('распошив кладёт две линии, а челночная — одну', () => {
    const hem = base.seamOrNull('6.06.01')?.diagram;
    const one = seamDiagramSvg(hem, { stitchCode: '301' }) ?? '';
    const two = seamDiagramSvg(hem, { stitchCode: '406' }) ?? '';
    const three = seamDiagramSvg(hem, { stitchCode: '407' }) ?? '';
    const rows = (svg: string): number => (svg.match(/class="st"/g) ?? []).length;
    expect(rows(one)).toBe(1);
    expect(rows(two)).toBe(2);
    expect(rows(three)).toBe(3);
  });

  it('обмёточный стежок рисует обмётку среза, челночный — нет', () => {
    const plain = base.seamOrNull('1.01.01')?.diagram;
    expect(seamDiagramSvg(plain, { stitchCode: '504' })).toContain('class="ov"');
    expect(seamDiagramSvg(plain, { stitchCode: '301' })).not.toContain('class="ov"');
  });

  it('подгибка с закрытым срезом отличается от подгибки с открытым', () => {
    const open = seamDiagramSvg(base.seamOrNull('6.02.01')?.diagram, { stitchCode: '301' });
    const closed = seamDiagramSvg(base.seamOrNull('6.03.01')?.diagram, { stitchCode: '301' });
    expect(open).not.toBe(closed);
  });

  it('окантовка рисует полоску вокруг среза', () => {
    expect(seamDiagramSvg(base.seamOrNull('3.01.01')?.diagram, { stitchCode: '602' })).toContain(
      'class="bind"',
    );
  });
});
