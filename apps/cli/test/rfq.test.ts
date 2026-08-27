import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStyleSpec, type StyleSpec } from '@seamsterly/stylespec';
import { RFQ_TEXT_LIMIT, renderRfqHtml, rfqSizeLine, rfqText } from '@seamsterly/docgen';
import { emptyRfqLog, parseRfqLog, summariseRfq, RAT1_TAKE_RATE } from '../src/rfq-log.js';

const load = (file: string): StyleSpec =>
  parseStyleSpec(
    JSON.parse(
      readFileSync(
        new URL(`../../../packages/stylespec/examples/${file}`, import.meta.url),
        'utf8',
      ),
    ),
  );

const SPEC = load('tshirt-women-46.json');
const PATTERN = load('hoodie-allover-pattern.json');

const CONTACT = { name: 'Данил', phone: '+7 900 000-00-00', email: 'z@primer.ru' };

/**
 * Текст для мессенджера обязан ВСЕГДА влезать в одно сообщение. Длинное
 * сообщение читают по диагонали, а разбитое на части теряет начало —
 * и первым теряется то, ради чего писали.
 */
describe('текст на просчёт', () => {
  it('влезает в предел на обычной спеке', () => {
    expect(rfqText(SPEC, { contact: CONTACT }).length).toBeLessThanOrEqual(RFQ_TEXT_LIMIT);
  });

  it('влезает и на спеке, у которой особенностей много', () => {
    expect(rfqText(PATTERN, { contact: CONTACT }).length).toBeLessThanOrEqual(RFQ_TEXT_LIMIT);
  });

  it('влезает при абсурдно длинном контакте — режет по границе слова', () => {
    const text = rfqText(SPEC, {
      contact: { name: 'Очень Длинное Имя '.repeat(30), phone: '+7 900 000-00-00' },
    });
    expect(text.length).toBeLessThanOrEqual(RFQ_TEXT_LIMIT);
    // Обрубок посреди слова читается как сбой отправителя.
    expect(text.endsWith('…')).toBe(true);
  });

  it('имя без телефона и почты контактом не считается', () => {
    // «Связь: Данил» выглядит заполненной строкой и остаётся тупиком:
    // фабрика не пишет имени, она пишет на номер или адрес.
    expect(rfqText(SPEC, { contact: { name: 'Данил' } })).not.toContain('Связь');
  });

  it('контакт отпадает последним — без него сообщение бессмысленно', () => {
    const ratio = Object.fromEntries(SPEC.base.size_range.map((ru) => [String(ru), 999999]));
    const text = rfqText(SPEC, { contact: CONTACT, sizeRatio: ratio });
    expect(text).toContain('+7 900 000-00-00');
  });

  it('начинается с того, что спрашивают первым', () => {
    expect(rfqText(SPEC, { contact: CONTACT }).startsWith('Просчёт:')).toBe(true);
  });

  it('обещает техпак по запросу, а не прикладывает его', () => {
    // Прислать двадцать страниц в ответ на «сколько стоит» значит получить
    // молчание.
    expect(rfqText(SPEC, { contact: CONTACT })).toContain('по запросу');
  });

  it('со ссылкой на пак зовёт открыть его, а не просить', () => {
    // Запрос — это лишний шаг и лишний день, а текст от ссылки не толстеет.
    const link = 'https://seamster.pro/p/abc123';
    const text = rfqText(SPEC, { contact: CONTACT, packLink: link });
    expect(text).toContain(link);
    expect(text).not.toContain('по запросу');
    expect(text.length).toBeLessThanOrEqual(RFQ_TEXT_LIMIT);
  });
});

describe('размерный ряд', () => {
  it('без раскладки говорит об этом прямо, а не выдумывает ровное деление', () => {
    expect(rfqSizeLine(SPEC)).toContain('уточняется');
  });

  it('с раскладкой печатает штуки по размерам', () => {
    expect(rfqSizeLine(SPEC, { '46': 30, '48': 20 })).toContain('46: 30');
  });

  it('размер без доли показывается нулём, а не пропускается', () => {
    // Пропустить размер значит показать ряд короче заявленного.
    expect(rfqSizeLine(SPEC, { '46': 30 })).toContain('48: 0');
  });
});

describe('лист на просчёт', () => {
  it('без контакта говорит, что фабрике некуда ответить', () => {
    expect(renderRfqHtml(SPEC)).toContain('некуда ответить');
  });

  it('имя без канала связи всё равно помечает предупреждением', () => {
    // Строка «ИП Кочнев · Данил» выглядит заполненной и остаётся тупиком:
    // ответить фабрика может на номер или адрес, но не на имя.
    const html = renderRfqHtml(SPEC, { contact: { company: 'ИП Кочнев', name: 'Данил' } });
    expect(html).toContain('Данил');
    expect(html).toContain('некуда ответить');
  });

  it('с телефоном предупреждения нет', () => {
    const html = renderRfqHtml(SPEC, { contact: { name: 'Данил', phone: '+7 900 000-00-00' } });
    expect(html).toContain('+7 900 000-00-00');
    expect(html).not.toContain('некуда ответить');
  });

  it('несёт эскиз, а не только таблицу', () => {
    expect(renderRfqHtml(SPEC, { contact: CONTACT })).toContain('<svg');
  });

  it('спрашивает ровно четыре вещи, включая что фабрика отдаёт подрядчику', () => {
    const h = renderRfqHtml(SPEC, { contact: CONTACT });
    expect(h).toContain('Минимальная партия');
    expect(h).toContain('подрядчику');
  });

  it('печатается портретом — его отправляют почтой, а не подшивают к паку', () => {
    expect(renderRfqHtml(SPEC)).toContain('A4 portrait');
  });
});

