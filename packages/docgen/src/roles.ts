import type { DocSection } from './html.js';

/**
 * Выгрузка по ролям цеха.
 *
 * knowledge-base/07 §6.6: каждый документ уходит своему адресату — табель мер
 * в ОТК, спецификация деталей закройщику, расчётник снабжению. Присылать всем
 * один толстый файл значит заставлять цех искать в нём своё.
 *
 * Ни у одного конкурента такой выгрузки нет.
 */
export const EXPORT_ROLES = ['full', 'technologist', 'cutter', 'qc', 'supply'] as const;
export type ExportRole = (typeof EXPORT_ROLES)[number];

export interface RoleProfile {
  label_ru: string;
  /** Кому и зачем — попадает в сопроводительное письмо фабрике. */
  purpose_ru: string;
  sections: readonly DocSection[];
  /** Технолог и закройщик читают коды и SPI, заказчик — нет. */
  pro: boolean;
}

export const ROLE_PROFILES: Record<ExportRole, RoleProfile> = {
  full: {
    label_ru: 'полный',
    purpose_ru: 'весь комплект для размещения заказа',
    sections: [
      'cover',
      'preview',
      'flats',
      'measurements',
      'bom',
      'construction',
      'labels',
      'patterns',
    ],
    pro: true,
  },
  technologist: {
    label_ru: 'технологу',
    purpose_ru: 'узлы обработки, коды швов и технологическая последовательность',
    sections: ['cover', 'preview', 'flats', 'construction'],
    pro: true,
  },
  cutter: {
    label_ru: 'закройщику',
    purpose_ru: 'чертёж, замеры и припуски для раскроя',
    sections: ['cover', 'preview', 'flats', 'measurements', 'patterns'],
    pro: true,
  },
  qc: {
    label_ru: 'ОТК',
    purpose_ru: 'табель мер с допусками для приёмки',
    sections: ['cover', 'preview', 'measurements'],
    pro: false,
  },
  supply: {
    label_ru: 'снабжению',
    purpose_ru: 'материалы, расход и маркировка для закупки',
    sections: ['cover', 'preview', 'bom', 'labels'],
    pro: false,
  },
};

export function roleProfile(role: ExportRole): RoleProfile {
  return ROLE_PROFILES[role];
}
