import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderRfqPdf, rfqText, type RfqOptions } from '@seamster/docgen';
import type { Locale } from '@seamster/i18n';
import type { StyleSpec } from '@seamster/stylespec';
import { readJobTemplate, renderJobTemplate } from './templates.js';

/**
 * Лист на просчёт для джобы кабинета.
 *
 * Отдельный документ, а не раздел техпака. Фабрике на этапе просчёта нужно
 * понять, берётся она за заказ, и назвать цену; двадцать страниц в ответ на
 * «сколько будет стоить» — надёжный способ получить молчание. Полный пак
 * при этом никуда не девается: на листе стоит ссылка на него.
 */

export interface RfqSheet {
  /** Путь к собранному PDF на русском. */
  path: string;
  /**
   * Тот же лист на других языках.
   *
   * Китайская фабрика читает 报价单, а не «лист на просчёт»; готовить его
   * отдельной командой значит однажды отправить русский и получить
   * молчание, которое мы примем за отказ.
   */
  localized: { locale: Locale; path: string; text: string }[];
  /** Текст для мессенджера — его копируют и вставляют, а не переписывают. */
  text: string;
  /** Чего не хватает, чтобы лист сработал. Пусто — всё на месте. */
  gaps: string[];
}

/** Контакт бренда: кому фабрика отвечает. */
interface Who {
  name?: string;
  org?: string;
}

function contactOf(dir: string, who: Who, dataDir: string, token: string): RfqOptions['contact'] {
  // Собираем из трёх мест по убыванию точности: анкета пака, профиль
  // бренда, запись инвайта. Выдумывать здесь нечего — если контакта нет
  // нигде, лист скажет об этом красным, и это правильно.
  const out: NonNullable<RfqOptions['contact']> = {};
  try {
    const answers = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8')) as {
      brand_profile?: {
        company_name?: string;
        contact_name?: string;
        contact_phone?: string;
        contact_email?: string;
      };
    };
    const b = answers.brand_profile;
    if (b?.company_name) out.company = b.company_name;
    if (b?.contact_name) out.name = b.contact_name;
    if (b?.contact_phone) out.phone = b.contact_phone;
    if (b?.contact_email) out.email = b.contact_email;
  } catch {
    /* анкеты нет — идём дальше */
  }

  const profilePath = join(dataDir, 'profiles', `${token}.json`);
  if (existsSync(profilePath)) {
    try {
      const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
        legal?: { company?: string };
        contact?: { name?: string; phone?: string; email?: string };
      };
      if (!out.company && profile.legal?.company) out.company = profile.legal.company;
      if (!out.name && profile.contact?.name) out.name = profile.contact.name;
      if (!out.phone && profile.contact?.phone) out.phone = profile.contact.phone;
      if (!out.email && profile.contact?.email) out.email = profile.contact.email;
    } catch {
      /* профиль битый — не беда, он не единственный источник */
    }
  }

  if (!out.company && who.org) out.company = who.org;
  if (!out.name && who.name) out.name = who.name;
  return out;
}

function sizeRatioOf(dir: string): Record<string, number> | undefined {
  try {
    const answers = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8')) as {
      size_ratio?: Record<string, number>;
    };
    return answers.size_ratio;
  } catch {
    return undefined;
  }
}

/**
 * Собрать лист на просчёт и текст к нему.
 *
 * PDF пишется в каталог джобы: его отдают бренду по ссылке и прикладывают
 * к сообщению. Браузер передаётся снаружи — на просчёт жмут редко, но
 * поднимать chromium ради одного листа всё равно расточительно, если он
 * уже открыт.
 */
export async function buildRfq(
  dir: string,
  spec: StyleSpec,
  who: Who,
  options: {
    dataDir: string;
    token: string;
    packLink?: string | undefined;
    /** Языки помимо русского. Русский собирается всегда. */
    locales?: readonly Locale[];
  },
): Promise<RfqSheet> {
  const contact = contactOf(dir, who, options.dataDir, options.token);
  const sizeRatio = sizeRatioOf(dir);

  // Силуэт берём тот же, что в паке: два документа об одном изделии не
  // должны выглядеть по-разному.
  const chosen = readJobTemplate(dir);
  const library = chosen.id ? renderJobTemplate(spec, chosen.id, 'ru', 'sketch') : null;

  const rfqOptions: RfqOptions = {
    contact,
    ...(sizeRatio ? { sizeRatio } : {}),
    ...(library ? { flat: { svg: library.front.svg } } : {}),
    ...(options.packLink ? { packLink: options.packLink } : {}),
  };

  const path = join(dir, 'rfq.pdf');
  writeFileSync(path, await renderRfqPdf(spec, rfqOptions));

  const text = rfqText(spec, rfqOptions);
  writeFileSync(join(dir, 'rfq.txt'), text + '\n');

  const localized: RfqSheet['localized'] = [];
  for (const locale of new Set(options.locales ?? [])) {
    if (locale === 'ru') continue;
    const localeOptions = { ...rfqOptions, locale };
    const localePath = join(dir, `rfq-${locale}.pdf`);
    writeFileSync(localePath, await renderRfqPdf(spec, localeOptions));
    const localeText = rfqText(spec, localeOptions);
    writeFileSync(join(dir, `rfq-${locale}.txt`), localeText + '\n');
    localized.push({ locale, path: localePath, text: localeText });
  }

  // Пробелы называем поимённо: «что-то не заполнено» никого не заставит
  // открыть профиль, а «фабрике некуда ответить» — заставит.
  const gaps: string[] = [];
  // Имя без телефона и почты — не канал ответа. Фабрика не пишет «Данилу»,
  // она пишет на номер или адрес, и лист с одним именем читается как
  // заполненный, оставаясь бесполезным.
  if (!contact?.phone && !contact?.email) {
    gaps.push('телефон или почта для ответа не указаны — фабрике некуда написать');
  }
  if (!sizeRatio) {
    gaps.push('раскладка по размерам не задана — фабрика считает цену по ней, а не по тиражу');
  }
  return { path, text, localized, gaps };
}