describe('журнал ответов', () => {
  const CSV = [
    'factory,city,sent,replied,price,moq,lead_days,takes,note',
    'Швейник,Иваново,2026-09-01,2026-09-03,780,100,21,да,',
    'Швейпром,Москва,2026-09-01,2026-09-05,1 050,200,18,да,образец',
    'Юг,Ростов,2026-09-01,,,,,нет,молчит',
    'Тула,Тула,2026-09-01,2026-09-02,690,300,25,нет,минимум 300',
  ].join('\n');

  it('терпит оформление, которое ставит человек в таблице', () => {
    // Пробел в числе, пустые ячейки, лишние пробелы по краям.
    const { responses } = parseRfqLog(CSV);
    expect(responses).toHaveLength(4);
    expect(responses[1]!.price).toBe(1050);
  });

  it('строку без даты отправки не молча теряет, а называет', () => {
    const { responses, problems } = parseRfqLog(`${CSV}\nБезДаты,Тверь,завтра,,,,,да,`);
    expect(responses).toHaveLength(4);
    expect(problems.join(' ')).toContain('БезДаты');
  });

  it('доли считаются от ОТПРАВЛЕННЫХ, а не от ответивших', () => {
    // Девять молчаний и один «да» дали бы сто процентов при счёте
    // от ответивших — обычный способ получить красивую цифру.
    const s = summariseRfq(parseRfqLog(CSV).responses);
    expect(s.sent).toBe(4);
    expect(s.replied).toBe(3);
    expect(s.take_rate).toBe(0.5);
    expect(s.reply_rate).toBe(0.75);
  });

  it('считает медианы цены, партии и срока ответа', () => {
    const s = summariseRfq(parseRfqLog(CSV).responses);
    expect(s.median_price).toBe(780);
    expect(s.price_range).toEqual([690, 1050]);
    expect(s.median_moq).toBe(200);
    expect(s.median_reply_days).toBe(2);
  });

  it('порог стоп-крана — доля берущихся, а не отвечающих', () => {
    const s = summariseRfq(parseRfqLog(CSV).responses);
    expect(s.take_rate < RAT1_TAKE_RATE).toBe(true);
    expect(s.reply_rate > RAT1_TAKE_RATE).toBe(true);
  });

  it('пустой журнал несёт шапку и пример, а не только запятые', () => {
    const log = emptyRfqLog();
    expect(log).toContain('factory,city,sent');
    expect(log).toContain('Пример:');
  });

  it('пустой журнал разбирается в ноль записей без жалоб', () => {
    expect(parseRfqLog(emptyRfqLog())).toEqual({ responses: [], problems: [] });
  });
});

describe('лист и пак показывают одно изделие', () => {
  it('берёт силуэт пака, когда он задан', () => {
    // Иначе лист рисовал бы параметрический вид, а пак — библиотечный, и
    // фабрика первой спросит: «а это точно та же вещь?»
    const html = renderRfqHtml(SPEC, { flat: { svg: '<svg id="из-библиотеки"></svg>' } });
    expect(html).toContain('из-библиотеки');
  });

  it('без силуэта строит вид сам', () => {
    expect(renderRfqHtml(SPEC)).toContain('<svg');
  });

  it('со ссылкой на пак печатает её вместо «пришлём по запросу»', () => {
    const html = renderRfqHtml(SPEC, { packLink: 'https://seamster.pro/p/abc123' });
    expect(html).toContain('seamster.pro/p/abc123');
    expect(html).not.toContain('Пришлём по запросу');
  });
});

describe('лист на языке фабрики', () => {
  const CYRILLIC = /[А-Яа-яЁё]/;

  it.each(['en', 'zh'] as const)('%s: в тексте нет наших слов', (locale) => {
    // Просчёт — первый контакт с фабрикой, и непонятная бумага на нём
    // заканчивается. Русские остатки здесь дороже, чем в паке.
    const text = rfqText(SPEC, { contact: CONTACT, locale });
    // Имя контакта — данные бренда, их не переводят; проверяем остальное.
    const withoutContact = text.replace(CONTACT.name ?? '', '');
    expect(withoutContact).not.toMatch(CYRILLIC);
  });

  it.each(['en', 'zh'] as const)('%s: в вёрстке листа нет наших подписей', (locale) => {
    const html = renderRfqHtml(SPEC, { locale });
    for (const ru of ['Лист на просчёт', 'Что нужно от вас', 'Кому отвечать', 'уточняется']) {
      expect(html, ru).not.toContain(ru);
    }
  });

  it('китайский лист называет себя 报价单', () => {
    expect(renderRfqHtml(SPEC, { locale: 'zh' })).toContain('报价单');
  });

  it('и на китайском влезает в предел мессенджера', () => {
    // Иероглиф несёт больше смысла на знак, но предел считается в знаках,
    // и сокращение блоков обязано работать одинаково на всех языках.
    expect(rfqText(PATTERN, { contact: CONTACT, locale: 'zh' }).length).toBeLessThanOrEqual(
      RFQ_TEXT_LIMIT,
    );
  });

  it('русский остаётся языком по умолчанию', () => {
    expect(rfqText(SPEC, { contact: CONTACT })).toContain('Просчёт');
  });
});
