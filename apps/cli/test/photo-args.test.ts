import { describe, expect, it } from 'vitest';
import { isSpecFormError } from '@specform/core';
import { parsePhotoArg, viewFromName } from '../src/generate.js';

/**
 * Ракурс кадра объявляется явно либо угадывается по имени файла.
 *
 * Угадывание существует ради concierge-режима: файлы там называем мы сами,
 * и `hoodie-back.png` не должен требовать отдельного флага. Но угадывание —
 * это догадка, и она обязана быть узкой: ложное срабатывание тут значит,
 * что модель ищет спинку на снимке переда.
 */
describe('разбор аргумента --photos', () => {
  it('явный префикс задаёт ракурс', () => {
    expect(parsePhotoArg('back_flat:a.png')).toEqual({ path: 'a.png', view: 'back_flat' });
  });

  it('короткий псевдоним тоже работает — писать back_flat каждый раз незачем', () => {
    expect(parsePhotoArg('back:a.png')).toEqual({ path: 'a.png', view: 'back_flat' });
    expect(parsePhotoArg('спинка:a.png')).toEqual({ path: 'a.png', view: 'back_flat' });
  });

  it('без префикса ракурс угадывается по имени файла', () => {
    expect(parsePhotoArg('golden/photos/hoodie-back.png').view).toBe('back_flat');
    expect(parsePhotoArg('фото/худи-спинка.jpg').view).toBe('back_flat');
  });

  it('угадывает по целому слову, а не по вхождению', () => {
    // «frontier» не вид спереди, «backup» не вид сзади.
    expect(viewFromName('frontier.jpg')).toBeUndefined();
    expect(viewFromName('backup-2.png')).toBeUndefined();
  });

  it('незнакомый ракурс отвергается с подсказкой, а не молча игнорируется', () => {
    try {
      parsePhotoArg('сбоку:a.png');
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSpecFormError(e)).toBe(true);
      if (isSpecFormError(e)) expect(e.userAction).toContain('front_flat');
    }
  });

  it('путь Windows и URL не принимаются за префикс ракурса', () => {
    expect(parsePhotoArg('C:/фото/a.png').path).toBe('C:/фото/a.png');
    expect(parsePhotoArg('https://example.com/a.png').path).toBe('https://example.com/a.png');
  });

  it('обычный путь без подсказок остаётся без ракурса', () => {
    expect(parsePhotoArg('a.png')).toEqual({ path: 'a.png' });
  });
});
