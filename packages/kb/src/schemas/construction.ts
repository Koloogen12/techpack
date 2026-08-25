import { z } from 'zod';
import {
  CategorySchema,
  RangeSchema,
  RefBookMetaSchema,
  VerifiabilitySchema,
  verifiabilityRefinement,
} from './common.js';

/**
 * Типы швейного оборудования.
 *
 * Смысл этого перечисления — machine-park check (дифференциатор R6):
 * фабрика читает техпак через свой парк машин. Написано 406 — нужна
 * распошивалка; замена на 301 на трикотаже даёт брак (knowledge-base/07 §5).
 */
export const MACHINE_TYPES = [
  'single_needle_lockstitch',
  'twin_needle_lockstitch',
  'overlock_3',
  'overlock_4',
  'overlock_5',
  'coverstitch_2n',
  'coverstitch_3n',
  'flatlock',
  'buttonhole',
  'button_sew',
  'bartack',
  'blindstitch',
  'eyelet_press',
  'fusing_press',
  'iron',
  'manual',
] as const;
export const MachineTypeSchema = z.enum(MACHINE_TYPES);
export type MachineType = z.infer<typeof MachineTypeSchema>;

export const MACHINE_LABEL_RU: Record<MachineType, string> = {
  single_needle_lockstitch: 'прямострочная универсальная',
  twin_needle_lockstitch: 'двухигольная',
  overlock_3: 'оверлок 3-ниточный',
  overlock_4: 'оверлок 4-ниточный',
  overlock_5: 'оверлок 5-ниточный',
  coverstitch_2n: 'распошивальная (плоскошовная), 2 иглы',
  coverstitch_3n: 'распошивальная, 3 иглы',
  flatlock: 'флэтлок (плоскошовная с верхним застилом)',
  buttonhole: 'петельная',
  button_sew: 'пуговичная',
  bartack: 'закрепочная',
  blindstitch: 'подшивочная потайная',
  eyelet_press: 'пресс для люверсов',
  fusing_press: 'дублирующий пресс',
  iron: 'утюг / парогенератор',
  manual: 'ручная операция',
};

/** Специальность операции в технологической последовательности (knowledge-base/04 §5). */
export const SPECIALTIES = ['M', 'S', 'A', 'R', 'U', 'P'] as const;
export const SpecialtySchema = z.enum(SPECIALTIES);
export type Specialty = z.infer<typeof SpecialtySchema>;

export const SPECIALTY_LABEL_RU: Record<Specialty, string> = {
  M: 'машинная',
  S: 'спецмашинная',
  A: 'автомат',
  R: 'ручная',
  U: 'утюжильная',
  P: 'прессовая',
};

