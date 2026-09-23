import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import {
  applyArtwork,
  imageInfo,
  mergeArtworkInput,
  type StoredArtwork,
} from '../server/artwork.js';

const INPUT: StyleSpecInput = {
  id: 'art-store',
  name: 'Худи',
  article: 'AS-001',
  category: 'hoodie',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-23T00:00:00.000Z'),
};

const { spec } = buildStyleSpec(INPUT);

/** PNG 640×480 с альфой — только заголовок, без данных. */
function png(width: number, height: number, colorType: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8;
  b[25] = colorType;
  return b;
}

/** JPEG с одним маркером SOF0: высота, ширина. */
function jpeg(width: number, height: number): Buffer {
  const b = Buffer.alloc(24, 0);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[3] = 0xc0;
  b.writeUInt16BE(17, 4);
  b[6] = 8;
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  return b;
}

describe('хранилище макетов нанесения', () => {
  it('размер растра читается из заголовка PNG и JPEG, вектор остаётся вектором', () => {
    expect(imageInfo(png(640, 480, 6), 'logo.png')).toEqual({
      format: 'png',
      pixels: { width: 640, height: 480 },
      transparent: true,
    });
    expect(imageInfo(png(10, 10, 2), 'x.png')?.transparent).toBe(false);
    expect(imageInfo(jpeg(1200, 900), 'photo.jpg')).toEqual({
      format: 'jpg',
      pixels: { width: 1200, height: 900 },
      transparent: false,
    });
    expect(
      imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.svg'),
    ).toEqual({
      format: 'svg',
    });
    expect(imageInfo(Buffer.from('hello'), 'a.txt')).toBeNull();
  });

  it('вход из кабинета проверяется по зонам категории и округляется до 0,5 см', () => {
    const r = mergeArtworkInput(
      [],
      [{ pid: 'abcd1234', zone: 'chest_center', width_cm: '27.3', height_cm: 20.26, offset_cm: 9 }],
      'hoodie',
    );
    expect(r.rejected).toBeNull();
    expect(r.items[0]).toMatchObject({
      pid: 'abcd1234',
      zone: 'chest_center',
      width_cm: 27.5,
      height_cm: 20.5,
      offset_cm: 9,
    });
    expect(
      mergeArtworkInput([], [{ pid: 'abcd1234', zone: 'lapel' }], 'hoodie').rejected,
    ).toContain('lapel');
    expect(mergeArtworkInput([], [{ zone: 'chest_center' }], 'hoodie').rejected).toContain(
      'идентификатора',
    );
  });

  it('файл переживает пересохранение строк: кабинет файлами не распоряжается', () => {
    const previous: StoredArtwork[] = [
      {
        pid: 'abcd1234',
        zone: 'chest_center',
        file: {
          name: 'logo.png',
          format: 'png',
          pixels: { width: 3000, height: 2000 },
          path: 'artwork/x.png',
          bytes: 10,
        },
      },
    ];
    const r = mergeArtworkInput(
      previous,
      [{ pid: 'abcd1234', zone: 'chest_center', width_cm: 25 }],
      'hoodie',
    );
    expect(r.items[0]!.file?.name).toBe('logo.png');
  });

  it('раздел нанесения спеки пересобирается движком: проверки и предупреждения на месте', () => {
    const items: StoredArtwork[] = [
      { pid: 'abcd1234', zone: 'chest_center', width_cm: 28, height_cm: 20, offset_cm: 10 },
      {
        pid: 'efgh5678',
        zone: 'back_full',
        width_cm: 30,
        height_cm: 40,
        lateral_cm: 0,
        file: {
          name: 'back.png',
          format: 'png',
          pixels: { width: 1200, height: 1600 },
          path: 'artwork/b.png',
          bytes: 10,
        },
      },
    ];
    const r = applyArtwork(spec, items);
    expect(r.spec.artwork!.placements.map((a) => a.id)).toEqual(['A1', 'A2']);
    const back = r.spec.artwork!.placements[1]!;
    expect(back.file_name).toBe('back.png');
    // 1200 px на 30 см — 102 dpi: печатнику об этом скажет светофор.
    expect(back.checks.find((c) => c.id === 'dpi')?.status).toBe('fail');
    expect(back.lateral_offset_cm?.value).toBe(0);
    // Пустой список снимает раздел целиком.
    expect(applyArtwork(r.spec, []).spec.artwork).toBeUndefined();
  });
});