/** Стежок по ГОСТ 12807 = ISO 4915. Один словарь покрывает и РФ, и мировой техпак. */
export const StitchCodeSchema = z
  .object({
    code: z.string().regex(/^\d{3}$/),
    name_ru: z.string().min(1),
    name_en: z.string().min(1),
    machine: MachineTypeSchema,
    application_ru: z.string().min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const StitchCodesFileSchema = RefBookMetaSchema.extend({
  stitches: z.array(StitchCodeSchema).min(1),
});

/** Шов по ISO 4916 / ГОСТ 12807. */
export const SeamCodeSchema = z
  .object({
    /** Класс + конфигурация, например «1.01.01». */
    code: z.string().min(3),
    name_ru: z.string().min(1),
    name_en: z.string().min(1),
    /** Класс ISO 4916: 1 superimposed … 8 ограниченный с двух сторон. */
    iso_class: z.number().int().min(1).max(8),
    application_ru: z.string().min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const SeamCodesFileSchema = RefBookMetaSchema.extend({
  seams: z.array(SeamCodeSchema).min(1),
});

/** Зоны изделия. Порядок в списке = порядок разделов в документе. */
export const NODE_ZONES = [
  'neckline',
  'shoulders',
  'sleeves',
  'sides',
  'hem',
  'pockets',
  'closure',
  'waistband',
  'hood',
  'labels',
] as const;
export const NodeZoneSchema = z.enum(NODE_ZONES);
export type NodeZone = z.infer<typeof NodeZoneSchema>;

export const ZONE_LABEL_RU: Record<NodeZone, string> = {
  neckline: 'горловина',
  shoulders: 'плечевые швы',
  sleeves: 'рукава',
  sides: 'боковые швы',
  hem: 'низ изделия',
  pockets: 'карманы',
  closure: 'застёжка',
  waistband: 'пояс',
  hood: 'капюшон',
  labels: 'маркировка',
};

/**
 * Узел обработки.
 *
 * Каждый узел несёт код шва, стежок, SPI и машину (дифференциатор R5:
 * у конкурента «вносите вручную»), а также флаг видимости с фото —
 * невидимое уходит в документ как предположение, а не подставляется молча
 * (knowledge-base/04 §7).
 */
export const ConstructionNodeSchema = z
  .object({
    id: z.string().min(1),
    zone: NodeZoneSchema,
    /** Название узла на языке технолога. */
    label_ru: z.string().min(1),
    /** То же простыми словами — для основателя бренда без техбэкграунда. */
    plain_ru: z.string().min(1),
    seam_code: z.string().min(3),
    stitch_code: z.string().regex(/^\d{3}$/),
    /** Стежков на дюйм. Требование R5. */
    spi: z.number().int().positive(),
    machine: MachineTypeSchema,
    specialty: SpecialtySchema,
    seam_allowance_cm: RangeSchema.extend({ default: z.number().positive() }),
    /** Готовый размер элемента, см: ширина бейки, высота манжеты, глубина подгибки. */
    finished_cm: RangeSchema.extend({ default: z.number().positive() }).optional(),
    /**
     * Виден ли узел на фото изделия.
     * false → значение в документе получает статус «предположение».
     */
    visible_on_photo: z.boolean(),
    /**
     * Ключ признака из карты видимости, подтверждающий этот узел.
     *
     * Если vision-этап сообщил про этот признак, узел получает статус
     * «оценка по фото» вместо «типовое значение». Без ключа узел остаётся
     * типовым даже когда виден: подтвердить его нечем.
     */
    photo_key: z.string().min(1).nullable(),
    /** Узел требует машины вне базового парка цеха. Даёт флаг и альтернативу. */
    requires_special_equipment: z.boolean(),
    /** Замена под базовый парк. Обязательна, если требуется спецоборудование. */
    alternative_node_id: z.string().nullable(),
    applies_to: z.array(CategorySchema).min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement)
  .superRefine((n, ctx) => {
    if (n.requires_special_equipment && n.alternative_node_id === null) {
      ctx.addIssue({
        code: 'custom',
        message:
          `узел ${n.id} требует спецоборудования, но не предлагает замены под базовый цех — ` +
          `фабрика получит невыполнимое требование без выхода`,
        path: ['alternative_node_id'],
      });
    }
    const sa = n.seam_allowance_cm;
    if (sa.default < sa.min || sa.default > sa.max) {
      ctx.addIssue({
        code: 'custom',
        message: `припуск ${sa.default} вне диапазона ${sa.min}…${sa.max}`,
        path: ['seam_allowance_cm', 'default'],
      });
    }
  });

export const ConstructionNodesFileSchema = RefBookMetaSchema.extend({
  nodes: z.array(ConstructionNodeSchema).min(1),
}).superRefine((file, ctx) => {
  const ids = new Set(file.nodes.map((n) => n.id));
  for (const node of file.nodes) {
    if (node.alternative_node_id && !ids.has(node.alternative_node_id)) {
      ctx.addIssue({
        code: 'custom',
        message: `узел ${node.id} ссылается на несуществующую замену ${node.alternative_node_id}`,
        path: ['nodes'],
      });
    }
  }
});

/**
 * Парк машин цеха.
 *
 * Базовый профиль — реальный цех на 10 человек: универсалка, оверлок,
 * распошивалка, петельная, пуговичная, утюг (knowledge-base/07 §5).
 * Всё сверх него докупается только под повторные заказы.
 */
export const MachineParkProfileSchema = z
  .object({
    id: z.string().min(1),
    label_ru: z.string().min(1),
    machines: z.array(MachineTypeSchema).min(1),
  })
  .and(VerifiabilitySchema)
  .superRefine(verifiabilityRefinement);

export const MachineParkFileSchema = RefBookMetaSchema.extend({
  /** Профиль, относительно которого считается machine-park check по умолчанию. */
  default_profile: z.string().min(1),
  profiles: z.array(MachineParkProfileSchema).min(1),
});

export type StitchCode = z.infer<typeof StitchCodeSchema>;
export type SeamCode = z.infer<typeof SeamCodeSchema>;
export type ConstructionNode = z.infer<typeof ConstructionNodeSchema>;
export type MachineParkProfile = z.infer<typeof MachineParkProfileSchema>;
export type StitchCodesFile = z.infer<typeof StitchCodesFileSchema>;
export type SeamCodesFile = z.infer<typeof SeamCodesFileSchema>;
export type ConstructionNodesFile = z.infer<typeof ConstructionNodesFileSchema>;
export type MachineParkFile = z.infer<typeof MachineParkFileSchema>;
