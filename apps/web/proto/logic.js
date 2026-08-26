// Логика кабинета. Основа — ДОСЛОВНЫЙ порт класса Component из прототипа
// хендоффа (design_handoff_seamsterly/SpecForm - Воркспейс.dc.html):
// вся вёрстка, стили и поведение — прототипа, один в один. Поверх него —
// проводка реальных данных: инвайт, список паков, спека, живой чертёж,
// правка замеров, PDF. Без инвайт-токена кабинет работает ровно как
// прототип, на демо-данных — это и есть эталон для сверки с макетами.
//
// Файл исполняется рантаймом прототипа (support.js) через new Function —
// никаких import, только браузерные API и window.SeamsterlyEngine.

/* ================================================================ проводка */

const TOKEN = (() => {
  try {
    const u = new URL(location.href);
    const t = u.searchParams.get('t');
    if (t) {
      sessionStorage.setItem('seamsterly_invite', t);
      // Токен убирается из адресной строки: он не должен попасть в скриншот
      // созвона и в историю, которой делятся.
      u.searchParams.delete('t');
      history.replaceState(null, '', u.toString());
      return t;
    }
    return sessionStorage.getItem('seamsterly_invite');
  } catch {
    return null;
  }
})();

// Демо-режим прототипа: ?demo=1 без инвайта. Это эталон для сверки с
// макетами; обычный гость и инвайт-пользователь начинают с нуля —
// макетного техпака и сид-данных для них не существует.
const DEMO =
  !TOKEN &&
  (() => {
    try {
      return new URLSearchParams(location.search).get('demo') === '1';
    } catch {
      return false;
    }
  })();

const apiCall = async (path, init) => {
  const r = await fetch('/app/api' + path, {
    ...(init || {}),
    headers: { ...((init && init.headers) || {}), ...(TOKEN ? { 'x-invite': TOKEN } : {}) },
  });
  const b = await r.json().catch(() => null);
  if (!r.ok || b === null) throw new Error((b && b.error) || 'ошибка ' + r.status);
  return b;
};

const track = (type, payload) => {
  if (!TOKEN) return;
  fetch('/app/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-invite': TOKEN },
    body: JSON.stringify({ type, payload: payload || null }),
  }).catch(() => {});
};

const PDF_URL = (id) => '/app/api/jobs/' + id + '/pdf?t=' + encodeURIComponent(TOKEN || '');
const PHOTO_URL = (id, n) =>
  '/app/api/jobs/' + id + '/photo/' + n + '?t=' + encodeURIComponent(TOKEN || '');

const CAT_RU = {
  tshirt: 'Футболка',
  longsleeve: 'Лонгслив',
  sweatshirt: 'Свитшот',
  hoodie: 'Худи',
};
const CAT_OF = {
  Футболка: 'tshirt',
  Лонгслив: 'longsleeve',
  Свитшот: 'sweatshirt',
  Худи: 'hoodie',
};
const FIT_OF = {
  Прилегающая: 'fitted',
  Обычная: 'semi_fitted',
  Свободная: 'loose',
  Oversize: 'oversize',
};
const FIT_RU = {
  fitted: 'Прилегающая',
  semi_fitted: 'Обычная',
  loose: 'Свободная',
  oversize: 'Oversize',
};
const KIND_OF = {
  user_input: 'user',
  fit_confirmed: 'user',
  estimated_from_photo: 'photo',
  measured_by_scale: 'photo',
  default_from_base: 'lib',
  assumption: 'guess',
};
const KIND_HINT = {
  half: '1/2 обхвата',
  circumference: 'по обхвату',
  length: '',
  angle: 'градусы',
};

const MONTHS_RU = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];
const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const today = new Date();
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === today.toDateString()) return 'сегодня, ' + hm;
  return d.getDate() + ' ' + MONTHS_RU[d.getMonth()] + ', ' + hm;
};
const fmtDay = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.getDate() + ' ' + MONTHS_RU[d.getMonth()];
};
const f1 = (n) =>
  n === null || n === undefined || !isFinite(n)
    ? '—'
    : (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
const INT_OF = (ru, bru) =>
  ({ '-6': 'XXS', '-4': 'XS', '-2': 'S', 0: 'M', 2: 'L', 4: 'XL', 6: 'XXL' })[String(ru - bru)] ||
  (ru < bru ? 'XXS' : 'XXL');
// Без «;utf8»: рантайм прототипа разбирает inline-стили по «;», и точка
// с запятой внутри значения оборвала бы URI. Тело кодируется целиком.
const svgUrl = (svg) => 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
const plural = (n, one, few, many) => (n === 1 ? one : n > 1 && n < 5 ? few : many);

/* ====================================================== константы прототипа */

const ST = {
  user: { c: '#2F7C5A', l: 'указано вами' },
  photo: { c: '#0E0E0E', l: 'оценка по фото' },
  lib: { c: '#B0ADA6', l: 'типовое значение' },
  guess: { c: '#C0392B', l: 'предположение' },
};
const WHY = {
  user: 'Вы ввели это значение вручную — оно имеет высший приоритет и попадает в PDF как норма.',
  photo:
    'Оценили по фото photo-front.jpg через пропорции силуэта и эталон размера. Точность ±1–2 см.',
  lib: 'Типовое значение для трикотажного жакета из размерной базы (ГОСТ + отраслевые таблицы).',
  guess:
    'На фото эта зона не видна. Значение — расчётное предположение, подтвердите его по отшитому образцу.',
};
const SECTIONS = [
  { id: 'cover', label: 'Обзор', sub: 'стиль и визуал' },
  { id: 'flats', label: 'Чертёж', sub: 'виды и слои' },
  { id: 'pom', label: 'Замеры', sub: 'POM и градация' },
  { id: 'bom', label: 'Материалы', sub: 'BOM, колорвеи' },
  { id: 'nodes', label: 'Конструкция', sub: 'узлы и операции' },
  { id: 'labels', label: 'Ярлыки', sub: 'маркировка и SKU' },
  { id: 'vers', label: 'Версии', sub: 'примерки образцов' },
  { id: 'export', label: 'Экспорт', sub: 'PDF, SVG, фабрики' },
];
const FIT_DEMO = [
  ['A', 'Полуобхват груди', 52.0, 1.0, '52,8'],
  ['C', 'Ширина плеч', 41.0, 0.5, '41,2'],
  ['D', 'Длина рукава', 62.0, 1.0, '60,9'],
  ['E', 'Длина изделия', 66.0, 1.0, '66,4'],
];
const POM_DEMO = [
  [
    'A',
    'Полуобхват груди',
    '1/2 обхвата',
    '52,0',
    '1,0',
    '46,0',
    '49,0',
    '55,0',
    '59,0',
    '+3,0',
    'photo',
    'По самой широкой части, разложив изделие на столе без натяжения, через 2,5 см ниже проймы.',
  ],
  [
    'B',
    'Полуобхват талии',
    '',
    '48,5',
    '1,0',
    '42,5',
    '45,5',
    '51,5',
    '55,5',
    '+3,0',
    'photo',
    'По линии талии — самое узкое место между проймой и низом.',
  ],
  [
    'C',
    'Ширина плеч',
    'шов-шов',
    '41,0',
    '0,5',
    '38,6',
    '39,8',
    '42,2',
    '43,6',
    '+1,2',
    'user',
    'От точки втачивания одного рукава до другой по спинке.',
  ],
  [
    'D',
    'Длина рукава',
    'от плеча',
    '62,0',
    '1,0',
    '59,6',
    '60,8',
    '63,2',
    '64,4',
    '+1,2',
    'guess',
    'От плечевого шва до края манжеты по внешней стороне.',
  ],
  [
    'E',
    'Длина изделия',
    'от ВТП',
    '66,0',
    '1,0',
    '63,0',
    '64,5',
    '67,5',
    '69,0',
    '+1,5',
    'photo',
    'От высшей точки плеча у горловины вертикально до низа.',
  ],
  [
    'F',
    'Ширина низа',
    'по краю',
    '50,0',
    '1,0',
    '44,0',
    '47,0',
    '53,0',
    '57,0',
    '+3,0',
    'lib',
    'По нижнему краю изделия от сгиба до сгиба.',
  ],
  [
    'G',
    'Обхват проймы',
    'по кривой',
    '46,0',
    '1,0',
    '42,4',
    '44,2',
    '47,8',
    '49,6',
    '+1,8',
    'guess',
    'По кривой втачивания рукава, сантиметровой лентой на ребро.',
  ],
  [
    'H',
    'Ширина низа рукава',
    '',
    '9,5',
    '0,3',
    '8,9',
    '9,2',
    '9,8',
    '10,1',
    '+0,3',
    'lib',
    'По краю манжеты в сложенном виде.',
  ],
  [
    'I',
    'Ширина горловины',
    'шов-шов',
    '18,0',
    '0,5',
    '17,0',
    '17,5',
    '18,5',
    '19,0',
    '+0,5',
    'guess',
    'Между плечевыми швами по прямой.',
  ],
  [
    'J',
    'Глубина горловины сп.',
    '',
    '2,0',
    '0,3',
    '1,8',
    '1,9',
    '2,1',
    '2,2',
    '+0,1',
    'lib',
    'От линии плеч вертикально до шва горловины спинки.',
  ],
];
const BOM_GUESS = 2;
const RANGES = {
  A: [30, 80],
  B: [28, 75],
  C: [30, 60],
  D: [40, 75],
  E: [40, 90],
  F: [30, 80],
  G: [30, 60],
  H: [6, 16],
  I: [12, 26],
  J: [1, 6],
};
const HIST0 = {
  user: 'Вы · указано в мастере',
  photo: 'ИИ · оценка по фото photo-front.jpg',
  lib: 'ИИ · типовое значение из базы',
  guess: 'ИИ · расчётное предположение',
};
const POM_EN = {
  A: 'Chest width, half',
  B: 'Waist width, half',
  C: 'Shoulder to shoulder',
  D: 'Sleeve length',
  E: 'Body length from HPS',
  F: 'Bottom width',
  G: 'Armhole curve',
  H: 'Cuff width',
  I: 'Neck width',
  J: 'Back neck drop',
};
const POM_CN = {
  A: '半胸围',
  B: '半腰围',
  C: '肩宽',
  D: '袖长',
  E: '衣长',
  F: '下摆宽',
  G: '袖窿弧长',
  H: '袖口宽',
  I: '领宽',
  J: '后领深',
};
const FT = {
  RU: {
    view: 'Вид фабрики · только чтение',
    back: 'Вернуться в бренд',
    ask: 'Задать вопрос',
    sent: 'Вопрос отправлен',
    send: 'Отправить',
    ph: 'Вопрос к этой строке — например, про посадку молнии',
    tp: 'Технический пакет',
    pom: 'Замеры и градация · база M',
    code: 'Код',
    point: 'Точка измерения',
    base: 'База M',
    tol: 'Допуск',
    art: 'Артикул',
    fabc: 'Ткань',
    size: 'Размер',
    note: 'Вопросы уходят бренду в уведомления. Документ только для чтения — обновляет его бренд.',
  },
  EN: {
    view: 'Factory view · read only',
    back: 'Back to brand',
    ask: 'Ask a question',
    sent: 'Question sent',
    send: 'Send',
    ph: 'Question about this row — e.g. zipper placement',
    tp: 'Technical package',
    pom: 'Points of measure · base M',
    code: 'Code',
    point: 'Point of measure',
    base: 'Base M',
    tol: 'Tol.',
    art: 'Style no.',
    fabc: 'Fabric',
    size: 'Size',
    note: "Questions go to the brand's notifications. This document is read-only — only the brand can edit it.",
  },
  CN: {
    view: '工厂视图 · 只读',
    back: '返回品牌端',
    ask: '提问',
    sent: '问题已发送',
    send: '发送',
    ph: '对该行的问题——例如拉链位置',
    tp: '技术包',
    pom: '测量点 · 基准码 M',
    code: '编号',
    point: '测量点',
    base: '基准 M',
    tol: '公差',
    art: '款号',
    fabc: '面料',
    size: '尺码',
    note: '问题将发送给品牌方。此文档为只读——仅品牌方可编辑。',
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- класс подхватывает рантайм прототипа (support.js) через new Function
class Component extends DCLogic {
  state = {
    screen: 'home',
    section: 'cover',
    gal: 'flat',
    tab: 0,
    userMenu: false,
    pass: '',
    notifOpen: false,
    docMenu: false,
    packMenu: null,
    deleted: {},
    refFiles: [],
    drawFile: false,
    fitFile: false,
    docLoading: false,
    calcOpen: false,
    fabs: { f1: true, f2: false, f3: true },
    onCalc: false,
    pdfLang: 'Русский',
    flashSel: false,
    toastAct: null,
    fresh: false,
    w: 1600,
    sideOpen: false,
    toolBusy: null,
    toolResult: null,
    galExtra: [],
    genSecs: 0,
    genPanel: true,
    qaOpen: false,
    colOpen: false,
    railItemHov: null,
    twOn: false,
    twCh: 0,
    pro: null,
    onlyGuess: false,
    railHov: false,
    railPin: false,
    exportOpen: false,
    sel: null,
    vals: {},
    tols: {},
    confirmed: {},
    view: 'all',
    layers: { outline: true, seams: true, stitch: false, trims: true, callouts: true },
    selNode: null,
    swapped: false,
    toast: null,
    tip: null,
    wizStep: 1,
    precOpen: false,
    manual: '',
    closeConfirm: false,
    collections: [],
    colFormOpen: false,
    colName: '',
    libMats: [],
    matFormOpen: false,
    matName: '',
    matSpec: '',
    matHex: '#0E0E0E',
    matPan: '',
    libGrid: false,
    legalOpen: false,
    legalOrg: '',
    legalInn: '',
    legalAddr: '',
    legalDone: false,
    libLogo: false,
    scaleShot: false,
    careAlt: false,
    panelAlt: false,
    cwAdded: false,
    cwSel: 'Чёрный',
    bomExtra: [],
    bomLibOpen: false,
    galZoom: 1,
    sideHid: false,
    wshots: null,
    picks: {
      cat: 'Худи',
      size: 'RU 46 / M',
      fit: 'Обычная',
      mat: 'Трикотаж',
      range: 'XS–XL',
      qty: '100',
    },
    genStep: 0,
    genDone: false,
    genErr: false,
    toolMode: null,
    printText: '',
    printPlace: 'Грудь',
    fitSize: 'M',
    rAngles: { 'Ракурс ¾': true, Фронт: true, Спина: false, Деталь: false },
    dashEmpty: false,
    dashQ: '',
    dashFilter: 'Все',
    authStep: 'email',
    email: '',
    code: '',
    codeErr: false,
    fitVals: {},
    roles: { Технолог: true, Закройщик: true, ОТК: false, Снабжение: false },
    unit: 'см',
    history: {},
    undoStack: [],
    fabView: false,
    fabLang: 'RU',
    fabQOpen: null,
    fabQText: '',
    fabQ: {},
    wizMode: 'photo',
    impFile: false,
    baseFrom: null,
    // --- проводка: реальные данные ---
    me: null,
    jobs: null,
    curId: null,
    curSpec: null,
    curDefaults: null,
    openIds: [],
    genStages: null,
    genError: null,
    shareTok: null,
  };

  _specs = {};
  _thumbs = {};
  _files = [];
  _delT = {};

  /** Телеметрия переходов: один хук вместо трека в каждом обработчике. */
  setState(update, cb) {
    const before = this.state.screen + '/' + this.state.section;
    super.setState(update, () => {
      const after = this.state.screen + '/' + this.state.section;
      if (after !== before) {
        track('nav', { to: after });
        // Возврат к спискам — момент подтянуть свежие статусы паков.
        if (this.state.screen === 'home' || this.state.screen === 'dash') this.refreshJobs();
      }
      if (cb) cb();
    });
  }

  componentDidMount() {
    this._rs = () => this.setState({ w: window.innerWidth });
    window.addEventListener('resize', this._rs);
    this._rs();
    this._kz = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const st = this.state.undoStack;
      if (this.state.screen !== 'doc' || !st.length) return;
      e.preventDefault();
      const u = st[st.length - 1];
      this.setState((p) => {
        const vals = { ...p.vals };
        const tols = { ...p.tols };
        if (u.type === 'val') {
          if (u.prev === undefined) delete vals[u.code];
          else vals[u.code] = u.prev;
        } else {
          if (u.prev === undefined) delete tols[u.code];
          else tols[u.code] = u.prev;
        }
        return { vals, tols, undoStack: p.undoStack.slice(0, -1) };
      });
      // Правка уже могла уйти на сервер — откат тоже уходит.
      if (u.type === 'val' && TOKEN && this.state.curId && this.state.curSpec) {
        const pt = this.state.curSpec.measurements.points.find((x) => x.code === u.code);
        const back =
          u.prev !== undefined ? parseFloat(String(u.prev).replace(',', '.')) : pt && pt.base.value;
        if (isFinite(back)) this.sendEdit(u.code, back);
      }
      this.showToast('Отменено: ' + u.code + (u.type === 'val' ? ' — значение' : ' — допуск'));
    };
    window.addEventListener('keydown', this._kz);

    if (!DEMO) this.setState({ wshots: [] });
    if (TOKEN) {
      apiCall('/me')
        .then((me) => this.setState({ me }))
        .catch(() => {});
      this.refreshJobs();
      apiCall('/profile')
        .then(({ profile }) => {
          if (!profile) return;
          this.setState({
            ...(profile.legal && profile.legal.company
              ? {
                  legalDone: true,
                  legalOrg: profile.legal.company,
                  legalInn: profile.legal.inn || '',
                  legalAddr: profile.legal.address || '',
                }
              : {}),
            libMats: profile.mats || [],
            libLogo: !!profile.logo,
            libGrid: !!profile.grid,
            collections: (profile.collections || []).map((c) => ({
              name: c.name,
              items: c.items || [],
              open: false,
            })),
          });
        })
        .catch(() => {});
    }
  }

  componentWillUnmount() {
    clearInterval(this._g);
    clearInterval(this._gs);
    clearInterval(this._tw);
    clearInterval(this._tb);
    clearInterval(this._pl);
    clearTimeout(this._t);
    clearTimeout(this._dl);
    clearTimeout(this._fl);
    clearTimeout(this._ed);
    clearTimeout(this._pp);
    window.removeEventListener('resize', this._rs);
    window.removeEventListener('keydown', this._kz);
  }

  /* ------------------------------------------------------------- проводка */

  refreshJobs() {
    if (!TOKEN) return;
    apiCall('/jobs')
      .then((r) => {
        const jobs = r.jobs || [];
        this.setState({ jobs });
        // Спеки готовых паков тянутся в фоне: из них считаются миниатюры
        // чертежей в сайдбаре и на карточках.
        jobs
          .filter((j) => j.stage === 'done' && !this._specs[j.id])
          .slice(0, 8)
          .forEach((j) => this.loadSpec(j.id).catch(() => {}));
      })
      .catch(() => this.setState({ jobs: this.state.jobs || [] }));
  }

  loadSpec(id) {
    return apiCall('/jobs/' + id + '/spec').then((p) => {
      this._specs[id] = p;
      delete this._thumbs[id];
      this.forceUpdate();
      return p;
    });
  }

  openJobDoc(id, section) {
    const p = this._specs[id];
    this.setState((q) => ({
      curId: id,
      openIds: q.openIds.includes(id) ? q.openIds : q.openIds.concat([id]).slice(-2),
      vals: {},
      tols: {},
      confirmed: {},
      history: {},
      undoStack: [],
      sel: null,
      onlyGuess: false,
      shareTok: null,
      ...(p ? { curSpec: p.spec, curDefaults: p.flat_defaults } : {}),
    }));
    this.openDoc(section);
    // Ссылка для фабрики создаётся заранее: к моменту клика «Скопировать»
    // она уже есть, и тост не врёт.
    if (TOKEN) {
      apiCall('/jobs/' + id + '/share', { method: 'POST' })
        .then((r) => this.setState({ shareTok: r.token }))
        .catch(() => {});
    }
    if (!p) {
      this.loadSpec(id)
        .then((q) => this.setState({ curSpec: q.spec, curDefaults: q.flat_defaults }))
        .catch((e) => this.showToast('Документ ещё не готов: ' + e.message));
    }
  }

  openJobGen(id) {
    this.startRealGen(id);
  }

  startRealGen(id) {
    clearInterval(this._g);
    clearInterval(this._gs);
    clearInterval(this._pl);
    this.setState({
      screen: 'gen',
      curId: id,
      genStep: 0,
      genDone: false,
      genErr: false,
      genSecs: 0,
      genPanel: true,
      genStages: null,
      genError: null,
      toolMode: null,
    });
    const order = { queued: 0, vision: 0, assembly: 2, render: 3, docgen: 4, done: 5 };
    const tick = () =>
      apiCall('/jobs/' + id + '/status')
        .then((st) => {
          const t0 = st.history.length ? Date.parse(st.history[0].at) : Date.now();
          const secs = Math.max(0, Math.floor((Date.now() - t0) / 1000));
          if (st.stage === 'error') {
            clearInterval(this._pl);
            this.setState({
              genErr: true,
              genError: st.error || null,
              genSecs: secs,
              genStages: st.history,
            });
            if (st.error) this.showToast(st.error.message + ' ' + (st.error.action || ''));
            return;
          }
          this.setState({ genStep: order[st.stage] ?? 0, genSecs: secs, genStages: st.history });
          if (st.stage === 'done') {
            clearInterval(this._pl);
            this.setState({ genDone: true, genStep: 5 });
            this.loadSpec(id).catch(() => {});
            this.refreshJobs();
          }
        })
        .catch(() => {});
    tick();
    this._pl = setInterval(tick, 2500);
  }

  sendEdit(code, valueCm) {
    const id = this.state.curId;
    apiCall('/jobs/' + id + '/measurements', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, value_cm: valueCm }),
    })
      .then((p) => {
        this._specs[id] = { spec: p.spec, flat_defaults: p.flat_defaults };
        delete this._thumbs[id];
        this.setState((q) => {
          const vals = { ...q.vals };
          delete vals[code];
          return { curSpec: p.spec, curDefaults: p.flat_defaults, vals };
        });
      })
      .catch((e) => {
        this.showToast('Правка отклонена: ' + e.message);
        this.setState((q) => {
          const vals = { ...q.vals };
          delete vals[code];
          return { vals };
        });
      });
  }

  /** Спека с локальными правками — живой чертёж без похода на сервер. */
  specLive() {
    const s = this.state;
    const spec = s.curSpec;
    if (!spec || !Object.keys(s.vals).length) return spec;
    return {
      ...spec,
      measurements: {
        ...spec.measurements,
        points: spec.measurements.points.map((p) => {
          const v = s.vals[p.code];
          const n = v === undefined ? NaN : parseFloat(String(v).replace(',', '.'));
          return isFinite(n) ? { ...p, base: { ...p.base, value: n } } : p;
        }),
      },
    };
  }

  flatResult(view, layers) {
    const s = this.state;
    const E = window.SeamsterlyEngine;
    if (!E || !s.curSpec) return null;
    try {
      const m = E.measurementsFrom(this.specLive());
      const opts = { view };
      if (layers) opts.layers = layers;
      const d = s.curDefaults || {};
      if (d.minSleeveAngleDeg !== undefined) opts.minSleeveAngleDeg = d.minSleeveAngleDeg;
      if (view === 'side') {
        if (d.depthCm === undefined) return null;
        opts.depthCm = d.depthCm;
      }
      return E.renderFlat(m, opts);
    } catch {
      return null;
    }
  }

  flatSvg(view, layers) {
    const r = this.flatResult(view, layers);
    return r ? r.svg : null;
  }

  flatUrl(view, layers) {
    const svg = this.flatSvg(view, layers);
    return svg ? svgUrl(svg) : null;
  }

  /**
   * Три вида одним SVG в общей системе координат — единый масштаб
   * по построению: бок узкий и обязан выглядеть узким (иначе чертёж врёт).
   */
  flatAllUrl(layers) {
    const parts = [];
    for (const v of ['front', 'side', 'back']) {
      const r = this.flatResult(v, layers);
      if (r) parts.push(r);
    }
    if (!parts.length) return null;
    const GAP = 8;
    const W = parts.reduce((a, p) => a + p.viewBox.width, 0) + GAP * (parts.length - 1);
    const H = Math.max(...parts.map((p) => p.viewBox.height));
    let x = 0;
    const inner = parts
      .map((p) => {
        const tag = p.svg.replace(
          '<svg ',
          '<svg x="' +
            x +
            '" y="' +
            (H - p.viewBox.height) +
            '" width="' +
            p.viewBox.width +
            '" height="' +
            p.viewBox.height +
            '" ',
        );
        x += p.viewBox.width + GAP;
        return tag;
      })
      .join('');
    return svgUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
        W +
        ' ' +
        H +
        '">' +
        inner +
        '</svg>',
    );
  }

  thumbUrl(id) {
    if (this._thumbs[id]) return this._thumbs[id];
    const p = this._specs[id];
    const E = window.SeamsterlyEngine;
    if (!p || !E) return null;
    try {
      const m = E.measurementsFrom(p.spec);
      const o = { view: 'front' };
      if (p.flat_defaults && p.flat_defaults.minSleeveAngleDeg !== undefined)
        o.minSleeveAngleDeg = p.flat_defaults.minSleeveAngleDeg;
      this._thumbs[id] = svgUrl(E.renderFlat(m, o).svg);
      return this._thumbs[id];
    } catch {
      return null;
    }
  }

  pickFiles(asRef) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
      const cur = this.state.wshots || [];
      const room = (asRef ? 4 : 6) - (asRef ? this.state.refFiles.length : cur.length);
      const files = Array.from(input.files || []).slice(0, Math.max(0, room));
      if (!files.length) return;
      this._files = this._files.concat(files);
      const rows = files.map((f) => [
        URL.createObjectURL(f),
        f.name,
        f.size > 1048576
          ? (f.size / 1048576).toFixed(1).replace('.', ',') + ' МБ'
          : Math.round(f.size / 1024) + ' КБ',
      ]);
      this.setState((p) => ({
        wshots: (p.wshots || []).concat(rows),
        ...(asRef ? { refFiles: p.refFiles.concat(files.map((f) => f.name)) } : {}),
      }));
      if (!asRef) this.showToast('Файл добавлен — ' + (cur.length + files.length) + ' из 6');
    };
    input.click();
  }

  launchGeneration() {
    const s = this.state;
    const files = this._files;
    if (!files.length)
      return this.showToast('Добавьте хотя бы одно фото изделия — вернитесь на шаг 1');
    const base = { 'RU 44 / S': 44, 'RU 46 / M': 46, 'RU 48 / L': 48 }[s.picks.size] || 46;
    const offs = { 'XS–XL': [-4, -2, 0, 2, 4], 'S–XXL': [-2, 0, 2, 4, 6] }[s.picks.range];
    const sr =
      s.picks.range === '42–52'
        ? [42, 44, 46, 48, 50, 52].concat([base])
        : (offs || [-4, -2, 0, 2, 4]).map((o) => base + o);
    const manualCm = parseFloat(String(s.manual || '').replace(',', '.'));
    const answers = {
      id: 'demo-' + Date.now(),
      name: s.picks.cat,
      article: 'DEMO-' + String(Date.now()).slice(-6),
      category: CAT_OF[s.picks.cat] || 'hoodie',
      gender: 'women',
      base_size_ru: base,
      base_height_cm: 170,
      fit_intent: FIT_OF[s.picks.fit] || 'semi_fitted',
      fabric_kind: s.picks.mat === 'Ткань' ? 'woven' : 'knit',
      size_range: [...new Set(sr)].sort((a, b) => a - b),
      ...(Number(s.picks.qty) ? { quantity: Number(s.picks.qty) } : {}),
      // Ручной замер калибрует масштаб всего чертежа — реальная механика движка.
      ...(isFinite(manualCm) && manualCm > 30
        ? { manual: { code: 'T01', value_cm: manualCm } }
        : {}),
    };
    this.setState({
      screen: 'gen',
      genStep: 0,
      genDone: false,
      genErr: false,
      genError: null,
      genSecs: 0,
      genPanel: true,
    });
    track('generate', { category: answers.category, photos: files.length });
    (async () => {
      try {
        const { id } = await apiCall('/jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(answers),
        });
        this.setState({ curId: id });
        for (const f of files) {
          const r = await fetch('/app/api/jobs/' + id + '/photos', {
            method: 'POST',
            headers: { 'content-type': f.type || 'image/jpeg', 'x-invite': TOKEN },
            body: f,
          });
          if (!r.ok) throw new Error('фото не загрузилось');
        }
        await apiCall('/jobs/' + id + '/start', { method: 'POST' });
        this._files = [];
        this.refreshJobs();
        this.startRealGen(id);
      } catch (e) {
        this.setState({
          genErr: true,
          genError: {
            message: String((e && e.message) || e),
            action: 'Проверьте инвайт-ссылку и повторите.',
          },
        });
        this.showToast('Не получилось запустить: ' + String((e && e.message) || e));
      }
    })();
  }

  persistProfile() {
    if (!TOKEN) return;
    clearTimeout(this._pp);
    this._pp = setTimeout(() => {
      const s = this.state;
      apiCall('/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          legal: s.legalDone
            ? { company: s.legalOrg, inn: s.legalInn, address: s.legalAddr }
            : null,
          mats: s.libMats,
          logo: s.libLogo,
          grid: s.libGrid,
          collections: s.collections.map((c) => ({ name: c.name, items: c.items })),
        }),
      }).catch(() => {});
    }, 700);
  }

  /* --------------------------------------- реальные данные вместо демо-строк */

  curPOM() {
    const spec = this.state.curSpec;
    if (!spec) return null;
    const bru = (spec.base && spec.base.base_size_ru) || 46;
    return spec.measurements.points.map((p) => {
      const g = (off) => {
        const row = (p.graded || []).find((x) => x.ru === bru + off);
        return row ? f1(row.value.value) : '—';
      };
      const lRow = (p.graded || []).find((x) => x.ru === bru + 2);
      const delta = lRow
        ? (lRow.value.value >= p.base.value ? '+' : '') + f1(lRow.value.value - p.base.value)
        : '—';
      return [
        p.code,
        p.name_ru,
        KIND_HINT[p.measure_kind] || '',
        f1(p.base.value),
        f1(p.tolerance.value),
        g(-4),
        g(-2),
        g(2),
        g(4),
        delta,
        KIND_OF[p.base.confidence] || 'lib',
        p.how_to_measure_ru || '',
        { en: p.name_en, zh: p.name_zh },
      ];
    });
  }

  curBOM() {
    const spec = this.state.curSpec;
    if (!spec || !spec.bom) return null;
    const cw = spec.bom.colorways || [];
    const sel = cw.find((c) => c.name_ru === this.state.cwSel) || cw[0] || null;
    const order = { shell: 0, rib: 0, thread: 1, interlining: 1, label: 2, packaging: 3 };
    const names = ['Полотно', 'Нитки и прокладки', 'Маркировка', 'Упаковка'];
    const rows = [];
    names.forEach((gn, gi) => {
      const lines = spec.bom.lines.filter((l) => order[l.role] === gi);
      if (!lines.length) return;
      rows.push(['g', gn]);
      lines.forEach((l) => {
        const cloth = l.role === 'shell' || l.role === 'rib';
        const hex =
          cloth && sel ? (sel.swatch && sel.swatch.hex) || sel.hex_approx || '#B0ADA6' : '#E8E5E0';
        const pan = cloth && sel && sel.book_code ? sel.book_code : '—';
        const desc =
          l.composition.value +
          (l.gsm && l.gsm.value ? ' · ' + Math.round(l.gsm.value) + ' г/м²' : '');
        const qty =
          l.consumption && l.consumption.value
            ? String(l.consumption.value).replace('.', ',') + ' ' + l.consumption_unit
            : 'уточнить';
        rows.push([
          l.code,
          l.name_ru,
          desc,
          hex,
          pan,
          qty,
          KIND_OF[l.composition.confidence] || 'lib',
        ]);
      });
    });
    return rows.length ? rows : null;
  }

  curNodes() {
    const spec = this.state.curSpec;
    if (!spec || !spec.construction) return null;
    return spec.construction.nodes.map((n, i) => [
      String(i + 1),
      n.zone,
      n.label_ru,
      n.plain_ru,
      n.stitch_code + ' / ' + n.seam_code,
      'SPI ' + n.spi,
      n.machine,
      !!n.requires_special_equipment,
      n.alternative || null,
    ]);
  }

  curOps() {
    const spec = this.state.curSpec;
    if (!spec || !spec.construction || !spec.construction.sequence) return null;
    return spec.construction.sequence.map((t) => ({
      n: String(t.step).padStart(2, '0'),
      name: t.operation_ru,
      machine: t.machine,
      time: t.time_sec ? (t.time_sec / 60).toFixed(1).replace('.', ',') + ' мин' : '—',
    }));
  }

  curInfo(updated) {
    const spec = this.state.curSpec;
    if (!spec) return null;
    const b = spec.base || {};
    const bru = b.base_size_ru || 46;
    const range = (b.size_range || []).length
      ? INT_OF(b.size_range[0], bru) + '–' + INT_OF(b.size_range[b.size_range.length - 1], bru)
      : '—';
    return [
      ['Категория', CAT_RU[spec.style.category] || spec.style.category, 'photo'],
      [
        'Силуэт',
        spec.style.description ? String(spec.style.description).split(/[.,·]/)[0].trim() : '—',
        'photo',
      ],
      ['Посадка', FIT_RU[b.fit_intent] || 'Обычная', 'user'],
      [
        'Базовый размер',
        'RU ' +
          bru +
          ' / ' +
          INT_OF(bru, bru) +
          (b.base_height_cm ? ' · рост ' + b.base_height_cm : ''),
        'user',
      ],
      ['Размерный ряд', range, 'user'],
      ['Конструктор', 'не назначен', 'lib'],
      ['Производство', 'не выбрано', 'lib'],
      ['Ревизия', '1.0 · ' + (updated || '—'), 'user'],
    ];
  }

  /* ------------------------------------------------ методы прототипа как есть */

  startToolRun(kind) {
    clearInterval(this._tb);
    const t0 = Date.now();
    this.setState({ toolBusy: 0, toolResult: null });
    this._tb = setInterval(() => {
      const pct = Math.min(100, Math.round((Date.now() - t0) / 28));
      if (pct >= 100) {
        clearInterval(this._tb);
        this.setState({ toolBusy: null, toolResult: kind });
      } else this.setState({ toolBusy: pct });
    }, 200);
  }

  set(k, v) {
    this.setState({ [k]: v });
  }

  showToast(text, act) {
    clearTimeout(this._t);
    this.setState({ toast: text, toastAct: act || null });
    this._t = setTimeout(() => this.setState({ toast: null, toastAct: null }), act ? 4000 : 2200);
  }

  openDoc(section) {
    clearTimeout(this._dl);
    this.setState({ screen: 'doc', section: section || 'cover', docLoading: true, toolMode: null });
    this._dl = setTimeout(() => this.setState({ docLoading: false }), 550);
  }

  mkTip(text) {
    return (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      this.setState({ tip: { text, x: r.left + r.width / 2, y: r.top } });
    };
  }

  kindOf(row) {
    const code = row[0];
    if (this.state.vals[code] !== undefined || this.state.confirmed[code]) return 'user';
    return row[10];
  }

  dot(kind, size) {
    const s = ST[kind] || ST.lib;
    const ring = kind === 'guess' ? ';box-shadow:0 0 0 3px rgba(192,57,43,.16)' : '';
    return (
      'width:' +
      (size || 8) +
      'px;height:' +
      (size || 8) +
      'px;flex:none;border-radius:50%;background:' +
      s.c +
      ring
    );
  }

  startGen() {
    clearInterval(this._g);
    clearInterval(this._gs);
    const t0 = Date.now();
    this.setState({ genStep: 0, genDone: false, genErr: false, genSecs: 0, genPanel: true });
    this._gs = setInterval(
      () => this.setState({ genSecs: Math.floor((Date.now() - t0) / 1000) }),
      1000,
    );
    this._g = setInterval(() => {
      const n = Math.min(5, Math.floor((Date.now() - t0) / 2100));
      if (n >= 5) {
        clearInterval(this._g);
        clearInterval(this._gs);
        this.setState({ genStep: 5, genDone: true });
      } else this.setState({ genStep: n });
    }, 700);
  }

  startTyping() {
    clearInterval(this._tw);
    this.setState({ twOn: true, twCh: 0 });
    this._tw = setInterval(() => {
      this.setState((p) => {
        const n = p.twCh + 3;
        if (n > 700) {
          clearInterval(this._tw);
          return { twOn: false, twCh: 0 };
        }
        return { twCh: n };
      });
    }, 30);
  }

  tw(text, idx) {
    if (!this.state.twOn) return text;
    const start = idx * 46;
    const vis = Math.max(0, Math.min(text.length, this.state.twCh - start));
    if (vis <= 0) return '';
    return text.slice(0, vis) + (vis < text.length ? '▮' : '');
  }

  pushHist(code, txt) {
    this.setState((p) => ({
      history: { ...p.history, [code]: (p.history[code] || []).concat([{ t: 'сейчас', txt }]) },
    }));
  }

  fmtU(v) {
    if (this.state.unit === 'см') return v;
    const n = parseFloat(String(v).replace(',', '.'));
    if (!isFinite(n)) return v;
    return (n / 2.54).toFixed(1).replace('.', ',');
  }

  renderVals() {
    const s = this.state;
    const pro = s.pro === null ? (this.props.proMode ?? false) : s.pro;
    const dense = (this.props.density ?? 'комфортная') === 'плотная';
    const rowH = dense ? 32 : 38;
    const secIdx = SECTIONS.findIndex((x) => x.id === s.section);
    const st0 = s.onCalc ? 'На просчёте' : 'Готов';

    // --- проводка: реальный контекст ---
    const jobsLive = Array.isArray(s.jobs);
    const fresh = jobsLive ? s.jobs.length === 0 : DEMO ? s.fresh : true;
    const doc = s.curSpec;
    const curJob = jobsLive && s.curId ? s.jobs.find((j) => j.id === s.curId) : null;
    const docNameVal = doc ? doc.style.name : curJob ? curJob.name : 'Структурный жакет';
    const docArtVal = doc ? doc.style.article : '498BA296–123E';
    const artShortVal = doc ? doc.style.article : '498BA296';
    const docUpdatedVal = curJob ? fmtWhen(curJob.created_at) : '16 июл, 07:10';
    const bru = doc && doc.base ? doc.base.base_size_ru || 46 : 46;
    const pomReal = this.curPOM();
    const bomReal = this.curBOM();
    const nodesReal = this.curNodes();
    const opsReal = this.curOps();
    const infoReal = this.curInfo(fmtDay(curJob && curJob.created_at));
    const liveOn = !!doc;
    const liveFrontUrl = liveOn ? this.flatUrl('front') : null;

    const POM = pomReal || POM_DEMO;
    const FIT = pomReal
      ? pomReal
          .slice(0, 4)
          .map((r) => [
            r[0],
            r[1],
            parseFloat(String(r[3]).replace(',', '.')),
            parseFloat(String(r[4]).replace(',', '.')),
            '',
          ])
      : FIT_DEMO;

    const pomGuessLeft = POM.filter((r) => this.kindOf(r) === 'guess').length;
    const bomGuessN = bomReal
      ? bomReal.filter((r) => r[0] !== 'g' && r[6] === 'guess').length
      : BOM_GUESS;
    const guessCount = pomGuessLeft + bomGuessN;

    const pomRows = POM.filter((r) => !s.onlyGuess || this.kindOf(r) === 'guess').map((r) => {
      const code = r[0];
      const kind = this.kindOf(r);
      const isSel = s.sel === code;
      const rg = RANGES[code];
      return {
        code,
        name: r[1],
        hint: r[2],
        val: this.fmtU(s.vals[code] !== undefined ? s.vals[code] : r[3]),
        tol: '±' + this.fmtU(s.tols[code] || r[4]),
        xs: this.fmtU(r[5]),
        s: this.fmtU(r[6]),
        l: this.fmtU(r[7]),
        xl: this.fmtU(r[8]),
        delta: this.fmtU(r[9]),
        stLabel: ST[kind].l,
        warnOn: (() => {
          const n = parseFloat(
            String(s.vals[code] !== undefined ? s.vals[code] : r[3]).replace(',', '.'),
          );
          return isFinite(n) && rg && (n < rg[0] || n > rg[1]);
        })(),
        warnTip: this.mkTip(
          rg
            ? 'Вне типового диапазона ' +
                rg[0] +
                '–' +
                rg[1] +
                ' см для этой точки. Проверьте: возможно, введён полный обхват вместо половины.'
            : '',
        ),
        qOn: !!s.fabQ[code],
        qTip: this.mkTip('Фабрика спрашивает: «' + (s.fabQ[code] || '') + '»'),
        onKey: (e) => {
          if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const list = Array.prototype.slice.call(document.querySelectorAll('input[data-pom]'));
          const i = list.indexOf(e.currentTarget);
          const nx = e.key === 'ArrowUp' ? i - 1 : i + 1;
          if (list[nx]) {
            list[nx].focus();
            list[nx].select();
          }
        },
        dotStyle: this.dot(kind, 8),
        selBar:
          'width:2.5px;height:16px;border-radius:2px;flex:none;background:' +
          (isSel ? '#0E0E0E' : 'transparent'),
        rowStyle:
          'display:grid;grid-template-columns:' +
          this.pomColsRaw(pro) +
          ';align-items:center;min-height:' +
          rowH +
          'px;border-bottom:1px solid #EFEDE9;cursor:pointer;background:' +
          (isSel ? 'rgba(14,14,14,.03)' : 'transparent'),
        inputStyle:
          'width:62px;text-align:right;padding:4px 6px;border-radius:7px;border:1px solid transparent;background:transparent;cursor:text;' +
          'font:300 12px/18px Inter,sans-serif;color:#C0392B;font-variant-numeric:tabular-nums' +
          (s.vals[code] !== undefined
            ? ';border-color:rgba(47,124,90,.35);background:rgba(228,247,239,.5)'
            : ''),
        onVal: (e) => {
          let v = e.target.value;
          if (s.unit === 'in') {
            const n = parseFloat(String(v).replace(',', '.'));
            if (isFinite(n)) v = (n * 2.54).toFixed(1).replace('.', ',');
          }
          const prev = s.vals[code];
          clearTimeout(this._fl);
          this.setState((p) => ({
            vals: { ...p.vals, [code]: v },
            sel: code,
            flashSel: true,
            undoStack: p.undoStack.concat([{ type: 'val', code, prev }]),
          }));
          this._fl = setTimeout(() => this.setState({ flashSel: false }), 750);
          this.pushHist(code, (prev !== undefined ? prev : r[3]) + ' → ' + v + ' см');
          this.showToast(
            'Чертёж обновлён — ' + code + ' · ' + r[1] + ' → ' + v + ' см · ⌘Z отменит',
          );
          // Реальная правка: живой чертёж пересобрался мгновенно из s.vals,
          // на сервер значение уходит с паузой — пока человек не докрутил число.
          if (TOKEN && s.curId && doc) {
            clearTimeout(this._ed);
            const num = parseFloat(String(v).replace(',', '.'));
            if (isFinite(num)) this._ed = setTimeout(() => this.sendEdit(code, num), 900);
          }
        },
        select: () => this.set('sel', code),
      };
    });

    const selRow = POM.find((r) => r[0] === s.sel);
    const selKind = selRow ? this.kindOf(selRow) : 'lib';
    const selWarn = selRow
      ? (() => {
          const n = parseFloat(
            String(s.vals[s.sel] !== undefined ? s.vals[s.sel] : selRow[3]).replace(',', '.'),
          );
          const rg = RANGES[s.sel];
          return isFinite(n) && rg && (n < rg[0] || n > rg[1]) ? rg : null;
        })()
      : null;
    const FTL = FT[s.fabLang];
    const fabRows = POM.map((r) => {
      const code = r[0];
      const tr = r[12] || {};
      return {
        code,
        name:
          s.fabLang === 'EN'
            ? tr.en || POM_EN[code] || r[1]
            : s.fabLang === 'CN'
              ? tr.zh || POM_CN[code] || r[1]
              : r[1],
        val: this.fmtU(s.vals[code] !== undefined ? s.vals[code] : r[3]),
        tol: '±' + this.fmtU(s.tols[code] || r[4]),
        dotStyle: this.dot(this.kindOf(r), 7),
        asked: !!s.fabQ[code],
        notAsked: !s.fabQ[code],
        openQ: s.fabQOpen === code,
        ask: () => this.setState({ fabQOpen: s.fabQOpen === code ? null : code, fabQText: '' }),
        sendQ: () => {
          const t = s.fabQText || 'Уточните, пожалуйста, эту строку';
          if (TOKEN && s.curId) track('fab_question', { id: s.curId, code, text: t.slice(0, 300) });
          this.setState((p) => ({ fabQ: { ...p.fabQ, [code]: t }, fabQOpen: null, fabQText: '' }));
          this.showToast(FT[s.fabLang].sent + ' — ' + code);
        },
      };
    });
    const diffRows = [];
    POM.forEach((r) => {
      const f = s.fitVals[r[0]];
      if (f !== undefined && String(f).length && String(f) !== r[3])
        diffRows.push({
          code: r[0],
          name: r[1],
          oldV: r[3],
          newV: String(f),
          src: 'факт примерки',
        });
    });
    Object.keys(s.vals).forEach((c) => {
      const r0 = POM.find((r) => r[0] === c);
      if (r0 && s.vals[c] !== r0[3])
        diffRows.push({
          code: c,
          name: r0[1],
          oldV: r0[3],
          newV: s.vals[c],
          src: 'правка значения',
        });
    });
    Object.keys(s.tols).forEach((c) => {
      const r0 = POM.find((r) => r[0] === c);
      if (r0 && s.tols[c] !== r0[4])
        diffRows.push({
          code: c,
          name: 'допуск · ' + r0[1],
          oldV: '±' + r0[4],
          newV: '±' + s.tols[c],
          src: 'перекрыт вручную',
        });
    });
    if (s.swapped)
      diffRows.push({
        code: '2',
        name: 'Застёжка · узел',
        oldV: 'асимметрия',
        newV: 'по центру',
        src: 'замена узла',
      });

    const bomDemoSrc = [
      ['g', 'Полотно'],
      [
        'ПОЛ-01',
        'Полотно основное',
        'Рибана 2×2 · 92% CO / 8% EA · 240 г/м²',
        '#0E0E0E',
        'Black 6 C',
        '1,15 м',
        'photo',
      ],
      [
        'ПОЛ-02',
        'Отделка горловины',
        'Рибана 1×1 · 240 г/м²',
        '#0E0E0E',
        'Black 6 C',
        '0,12 м',
        'lib',
      ],
      ['g', 'Фурнитура'],
      [
        'ФУР-01',
        'Молния разъёмная 45 см',
        'Металл, никель · зубец №3',
        '#B8B8B4',
        '877 C',
        '1 шт',
        'guess',
      ],
      [
        'ФУР-02',
        'Лента усилительная 10 мм',
        'Полиэстер, тканая',
        '#0E0E0E',
        'Black 6 C',
        '0,60 м',
        'lib',
      ],
      ['g', 'Нитки и прокладки'],
      [
        'НИТ-01',
        'Нить основная',
        'Полиэстер 40/2 · 180 м/ед',
        '#0E0E0E',
        'Black 6 C',
        '180 м',
        'lib',
      ],
      [
        'НИТ-02',
        'Нить обмёточная',
        'Текстурированная 150D',
        '#0E0E0E',
        'Black 6 C',
        '320 м',
        'lib',
      ],
      [
        'ПРК-01',
        'Клеевая лента 15 мм',
        'Полиамид, точечное покрытие',
        '#E8E5E0',
        '—',
        '0,40 м',
        'guess',
      ],
      ['g', 'Упаковка'],
      ['УПК-01', 'Пакет ПВД 300×400', '50 мкм, с клапаном', '#F2F2F0', '—', '1 шт', 'lib'],
      ['УПК-02', 'Ярлык навесной', 'Картон 350 г/м² · 45×70 мм', '#F2F2F0', '—', '1 шт', 'user'],
    ];
    const bomSrc = bomReal || bomDemoSrc;
    const ecru = !bomReal && s.cwSel === 'Экрю';
    const bomAll = bomSrc.concat(
      s.bomExtra.length ? [['g', 'Добавлено из библиотеки']].concat(s.bomExtra) : [],
    );
    const bom = bomAll.map((r) => {
      if (r[0] === 'g')
        return {
          isGroup: true,
          isRow: false,
          group: r[1],
          rowStyle: 'display:block;border-bottom:1px solid #EFEDE9',
        };
      const isCloth = r[0].indexOf('ПОЛ') === 0;
      return {
        isGroup: false,
        isRow: true,
        code: r[0],
        name: r[1],
        spec: r[2],
        pantone: ecru && isCloth ? '13-1006 TCX' : r[4],
        qty: r[5],
        stLabel: ST[r[6]].l,
        dotStyle: this.dot(r[6], 8),
        swatch:
          'width:14px;height:14px;flex:none;border-radius:5px;background:' +
          (ecru && isCloth ? '#E8E2D5' : r[3]) +
          ';border:1px solid rgba(14,14,14,.14)',
        rowStyle:
          'display:grid;grid-template-columns:66px 1.5fr 1.4fr 96px 84px 150px;align-items:center;min-height:' +
          rowH +
          'px;border-bottom:1px solid #EFEDE9',
      };
    });
    const libBase = [
      ['Рибана 2×2 · 240 г/м²', '92% CO / 8% EA', '#0E0E0E', 'Black 6 C'],
      ['Молния YKK №3 · металл', 'никель', '#B8B8B4', '877 C'],
    ];
    const libAllMats = (DEMO ? libBase : []).concat(
      s.libMats.map((m) => [m.name, m.spec, m.hex, m.pan]),
    );
    const packNames = jobsLive
      ? s.jobs.map((j) => j.name)
      : DEMO
        ? ['Структурный жакет', 'Худи оверсайз', 'Брюки прямые']
        : [];

    const zipName = s.swapped ? 'Молния по центру переда' : 'Молния по асимметрии';
    const zipDesc = s.swapped
      ? 'Замена: молния втачивается по прямой центра переда — шьётся на 1-игольной, спецоборудование не нужно.'
      : 'Молния втачивается по косой линии от горловины к боку, лента подгибается под припуск.';
    const nodeDemoSrc = [
      [
        '1',
        'Горловина',
        'Обтачка косой бейкой',
        'Горловина обрабатывается узкой обтачкой в цвет, шов закрыт наизнутрь.',
        '301 / ISO 301',
        'SPI 12',
        '1-игольная',
        false,
      ],
      [
        '2',
        'Застёжка',
        zipName,
        zipDesc,
        '301 + 406',
        'SPI 11',
        s.swapped ? '1-игольная' : '1-игольная + распошив.',
        !s.swapped,
      ],
      [
        '3',
        'Плечи и бока',
        'Обмётка + настрочка',
        'Плечевые и боковые швы обмётываются 4-нитью, припуск заутюживается на спинку.',
        '504 / ISO 504',
        'SPI 12',
        '4-нит. оверлок',
        false,
      ],
      [
        '4',
        'Низ изделия',
        'Подгибка 2 см',
        'Низ подгибается на 2 см и настрачивается двойной иглой в край.',
        '406 / ISO 406',
        'SPI 10',
        'Распошивальная',
        false,
      ],
      [
        '5',
        'Низ рукава',
        'Подгибка 1,5 см',
        'Низ рукава подгибается и настрачивается двойной иглой.',
        '406 / ISO 406',
        'SPI 10',
        'Распошивальная',
        false,
      ],
      [
        '6',
        'Маркировка',
        'Составник в боковом шве',
        'Составник вкладывается в левый боковой шов на 6 см от низа.',
        '301',
        'SPI 12',
        '1-игольная',
        false,
      ],
    ];
    const nodeSrc = nodesReal || nodeDemoSrc;
    const nodes = nodeSrc.map((r, ni) => ({
      num: r[0],
      zone: r[1],
      name: r[2],
      desc: this.tw(r[3], 3 + ni),
      stitch: r[4],
      spi: r[5],
      machine: r[6],
      flagged: r[7],
      numStyle:
        "width:22px;height:22px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font:600 10px/1 'JetBrains Mono',monospace;" +
        (s.selNode === r[0]
          ? 'background:#0E0E0E;color:#fff'
          : 'background:rgba(14,14,14,.05);color:#5A5A56'),
      rowStyle:
        'display:flex;align-items:center;gap:13px;padding:' +
        (dense ? '10px' : '13px') +
        ' 15px;border-bottom:1px solid #EFEDE9;cursor:pointer;' +
        (s.selNode === r[0] ? 'background:rgba(14,14,14,.03)' : ''),
      select: () => this.set('selNode', r[0]),
      swap: () => {
        if (nodesReal) {
          const alt = r[8];
          this.showToast(
            alt
              ? 'Альтернатива: ' + alt.label_ru + ' — ' + alt.machine
              : 'Замены для этого узла нет',
          );
          return;
        }
        this.setState({ swapped: true });
        this.showToast('Узел заменён — чертёж и техпоследовательность обновлены');
      },
    }));

    const ops =
      opsReal ||
      [
        ['01', 'Заготовка: обмётка срезов полочек и спинки', 'оверлок 504', '0,8 мин'],
        [
          '02',
          'Втачивание молнии по борту',
          s.swapped ? '1-игольная 301' : '1-иг. + распошив.',
          '3,2 мин',
        ],
        ['03', 'Стачивание плечевых швов', 'оверлок 504', '0,6 мин'],
        ['04', 'Втачивание рукавов', 'оверлок 504', '1,4 мин'],
        ['05', 'Обтачка горловины бейкой', '1-игольная 301', '1,1 мин'],
        ['06', 'Подгибка низа и манжет', 'распошив. 406', '1,6 мин'],
        ['07', 'Вложение составника, контроль ОТК', 'ручная', '0,9 мин'],
      ].map((r) => ({ n: r[0], name: r[1], machine: r[2], time: r[3] }));

    const chip = (on) =>
      'padding:6px 11px;border-radius:8px;cursor:pointer;font:600 10px/14px Sora,sans-serif;letter-spacing:.8px;text-transform:uppercase;' +
      (on
        ? 'background:#fff;border:1px solid rgba(14,14,14,.14);color:#0E0E0E;box-shadow:0 1px 2px rgba(14,14,14,.06)'
        : 'background:transparent;border:1px solid transparent;color:#6B6B67');

    const galMap = {
      flat: {
        k: 'Чертёж',
        img: 'assets/flat-alt.png',
        b: liveOn ? '3 вида · живой чертёж из спеки' : '3 вида · перед / бок / спинка',
      },
      photo: { k: 'Фото-референс', img: 'assets/flat-main.png', b: 'исходник · photo-1' },
      render: {
        k: '3D-рендер · черновик',
        img: 'assets/thumb.jpg',
        b: '3 ракурса · материал из BOM',
      },
      print: {
        k: 'Принт · раскладка',
        img: 'assets/flat-alt.png',
        b: 'зона: левая грудь · 300 DPI',
      },
      fit: {
        k: 'Примерка · RU 46 / M',
        img: 'assets/flat-main.png',
        b: 'натяжение по груди в норме',
      },
    };
    const g = galMap[s.gal] || galMap.flat;
    const galBgVal = (() => {
      const tail =
        ' 50% 50%/contain no-repeat;transform:scale(' +
        s.galZoom +
        ');transition:transform .2s ease';
      const allUrl = liveOn && s.gal === 'flat' ? this.flatAllUrl() : null;
      if (allUrl) return 'position:absolute;inset:16px;background:' + allUrl + tail;
      if (liveOn && s.gal === 'photo' && s.curId)
        return 'position:absolute;inset:16px;background:url(' + PHOTO_URL(s.curId, 1) + ')' + tail;
      return 'position:absolute;inset:16px;background:url(' + g.img + ')' + tail;
    })();
    const galTabs = [
      ['flat', 'Чертёж'],
      ['photo', 'Фото'],
    ]
      .concat(
        s.galExtra.map((k) => [k, { render: '3D-рендер', print: 'Принт', fit: 'Примерка' }[k]]),
      )
      .map(([id, label]) => ({
        label,
        style: chip(s.gal === id),
        go: () => this.set('gal', id),
      }));

    const views = [
      ['all', 'Все виды'],
      ['front', 'Перед'],
      ['side', 'Бок'],
      ['back', 'Спинка'],
    ].map(([id, label]) => ({
      label,
      style: chip(s.view === id),
      go: () => this.set('view', id),
    }));
    const flatVB =
      { all: '0 0 560 300', front: '16 8 190 288', side: '230 8 120 288', back: '356 8 200 288' }[
        s.view
      ] || '0 0 560 300';
    const flatSvgStyle =
      s.view === 'all'
        ? 'position:absolute;inset:16px;width:calc(100% - 32px);height:calc(100% - 32px)'
        : 'position:absolute;top:16px;bottom:16px;left:50%;transform:translateX(-50%);height:calc(100% - 32px);aspect-ratio:' +
          { front: '190/288', side: '120/288', back: '200/288' }[s.view];
    const layS = (id) => 'transition:opacity .25s ease;opacity:' + (s.layers[id] ? 1 : 0);
    const layerDefs = [
      ['outline', 'Контур'],
      ['seams', 'Швы'],
      ['stitch', 'Строчки'],
      ['trims', 'Фурнитура'],
      ['callouts', 'Выноски'],
    ];
    const layers = layerDefs.map(([id, label]) => ({
      label,
      style:
        'display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:8px;cursor:pointer;font:600 10px/14px Sora,sans-serif;' +
        (s.layers[id]
          ? 'background:#0E0E0E;color:#fff'
          : 'background:#fff;border:1px solid rgba(14,14,14,.12);color:#6B6B67'),
      go: () => this.setState((p) => ({ layers: { ...p.layers, [id]: !p.layers[id] } })),
    }));
    // Живой чертёж: SVG строится в браузере из спеки, слои и виды — те же чипы.
    const L2E = { outline: 'outline', seams: 'seams', stitch: 'stitches', trims: 'hardware' };
    const engLayers = layerDefs
      .filter(([id]) => id !== 'callouts' && s.layers[id])
      .map(([id]) => L2E[id])
      .concat(['artwork']);
    const liveShots = liveOn
      ? (s.view === 'all' ? [this.flatAllUrl(engLayers)] : [this.flatUrl(s.view, engLayers)])
          .filter(Boolean)
          .map((u) => ({
            bg:
              'position:absolute;inset:16px 16px 36px;background:' +
              u +
              ' 50% 50%/contain no-repeat' +
              (s.flashSel ? ';animation:sfpulse .7s ease' : ''),
          }))
      : [];
    const calloutPos =
      s.view === 'side'
        ? [['2', 272, 140]]
        : s.view === 'back'
          ? [
              ['1', 450, 32],
              ['3', 450, 254],
            ]
          : [
              ['1', 110, 36],
              ['2', 128, 142],
              ['3', 110, 254],
            ];
    const cR = s.view === 'all' ? 8 : 5;
    const callouts = calloutPos.map(([n, x, y]) => {
      const node = nodeSrc.find((r) => r[0] === n);
      return {
        n,
        x,
        y,
        r: cR,
        tf: 'translate(' + x + ',' + y + ') scale(' + (s.view === 'all' ? 1.05 : 0.66) + ')',
        is1: n === '1',
        is2: n === '2',
        is3: n === '3',
        go: () => {
          this.setState({ section: 'nodes', selNode: n });
        },
        tipEnter: this.mkTip(node ? node[1] + ' — ' + node[2] : ''),
      };
    });

    const WHY_LIVE = {
      user: WHY.user,
      photo:
        'Оценили по фотографиям изделия через пропорции силуэта и эталон масштаба. Точность ±1–2 см.',
      lib: 'Типовое значение из размерной базы (ГОСТ + отраслевые таблицы).',
      guess: WHY.guess,
    };
    const HIST_SRC = doc ? { ...HIST0, photo: 'ИИ · оценка по фото' } : HIST0;
    const infoData = infoReal || [
      ['Категория', 'Жакет трикотажный', 'photo'],
      ['Силуэт', 'Прилегающий, асимметрия', 'photo'],
      ['Посадка', 'Обычная', 'user'],
      ['Базовый размер', 'RU 46 / M · рост 170', 'user'],
      ['Размерный ряд', 'XS–XL', 'user'],
      ['Конструктор', 'не назначен', 'lib'],
      ['Производство', 'не выбрано', 'lib'],
      ['Ревизия', '1.0 · 16 июл', 'user'],
    ];
    const info = infoData.map((r, i) => ({
      label: r[0],
      value: this.tw(r[1], 1 + (i % 2)),
      cellStyle:
        'display:flex;align-items:center;gap:9px;padding:9px 13px;min-height:' +
        (dense ? 34 : 38) +
        'px;' +
        (i % 2 === 0 ? 'border-right:1px solid #E4E1DC;' : '') +
        (i < 6 ? 'border-bottom:1px solid #E4E1DC' : ''),
      valStyle:
        'flex:1;min-width:0;font:300 12px/18px Inter,sans-serif;color:' +
        (r[2] === 'lib' ? '#B0ADA6' : '#C0392B'),
      dotStyle: this.dot(r[2], 7) + ';cursor:help',
      tipEnter: this.mkTip(
        ST[r[2]].l +
          ' — ' +
          (r[2] === 'photo'
            ? 'оценили по фото'
            : r[2] === 'user'
              ? 'вы указали в мастере'
              : 'из типовой базы'),
      ),
    }));

    const packsSrc = jobsLive
      ? s.jobs.map((j) => ({
          id: j.id,
          name: j.name,
          sub: (CAT_RU[j.category] ? CAT_RU[j.category] + ' · ' : '') + fmtWhen(j.created_at),
          status:
            j.stage === 'done'
              ? 'Готов'
              : j.stage === 'error'
                ? 'Ошибка'
                : j.stage === 'queued'
                  ? 'В очереди'
                  : 'Генерация…',
          thumbCss: this.thumbUrl(j.id),
          active: j.id === s.curId && s.screen === 'doc',
          go: () => (j.stage === 'done' ? this.openJobDoc(j.id) : this.openJobGen(j.id)),
        }))
      : fresh
        ? []
        : [
            {
              id: null,
              name: 'Структурный жакет',
              sub: '3 мин 47 с · по фото',
              status: st0,
              thumbCss: 'url(assets/thumb.jpg) 50% 50%/cover no-repeat',
              active: s.screen === 'doc',
              go: () => this.openDoc('cover'),
            },
            {
              id: null,
              name: 'Худи оверсайз',
              sub: '2 мин 12 с · по эскизу',
              status: 'Готов',
              thumbCss: 'url(assets/flat-alt.png) 50% 50%/cover no-repeat',
              active: false,
              go: () => this.openDoc('cover'),
            },
            {
              id: null,
              name: 'Брюки прямые',
              sub: 'черновик · шаг 2 из 3',
              status: 'Черновик',
              thumbCss: null,
              active: false,
              go: () => {
                this.setState({ screen: 'wizard', wizStep: 2 });
                this.showToast('Черновик открыт — продолжаем с шага 2');
              },
            },
          ];
    const packs = packsSrc
      .map((row, pi) => ({
        pi,
        name: row.name,
        sub: row.sub,
        status: row.status,
        menu: (e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          this.setState({
            packMenu: { i: pi, id: row.id, name: row.name, x: r.right, y: r.bottom + 4 },
          });
        },
        thumbBg: row.thumbCss
          ? 'display:block;width:100%;height:100%;background:' + row.thumbCss
          : '',
        isDraft: !row.thumbCss,
        notDraft: !!row.thumbCss,
        rowStyle:
          'display:flex;align-items:center;gap:8px;padding:9px;border-radius:14px;cursor:pointer;margin-top:2px;' +
          (row.active
            ? 'background:rgba(14,14,14,.055);box-shadow:inset 0 0 0 1px rgba(0,0,0,.035)'
            : 'background:transparent'),
        chipStyle:
          'padding:5px 8px;border-radius:10px;font:400 9px/9px Sora,sans-serif;letter-spacing:.5px;text-transform:uppercase;white-space:nowrap;' +
          (row.status === 'Готов'
            ? 'background:rgba(52,114,82,.07);border:1px solid rgba(52,114,82,.12);color:#2A6649'
            : row.status === 'На просчёте' ||
                row.status === 'Генерация…' ||
                row.status === 'В очереди'
              ? 'background:rgba(14,14,14,.08);border:1px solid rgba(14,14,14,.14);color:#0E0E0E'
              : 'background:rgba(14,14,14,.05);border:1px solid rgba(14,14,14,.08);color:#6B6B67'),
        open: row.go,
      }))
      .filter((p) => !s.deleted[packsSrc[p.pi].id || p.pi]);

    const tabStyle = (on) =>
      'display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 10px;border-radius:10px;cursor:pointer;max-width:210px;' +
      (on
        ? 'background:#fff;color:#0E0E0E;box-shadow:inset 0 0 0 1px rgba(255,255,255,.72),inset 0 1px 0 1px rgba(255,255,255,.55)'
        : 'background:rgba(255,255,255,.07);color:rgba(255,255,255,.62)');
    const tabs = jobsLive
      ? s.openIds
          .map((id) => {
            const j = s.jobs.find((x) => x.id === id);
            return j
              ? {
                  name: j.name,
                  go: () => this.openJobDoc(id),
                  style: tabStyle(id === s.curId && s.screen === 'doc'),
                }
              : null;
          })
          .filter(Boolean)
      : (fresh
          ? []
          : [
              { name: 'Структурный жакет', i: 0 },
              { name: 'Худи оверсайз', i: 1 },
            ]
        ).map((t) => ({
          name: t.name,
          go: () => this.setState({ tab: t.i, screen: 'doc' }),
          style: tabStyle(s.tab === t.i && s.screen === 'doc'),
        }));

    const railOpen = (s.railHov || s.railPin) && s.screen === 'doc';
    const rail = SECTIONS.map((sec, i) => {
      const on = s.section === sec.id && s.screen === 'doc';
      const hov = s.railItemHov === i;
      return {
        num: '0' + (i + 1) + '.',
        label: sec.label,
        sub: sec.sub,
        dashStyle:
          'height:2px;border-radius:2px;transition:all .16s ease;background:' +
          (on ? '#0E0E0E' : 'rgba(14,14,14,.22)') +
          ';width:' +
          (on ? 18 : 12) +
          'px',
        itemStyle:
          'position:relative;display:flex;align-items:center;gap:2px;padding:8px 9px 8px 6px;border-radius:10px;cursor:pointer;transition:background .12s ease;' +
          (on ? 'background:rgba(14,14,14,.045)' : hov ? 'background:rgba(14,14,14,.03)' : ''),
        barStyle:
          'width:2.5px;height:24px;border-radius:2px;flex:none;background:' +
          (on ? '#0E0E0E' : hov ? 'rgba(14,14,14,.35)' : 'transparent') +
          ';transition:background .12s ease',
        labelStyle:
          'display:block;font:' +
          (on || hov ? '700' : '600') +
          ' 12px/17px Sora,sans-serif;color:#0E0E0E',
        subStyle:
          'display:block;font:400 10px/14px Sora,sans-serif;color:' +
          (on || hov ? '#5A5A56' : '#6B6B67'),
        enter: () => this.set('railItemHov', i),
        leave: () => this.set('railItemHov', null),
        go: () => this.setState({ screen: 'doc', section: sec.id }),
      };
    });

    const dlSvgViews = () => {
      const viewsToSave = ['front', 'side', 'back'];
      let n = 0;
      viewsToSave.forEach((v) => {
        const svg = this.flatSvg(v);
        if (!svg) return;
        const a = document.createElement('a');
        a.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        a.download = artShortVal + '-' + v + '.svg';
        a.click();
        n++;
      });
      return n;
    };

    const exportCards = [
      ['PDF полный', '9 страниц · чертёж, замеры, материалы, конструкция', 'pdf', false],
      ['PDF по ролям', 'технолог · закройщик · ОТК · снабжение', 'pdf', false],
      ['SVG послойный', 'контур, швы, строчки, фурнитура — отдельными слоями', 'svg', false],
      ['Отправить на просчёт', 'фабрики платформы получат пак и вернут цену', 'фабрики', true],
    ].map(([name, desc, tag, green], ci) => ({
      name,
      desc,
      tag,
      go: () => {
        if (ci === 3) return this.set('calcOpen', !s.calcOpen);
        if (ci === 0 && TOKEN && s.curId && doc) {
          location.href = PDF_URL(s.curId);
          track('pdf_click', { id: s.curId });
          this.showToast('Собираем «PDF полный» — скачается автоматически');
          return;
        }
        if (ci === 1 && TOKEN && s.curId && doc) {
          const map = {
            Технолог: 'technologist',
            Закройщик: 'cutter',
            ОТК: 'qc',
            Снабжение: 'supply',
          };
          const picked = Object.keys(s.roles).filter((k) => s.roles[k] && map[k]);
          if (!picked.length)
            return this.showToast(
              'Выберите роли чипами ниже — технолог, закройщик, ОТК, снабжение',
            );
          picked.forEach((k, i) =>
            setTimeout(() => {
              const a = document.createElement('a');
              a.href = PDF_URL(s.curId) + '&role=' + map[k];
              a.click();
            }, i * 500),
          );
          track('pdf_roles', { id: s.curId, roles: picked.length });
          this.showToast(
            'Собираем PDF по ролям: ' + picked.join(', ') + ' — скачаются автоматически',
          );
          return;
        }
        if (ci === 2 && doc) {
          const n = dlSvgViews();
          if (n)
            return this.showToast(
              'SVG сохранён — ' +
                n +
                ' ' +
                plural(n, 'вид', 'вида', 'видов') +
                ', живой чертёж из спеки',
            );
        }
        this.showToast(
          ci === 2
            ? 'SVG собирается — 4 слоя, пришлём уведомление'
            : 'Собираем «' + name + '» — скачается автоматически',
        );
      },
      style:
        'border-radius:10px;border:1px solid ' +
        (green ? 'rgba(31,138,76,.3)' : '#E4E1DC') +
        ';background:' +
        (green ? 'rgba(217,242,227,.4)' : '#fff') +
        ';padding:13px 14px;cursor:pointer',
      tagStyle:
        "flex:none;padding:3px 7px;border-radius:6px;font:400 9px/13px 'JetBrains Mono',monospace;" +
        (green
          ? 'background:rgba(31,138,76,.12);color:#0D4F2B'
          : 'background:rgba(14,14,14,.05);color:#5A5A56'),
    }));

    const mkOpt = (key, label) => ({
      label,
      style:
        'padding:7px 12px;border-radius:9px;cursor:pointer;font:600 11.5px/17px Sora,sans-serif;' +
        (s.picks[key] === label
          ? 'background:#0E0E0E;color:#fff'
          : 'background:#fff;border:1px solid rgba(14,14,14,.12);color:#0E0E0E'),
      pick: () => this.setState((p) => ({ picks: { ...p.picks, [key]: label } })),
    });
    const questions = [
      {
        num: '01',
        title: 'Похоже, это ' + (s.picks.cat || 'худи').toLowerCase() + ' — верно?',
        why: 'категория задаёт набор точек замеров',
        auto: true,
        opts: ['Худи', 'Свитшот', 'Лонгслив', 'Футболка'].map((l) => mkOpt('cat', l)),
        extra: false,
      },
      {
        num: '02',
        title: 'Базовый размер и рост',
        why: 'остальные размеры считаются от него',
        auto: false,
        opts: ['RU 44 / S', 'RU 46 / M', 'RU 48 / L'].map((l) => mkOpt('size', l)),
        extra: false,
      },
      {
        num: '03',
        title: 'Посадка',
        why: 'влияет на прибавки по груди и пройме',
        auto: false,
        opts: ['Прилегающая', 'Обычная', 'Свободная', 'Oversize'].map((l) => mkOpt('fit', l)),
        extra: false,
      },
      {
        num: '04',
        title: 'Материал — трикотаж, так?',
        why: 'от него зависят допуски и усадка',
        auto: true,
        opts: ['Трикотаж', 'Ткань'].map((l) => mkOpt('mat', l)),
        extra: false,
      },
      {
        num: '05',
        title: 'Размерный ряд и тираж',
        why: 'по ряду строится градация',
        auto: false,
        opts: ['XS–XL', 'S–XXL', '42–52'].map((l) => mkOpt('range', l)),
        extra: true,
        extraOpts: ['50', '100', '300', '500+'].map((l) => mkOpt('qty', l)),
      },
    ];

    const stageKeys = ['vision', 'assembly', 'assembly', 'render', 'docgen'];
    const stTime = (i) => {
      if (!s.genStages) return null;
      const idx = s.genStages.findIndex((h) => h.stage === stageKeys[i]);
      if (idx < 0) return null;
      const next = s.genStages[idx + 1];
      if (!next) return null;
      const sec = Math.max(
        1,
        Math.round((Date.parse(next.at) - Date.parse(s.genStages[idx].at)) / 1000),
      );
      return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    };
    const stageNames = [
      ['Разбираем фото', '0:14'],
      ['Строим чертёж', '1:02'],
      ['Считаем замеры и градацию', '0:48'],
      ['Собираем материалы', '0:22'],
      ['Формируем документ', '0:31'],
    ];
    const stages = stageNames.map(([name, time], i) => {
      const st = i < s.genStep ? 'done' : i === s.genStep && !s.genDone ? 'run' : 'wait';
      return {
        name,
        time: st === 'wait' ? '—' : s.genStages ? stTime(i) || '…' : time,
        nameStyle:
          'flex:1;font:400 12px/18px Sora,sans-serif;color:' +
          (st === 'wait' ? '#B0ADA6' : '#0E0E0E'),
        dotStyle:
          'width:9px;height:9px;flex:none;border-radius:50%;background:' +
          (st === 'done' ? '#2F7C5A' : st === 'run' ? '#0E0E0E' : 'rgba(14,14,14,.16)') +
          (st === 'run' ? ';animation:sfpulse 1.2s ease infinite' : ''),
      };
    });

    const TOOLS = {
      new: {
        title: 'Создать техпак',
        kicker: 'Полный цикл',
        head: 'Загрузите референсы',
        desc: 'Соберём редактируемый пак целиком: чертёж, замеры, материалы, конструкция и PDF.',
        cta: 'Создать техпак',
        credit: '1 генерация',
        on: s.refFiles.length > 0,
        hint: 'добавьте хотя бы одно фото',
        sec: true,
      },
      draw: {
        title: 'Технический чертёж',
        kicker: 'Быстрое действие',
        head: 'Чертёж из одного фото',
        desc: 'Только флэт в 3 видах — без полного пака. Быстрее и не тратит генерацию.',
        cta: 'Построить чертёж',
        credit: 'бесплатно в бете',
        on: s.drawFile,
        hint: 'добавьте фото изделия',
        sec: false,
      },
      render: {
        title: '3D-рендер',
        kicker: 'Быстрое действие',
        head: 'Рендер из текущего пака',
        desc: 'Объёмная визуализация по чертежу и материалам выбранного техпака.',
        cta: 'Создать рендер',
        credit: '~6 мин',
        on: true,
        hint: '',
        sec: false,
      },
      print: {
        title: 'Создать принт',
        kicker: 'Быстрое действие',
        head: 'Принт по описанию',
        desc: 'Сгенерируем принт и разложим его по выбранной зоне изделия.',
        cta: 'Сгенерировать принт',
        credit: '~2 мин',
        on: !!s.printText.trim(),
        hint: 'опишите принт словами',
        sec: false,
      },
      fit: {
        title: 'Виртуальная примерка',
        kicker: 'Быстрое действие',
        head: 'Примерка на модели',
        desc: 'Покажем посадку изделия на фото модели по таблице замеров пака.',
        cta: 'Примерить',
        credit: '~4 мин',
        on: s.fitFile,
        hint: 'нужно фото модели',
        sec: false,
      },
    };
    const tmv = s.toolMode ? TOOLS[s.toolMode] : null;
    const toolBtn = (id) =>
      'width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .14s ease;' +
      (s.toolMode === id ? 'background:#0E0E0E;color:#fff' : 'color:#0E0E0E');
    // ширина кнопок панели режимов

    const toolGo = (id) => () => this.set('toolMode', s.toolMode === id ? null : id);
    const pchip = (on) =>
      'padding:6px 11px;border-radius:9px;cursor:pointer;font:600 10.5px/15px Sora,sans-serif;' +
      (on
        ? 'background:#0E0E0E;color:#fff'
        : 'background:#fff;border:1px solid rgba(14,14,14,.12);color:#0E0E0E');
    const renderChips = ['Ракурс ¾', 'Фронт', 'Спина', 'Деталь'].map((a) => ({
      label: a,
      style: pchip(!!s.rAngles[a]),
      go: () => this.setState((p) => ({ rAngles: { ...p.rAngles, [a]: !p.rAngles[a] } })),
    }));
    const placeChips = ['Грудь', 'Спина', 'Рукав', 'Весь метраж'].map((a) => ({
      label: a,
      style: pchip(s.printPlace === a),
      go: () => this.set('printPlace', a),
    }));
    const fitChips = ['S', 'M', 'L'].map((a) => ({
      label: a,
      style: pchip(s.fitSize === a),
      go: () => this.set('fitSize', a),
    }));
    const roleChips = ['Технолог', 'Закройщик', 'ОТК', 'Снабжение'].map((r) => ({
      label: r,
      style: pchip(!!s.roles[r]),
      go: () => this.setState((p) => ({ roles: { ...p.roles, [r]: !p.roles[r] } })),
    }));

    const dashSrc = jobsLive
      ? s.jobs.map((j) => {
          const st1 =
            j.stage === 'done'
              ? 'Готов'
              : j.stage === 'error'
                ? 'Ошибка'
                : j.stage === 'queued'
                  ? 'В очереди'
                  : 'Генерация…';
          const thumb = this.thumbUrl(j.id);
          return [
            j.name,
            (CAT_RU[j.category] || 'Пак') + ' · ' + fmtWhen(j.created_at),
            j.stage === 'done' ? 'v1.0' : 'черновик',
            st1,
            thumb ? thumb + ' 50% 50%/contain no-repeat' : null,
            j,
            j.article || '',
          ];
        })
      : !DEMO
        ? []
        : [
            [
              'Структурный жакет',
              'Жакет · 16 июл, 07:10',
              'v1.0',
              st0,
              'url(assets/flat-alt.png) 50% 50%/contain no-repeat',
              null,
              '498BA296',
            ],
            [
              'Худи оверсайз',
              'Худи · 12 июл, 18:02',
              'v2.1',
              'Готов',
              'url(assets/thumb.jpg) 50% 50%/contain no-repeat',
              null,
              '7A2C1105',
            ],
            [
              'Брюки прямые',
              'Брюки · сегодня, 03:40',
              'черновик',
              'Черновик',
              'url(assets/flat-main.png) 50% 50%/contain no-repeat',
              null,
              'B4E80233',
            ],
          ];
    const q = (s.dashQ || '').toLowerCase();
    const dashCards = dashSrc
      .filter(
        (d) =>
          (s.dashFilter === 'Все' || d[3] === s.dashFilter) &&
          (d[0].toLowerCase().includes(q) || (d[6] || '').toLowerCase().includes(q)),
      )
      .map(([name, meta, ver, status, bg, j, _art]) => ({
        isDraft: !bg,
        notDraft: !!bg,
        name,
        meta,
        ver,
        status,
        bg: 'display:block;width:88%;height:128px;background:' + (bg || 'none'),
        chipStyle:
          'flex:none;padding:5px 8px;border-radius:10px;font:400 9px/9px Sora,sans-serif;letter-spacing:.5px;text-transform:uppercase;' +
          (status === 'Готов'
            ? 'background:rgba(52,114,82,.07);border:1px solid rgba(52,114,82,.12);color:#2A6649'
            : status === 'На просчёте' || status === 'Генерация…' || status === 'В очереди'
              ? 'background:rgba(14,14,14,.08);border:1px solid rgba(14,14,14,.14);color:#0E0E0E'
              : 'background:rgba(14,14,14,.05);border:1px solid rgba(14,14,14,.08);color:#6B6B67'),
        open: () =>
          j
            ? j.stage === 'done'
              ? this.openJobDoc(j.id)
              : this.openJobGen(j.id)
            : status === 'Черновик'
              ? this.setState({ screen: 'wizard', wizStep: 2 })
              : this.openDoc('cover'),
      }));
    const dashFilters = ['Все', 'Готов', 'Черновик', 'На просчёте'].map((f) => ({
      label: f,
      style: pchip(s.dashFilter === f),
      go: () => this.set('dashFilter', f),
    }));

    const wizCtaOn = true;
    const narrow = s.w < 1024 || s.sideHid;
    const PV = {
      Русский: {
        sec: 'Обзор',
        l: ['Бренд', 'Название', 'Сезон', 'База'],
        na: 'не указан',
        r: ['Категория', 'Силуэт', 'Посадка'],
        v: [
          doc ? CAT_RU[doc.style.category] || 'Изделие' : 'Жакет',
          '—',
          doc && doc.base ? FIT_RU[doc.base.fit_intent] || 'Обычная' : 'Прилегающий',
        ],
      },
      English: {
        sec: 'Overview',
        l: ['Brand', 'Style name', 'Season', 'Base size'],
        na: 'not set',
        r: ['Category', 'Silhouette', 'Fit'],
        v: ['Jacket', 'Slim', 'Regular'],
      },
      中文: {
        sec: '概览',
        l: ['品牌', '款名', '季节', '基码'],
        na: '未填写',
        r: ['品类', '廓形', '版型'],
        v: ['夹克', '修身', '常规'],
      },
    }[s.pdfLang] || {
      sec: 'Обзор',
      l: ['Бренд', 'Название', 'Сезон', 'База'],
      na: 'не указан',
      r: ['Категория', 'Силуэт', 'Посадка'],
      v: ['Жакет', 'Прилегающий', 'Обычная'],
    };

    const lastJob = jobsLive ? s.jobs.find((j) => j.stage === 'done') || s.jobs[0] || null : null;
    const schemeReal = liveOn ? liveFrontUrl : null;

    return {
      noop: () => {},
      isDoc: s.screen === 'doc',
      isWizard: s.screen === 'wizard',
      secCover: s.screen === 'doc' && !s.docLoading && s.section === 'cover',
      secFlats: s.screen === 'doc' && !s.docLoading && s.section === 'flats',
      secPom: s.screen === 'doc' && !s.docLoading && s.section === 'pom',
      secBom: s.screen === 'doc' && !s.docLoading && s.section === 'bom',
      secNodes: s.screen === 'doc' && !s.docLoading && s.section === 'nodes',
      secExport: s.screen === 'doc' && !s.docLoading && s.section === 'export',
      pro,
      packs,
      tabs,
      rail,
      galTabs,
      info,
      pomRows,
      bom,
      nodes,
      ops,
      exportCards,
      questions,
      stages,
      railClosed: !railOpen,
      railOpen,
      railEnter: () => this.set('railHov', true),
      railLeave: () => this.set('railHov', false),
      togglePin: () => this.set('railPin', !s.railPin),
      pinStyle:
        'position:absolute;right:7px;top:7px;width:24px;height:24px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;' +
        (s.railPin ? 'background:#0E0E0E;color:#fff' : 'color:#B0ADA6'),
      pomCols: this.pomColsRaw(pro),
      burgerOn: narrow,
      toggleSide: () =>
        s.w < 1024
          ? this.set('sideOpen', !s.sideOpen)
          : this.setState({ sideHid: !s.sideHid, sideOpen: false }),
      sideWrapStyle: narrow
        ? 'min-width:0;padding:0;overflow:' +
          (s.sideOpen ? 'visible;position:relative;z-index:38' : 'hidden')
        : 'padding:0 12px;min-width:0',
      sideCardStyle:
        narrow && s.sideOpen
          ? 'position:fixed;left:8px;top:52px;bottom:8px;width:300px;z-index:38;border-radius:18px;background:#F4F2EF;border:1px solid rgba(14,14,14,.12);box-shadow:0 30px 80px rgba(14,14,14,.28);display:flex;flex-direction:column;overflow:hidden'
          : 'height:100%;border-radius:18px;background:rgba(255,255,255,.48);border:1px solid rgba(14,14,14,.08);box-shadow:inset 0 1px 0 1px rgba(255,255,255,.7);display:flex;flex-direction:column;overflow:hidden',
      sideTotals: fresh
        ? 'Пока пусто — создайте первый пак'
        : 'Всего: ' +
          s.collections.length +
          ' ' +
          plural(s.collections.length, 'коллекция', 'коллекции', 'коллекций') +
          ', ' +
          packs.length +
          ' ' +
          plural(packs.length, 'пак', 'пака', 'паков'),
      notifDotStyle:
        !DEMO || fresh
          ? 'display:none'
          : 'position:absolute;right:5px;top:5px;width:6px;height:6px;border-radius:50%;background:#C0392B;border:1.5px solid #fff',
      balLabel: fresh ? '3 из 3' : '2 из 3',
      balShort: fresh ? '3/3' : '2/3',
      packCount: String(packs.length),
      planBig: fresh ? '3' : '2',
      balSlash: fresh ? '3 / 3' : '2 / 3',
      balBarStyle:
        'display:block;width:' +
        (fresh ? 100 : 66) +
        '%;height:100%;border-radius:99px;background:#0E0E0E',
      demoSeedOn: DEMO,
      centerWrapStyle: narrow
        ? 'position:relative;width:100%;margin:0 auto'
        : 'position:relative;width:100%;max-width:1030px;min-width:820px;margin:0 auto',
      docCardStyle:
        (narrow ? 'margin-left:58px;' : 'margin-left:74px;') +
        'border-radius:14px;background:#F4F2EF;border:1px solid #E4E1DC;box-shadow:0 20px 48px rgba(14,14,14,.1),0 4px 14px rgba(14,14,14,.06);overflow:hidden',
      toolColStyle:
        'position:relative;display:flex;align-items:center;justify-content:center' +
        (narrow || s.screen === 'lib' || s.screen === 'plan' ? ';width:0' : ''),
      toolPillStyle:
        (narrow || s.screen === 'lib' || s.screen === 'plan' ? 'display:none' : 'display:flex') +
        ';border-radius:999px;background:rgba(255,255,255,.76);border:1px solid rgba(14,14,14,.08);box-shadow:0 16px 42px rgba(0,0,0,.1),inset 0 1px 0 1px rgba(255,255,255,.8);padding:9px 0;flex-direction:column;align-items:center;gap:9px',
      toolPanelPos: narrow
        ? 'position:fixed;right:8px;top:46px;bottom:8px;width:312px;z-index:38'
        : 'position:absolute;right:64px;top:11px;bottom:11px;width:312px;z-index:12',
      greetText: fresh
        ? 'Привет' + (s.me ? ', ' + s.me.name : '') + ' — добро пожаловать в Seamsterly.'
        : 'Привет' + (s.me ? ', ' + s.me.name : DEMO ? ', Данил' : '') + ' — с возвращением.',
      heroExOn: !fresh,
      pvSection: PV.sec,
      pvL1: PV.l[0],
      pvL2: PV.l[1],
      pvL3: PV.l[2],
      pvL4: PV.l[3],
      pvNA: PV.na,
      pvR1: PV.r[0],
      pvR2: PV.r[1],
      pvR3: PV.r[2],
      pvV1: PV.v[0],
      pvV2: PV.v[1],
      pvV3: PV.v[2],
      galKicker: g.k,
      galBadge: g.b,
      galStageBg: galBgVal,
      zoomIn: () => this.set('galZoom', Math.min(1.8, Math.round((s.galZoom + 0.2) * 10) / 10)),
      zoomOut: () => this.set('galZoom', Math.max(1, Math.round((s.galZoom - 0.2) * 10) / 10)),
      dlGal: () => {
        if (doc && s.gal === 'flat') {
          const svg = this.flatSvg('front');
          if (svg) {
            const a = document.createElement('a');
            a.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            a.download = artShortVal + '-front.svg';
            a.click();
            this.showToast('SVG сохранён: «' + docNameVal + ' — чертёж»');
            return;
          }
        }
        if (doc && s.gal === 'photo' && TOKEN && s.curId) {
          const a = document.createElement('a');
          a.href = PHOTO_URL(s.curId, 1);
          a.download = artShortVal + '-photo-1.jpg';
          a.click();
          this.showToast('Фото сохранено: «' + docNameVal + ' — референс 1»');
          return;
        }
        this.showToast('PNG сохранён: «' + docNameVal + ' — ' + g.k.toLowerCase() + '» (имитация)');
      },
      views,
      layers,
      callouts,
      flatVB,
      flatSvgStyle,
      layOutline: layS('outline'),
      laySeams: layS('seams'),
      layStitch: layS('stitch'),
      layTrims: layS('trims'),
      calloutsOn: s.layers.callouts && !liveOn,
      liveFlatOn: liveOn,
      liveFlatOff: !liveOn,
      liveShots,
      viewBadge:
        s.view === 'all'
          ? liveOn
            ? '3 вида · живой чертёж'
            : '3 вида · клик по номеру откроет узел'
          : 'вид: ' + { front: 'перед', side: 'бок', back: 'спинка' }[s.view],
      pager: secIdx + 1 + ' / ' + SECTIONS.length,
      exports: [
        { tag: 'PDF', name: 'PDF полный', sub: '9 страниц, готов к отправке' },
        { tag: 'ROLE', name: 'PDF по ролям', sub: 'технолог, закройщик, ОТК' },
        { tag: 'SVG', name: 'SVG послойный', sub: 'контур, швы, фурнитура' },
        { tag: 'XLS', name: 'Замеры таблицей', sub: 'POM + градация' },
      ],
      shots: (
        s.wshots || [
          ['assets/flat-main.png', 'photo-front.jpg', '1,2 МБ'],
          ['assets/flat-alt.png', 'sketch-back.png', '374 КБ'],
          ['assets/thumb.jpg', 'detail-zip.jpg', '88 КБ'],
        ]
      ).map(([src, name, size], si) => ({
        name,
        size,
        bg:
          'display:block;width:86%;height:130px;background:url(' +
          src +
          ') 50% 50%/contain no-repeat',
        remove: () => {
          const cur = s.wshots || [
            ['assets/flat-main.png', 'photo-front.jpg', '1,2 МБ'],
            ['assets/flat-alt.png', 'sketch-back.png', '374 КБ'],
            ['assets/thumb.jpg', 'detail-zip.jpg', '88 КБ'],
          ];
          if (!DEMO) this._files.splice(si, 1);
          this.set(
            'wshots',
            cur.filter((x, xi) => xi !== si),
          );
          this.showToast('Файл «' + name + '» удалён из загрузки');
        },
      })),
      wizDropLabel: (() => {
        const n = (s.wshots || [1, 2, 3]).length;
        return n >= 6
          ? 'Максимум 6 файлов — удалите лишние'
          : 'Перетащите фото или эскиз — ' + n + ' из 6';
      })(),
      wizAddShot: () => {
        if (!DEMO) {
          if ((s.wshots || []).length >= 6) return this.showToast('Уже 6 файлов — это максимум');
          this.pickFiles(false);
          return;
        }
        const cur = s.wshots || [
          ['assets/flat-main.png', 'photo-front.jpg', '1,2 МБ'],
          ['assets/flat-alt.png', 'sketch-back.png', '374 КБ'],
          ['assets/thumb.jpg', 'detail-zip.jpg', '88 КБ'],
        ];
        if (cur.length >= 6) return this.showToast('Уже 6 файлов — это максимум');
        const srcs = ['assets/flat-main.png', 'assets/thumb.jpg', 'assets/flat-alt.png'];
        this.set(
          'wshots',
          cur.concat([
            [
              srcs[cur.length % 3],
              'photo-' + (cur.length + 1) + '.jpg',
              200 + cur.length * 130 + ' КБ',
            ],
          ]),
        );
        this.showToast('Файл добавлен — ' + (cur.length + 1) + ' из 6');
      },
      hasGuesses: guessCount > 0,
      noGuesses: guessCount === 0,
      guessBanner:
        guessCount + ' ' + this.plural(guessCount) + ' — предположения, подтвердите их по образцу',
      guessLabel: s.onlyGuess ? 'Показаны только они' : 'Предположения: ' + guessCount,
      guessBtnStyle:
        'height:31px;border-radius:10px;display:flex;align-items:center;gap:6px;padding:0 11px;cursor:pointer;' +
        (s.onlyGuess
          ? 'background:#C0392B;border:1px solid #C0392B;color:#fff'
          : 'background:#fff;border:1px solid rgba(192,57,43,.28);color:#C0392B'),
      toggleGuess: () => this.setState({ onlyGuess: !s.onlyGuess, section: 'pom', screen: 'doc' }),
      proTrackStyle:
        'width:30px;height:18px;border-radius:999px;position:relative;transition:background .16s ease;flex:none;background:' +
        (pro ? '#0E0E0E' : 'rgba(14,14,14,.14)'),
      proKnobStyle:
        'position:absolute;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(14,14,14,.2);transition:left .16s ease;left:' +
        (pro ? '14px' : '2px'),
      togglePro: () => this.set('pro', !pro),
      proTipEnter: this.mkTip(
        'Раскрывает ГОСТ-коды швов, SPI, приращения градации и техпоследовательность. Экранов не добавляет.',
      ),
      nodesProCta: pro ? 'скрыть Pro-детали' : 'включить Pro-режим',
      exportOpen: s.exportOpen,
      toggleExport: () => this.set('exportOpen', !s.exportOpen),
      goExportSec: () => this.setState({ exportOpen: false, screen: 'doc', section: 'export' }),
      goCover: () => this.setState({ screen: 'doc', section: 'cover' }),
      goFlats: () => this.setState({ screen: 'doc', section: 'flats' }),
      goPom: () => this.setState({ screen: 'doc', section: 'pom' }),
      goBom: () => this.setState({ screen: 'doc', section: 'bom' }),
      prevSec: () =>
        this.setState({ screen: 'doc', section: SECTIONS[Math.max(0, secIdx - 1)].id }),
      nextSec: () =>
        this.setState({
          screen: 'doc',
          section: SECTIONS[Math.min(SECTIONS.length - 1, secIdx + 1)].id,
        }),
      hasSel: !!selRow && s.section === 'pom',
      selCode: s.sel || '',
      selName: selRow ? selRow[1] : '',
      selVal: selRow ? (s.vals[s.sel] !== undefined ? s.vals[s.sel] : selRow[3]) : '',
      selTol: selRow ? 'допуск ±' + (s.tols[s.sel] || selRow[4]) : '',
      selTolVal: selRow ? s.tols[s.sel] || selRow[4] : '',
      selStLabel: ST[selKind].l,
      selDotStyle: this.dot(selKind, 8),
      selWhy: (doc ? WHY_LIVE : WHY)[selKind],
      selHow: selRow ? selRow[11] : '',
      schemeStyle:
        (schemeReal
          ? 'background:' + schemeReal + ' 50% 50%/contain no-repeat,#fff;min-height:170px'
          : 'background:url(assets/flat-alt.png) ' +
            (s.sel === 'D' || s.sel === 'H' ? '50% 50%' : '12% 50%') +
            '/200% auto no-repeat,#fff;min-height:170px') +
        (s.flashSel
          ? ';animation:sfpulse .7s ease;box-shadow:inset 0 0 0 2px rgba(14,14,14,.3)'
          : ''),
      onTol: (e) => {
        let v = e.target.value;
        if (s.unit === 'in') {
          const n = parseFloat(String(v).replace(',', '.'));
          if (isFinite(n)) v = (n * 2.54).toFixed(1).replace('.', ',');
        }
        const prev = s.tols[s.sel];
        this.setState((p) => ({
          tols: { ...p.tols, [s.sel]: v },
          undoStack: p.undoStack.concat([{ type: 'tol', code: s.sel, prev }]),
        }));
        this.pushHist(s.sel, 'допуск ±' + (prev || (selRow ? selRow[4] : '')) + ' → ±' + v);
        this.showToast('Допуск ' + s.sel + ' перекрыт: ±' + v + ' см · ⌘Z отменит');
      },
      confirmSel: () => {
        this.pushHist(s.sel, 'подтверждено по образцу');
        this.setState((p) => ({ confirmed: { ...p.confirmed, [s.sel]: true } }));
        this.showToast(s.sel + ' подтверждено по образцу — статус обновлён');
      },
      resetSel: () => {
        this.pushHist(s.sel, 'сброс к рассчитанному значению');
        this.setState((p) => {
          const vals = { ...p.vals };
          const tols = { ...p.tols };
          const conf = { ...p.confirmed };
          delete vals[s.sel];
          delete tols[s.sel];
          delete conf[s.sel];
          return { vals, tols, confirmed: conf };
        });
        this.showToast(
          doc
            ? s.sel + ' — локальная правка сброшена; применённое значение отменит ⌘Z'
            : s.sel + ' сброшено к рассчитанному значению',
        );
      },
      deselect: () => this.set('sel', null),
      resetAll: () => {
        this.setState({ vals: {}, tols: {}, confirmed: {} });
        this.showToast(
          doc
            ? 'Локальные правки сброшены — применённые значения отменит ⌘Z'
            : 'Все правки сброшены к рассчитанным значениям',
        );
      },
      recalc: () => this.showToast('Градация пересчитана от базы ' + INT_OF(bru, bru)),
      gradTipEnter: this.mkTip(
        'Градация — автоматический пересчёт всех размеров ряда от базового. Приращения видны в Pro-режиме.',
      ),
      tolTipEnter: this.mkTip(
        'Допуск — разрешённое отклонение фабрики от нормы. Перекрывается для каждой точки отдельно.',
      ),
      qtyTipEnter: this.mkTip(
        'Расход на единицу изделия. Предварительный — фабрика уточнит после раскладки лекал.',
      ),
      spiTipEnter: this.mkTip('SPI — стежков на дюйм. Плотность строчки, которую проверяет ОТК.'),
      tbTip1: this.mkTip('Новый техпак'),
      tbTip2: this.mkTip('Технический чертёж'),
      tbTip3: this.mkTip('3D-рендер'),
      tbTip4: this.mkTip('Создать принт'),
      tbTip5: this.mkTip('Виртуальная примерка'),
      isAuth: s.screen === 'auth',
      isDash: s.screen === 'dash',
      isLib: s.screen === 'lib',
      isPlan: s.screen === 'plan',
      isHome: s.screen === 'home',
      isGen: s.screen === 'gen',
      genMiles: [
        ['Анализ', 0],
        ['Генерация', 2],
        ['Сборка', 4],
      ].map(([label, at]) => {
        const active = s.genStep >= at && (s.genStep < at + 2 || (at === 4 && !s.genDone));
        const done = s.genDone || s.genStep >= at + 2;
        return {
          label,
          dotStyle:
            'width:7px;height:7px;border-radius:50%;background:' +
            (done || active ? '#0E0E0E' : 'rgba(14,14,14,.2)') +
            (active && !s.genDone ? ';animation:sfpulse 1.4s ease infinite' : ''),
          labelStyle:
            'font:' +
            (active && !s.genDone ? '700' : '400') +
            ' 9px/13px Sora,sans-serif;letter-spacing:1.3px;text-transform:uppercase;color:' +
            (done || active ? '#0E0E0E' : '#B0ADA6'),
        };
      }),
      genBarStyle:
        'display:block;height:100%;border-radius:99px;background:#0E0E0E;transition:width .8s ease;width:' +
        (s.genDone ? 100 : Math.min(96, Math.round((s.genStep / 5) * 100) + 9)) +
        '%',
      genElapsed: Math.floor(s.genSecs / 60) + ':' + String(s.genSecs % 60).padStart(2, '0'),
      genStatus:
        s.genErr && s.genError
          ? s.genError.message
          : [
              'Отделяем крой от стилистического шума…',
              'Проверяем силуэт, фурнитуру и швы…',
              'Строим чертёж в трёх видах…',
              'Считаем замеры и градацию…',
              'Собираем материалы и документ…',
              'Готово',
            ][Math.min(5, s.genStep)],
      genErrOff: !s.genErr,
      genCards: [
        [
          'Референс 1',
          s.wshots && s.wshots[0] && s.wshots[0][0] && String(s.wshots[0][0]).indexOf('blob:') === 0
            ? s.wshots[0][0]
            : TOKEN && s.curId
              ? PHOTO_URL(s.curId, 1)
              : 'assets/flat-main.png',
          0,
          -5,
        ],
        [
          'Технический чертёж',
          (TOKEN && s.curId && this.thumbUrl(s.curId)) || 'assets/flat-alt.png',
          2,
          3,
        ],
        ['Рендер в 3 видах', 'assets/thumb.jpg', 4, -2],
      ]
        .filter((c) => s.genStep >= c[2])
        .map(([label, img, _at, rot], i) => ({
          label,
          wrapStyle:
            '--rot:' +
            rot +
            'deg;animation:sffloat ' +
            (3.6 + i * 0.7) +
            's ease-in-out ' +
            i * 0.5 +
            's infinite alternate;margin-left:' +
            (i === 0 ? 0 : -18) +
            'px;z-index:' +
            (i + 1),
          cardStyle:
            '--rot:' +
            rot +
            'deg;width:212px;border-radius:14px;background:#fff;border:1px solid #E4E1DC;box-shadow:0 28px 64px rgba(14,14,14,.16);padding:12px 13px;display:flex;flex-direction:column;gap:8px;animation:sfcard .5s ease backwards',
          imgStyle:
            'display:block;height:150px;background:' +
            (String(img).indexOf('url(') === 0 ? img : 'url(' + img + ')') +
            ' 50% 50%/contain no-repeat',
        })),
      genPanelOn: s.genPanel,
      genPanelClosed: !s.genPanel,
      openGenPanel: () => this.set('genPanel', true),
      closeGenPanel: () => this.set('genPanel', false),
      genConfirm: () => {
        // Поля панели — без биндингов в разметке прототипа: значения читаются
        // из DOM по плейсхолдерам и уходят PATCH-ем в метаданные пака.
        if (TOKEN && s.curId) {
          const byPh = (ph) => {
            const el = document.querySelector('input[placeholder="' + ph + '"]');
            return el && el.value.trim() ? el.value.trim() : undefined;
          };
          const patch = {
            brand: byPh('Ваш бренд'),
            name: byPh('Жакет-трукер'),
            season: byPh('FW 2026'),
            description:
              [byPh('Силуэт, ключевые детали…'), byPh('Основная ткань, подклад, фурнитура…')]
                .filter(Boolean)
                .join(' · ') || undefined,
          };
          if (Object.values(patch).some(Boolean)) {
            apiCall('/jobs/' + s.curId + '/meta', {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(patch),
            })
              .then(() => this.refreshJobs())
              .catch(() => {});
          }
        }
        this.set('genPanel', false);
        this.showToast('Детали прикреплены — попадут в готовый пак');
      },
      genCancel: () => {
        clearInterval(this._g);
        clearInterval(this._gs);
        clearInterval(this._pl);
        this.setState({ screen: 'home', genErr: false });
        this.showToast(
          TOKEN && s.curId
            ? 'Генерация продолжится в фоне — пак появится в списке'
            : 'Генерация остановлена — черновик сохранён, лимит не списан',
        );
      },
      genOpenPack: () => {
        if (TOKEN && s.curId) {
          this.openJobDoc(s.curId);
          this.startTyping();
          this.showToast('Техпак готов — документ собран из спеки');
          return;
        }
        this.openDoc('cover');
        this.startTyping();
        this.showToast('Техпак готов — 9 страниц · тексты дописывает ИИ');
      },
      qaOpen: s.qaOpen,
      colOpen: s.colOpen,
      toggleQa: () => this.set('qaOpen', !s.qaOpen),
      toggleCol: () => this.set('colOpen', !s.colOpen),
      qaChevStyle:
        'transition:transform .16s ease;transform:rotate(' + (s.qaOpen ? 90 : 0) + 'deg)',
      newCol: () => this.setState({ colFormOpen: true, colName: '' }),
      colCount: String(s.collections.length),
      colHasNone: s.collections.length === 0 && !s.colFormOpen,
      colFormOpen: s.colFormOpen,
      colFormClosed: !s.colFormOpen,
      colNameVal: s.colName,
      onColName: (e) => this.set('colName', e.target.value),
      colCancel: () => this.set('colFormOpen', false),
      colCreate: () => {
        const name = (s.colName || '').trim() || 'Осень-зима 2026';
        this.setState(
          (p) => ({
            collections: p.collections.concat([{ name, items: [], open: true }]),
            colFormOpen: false,
          }),
          () => this.persistProfile(),
        );
        this.showToast('Коллекция «' + name + '» создана — добавьте паки');
      },
      cols: s.collections.map((c, ci) => ({
        name: c.name,
        count:
          c.items.length +
          (c.items.length === 1
            ? ' пак'
            : c.items.length > 1 && c.items.length < 5
              ? ' пака'
              : ' паков'),
        chevStyle:
          'flex:none;transition:transform .16s ease;transform:rotate(' + (c.open ? 90 : 0) + 'deg)',
        open: c.open,
        full: c.open && c.items.length >= packNames.length,
        toggleAdd: () =>
          this.setState((p) => ({
            collections: p.collections.map((x, xi) => (xi === ci ? { ...x, open: !x.open } : x)),
          })),
        inside: c.items.map((n) => ({ name: n })),
        addable: packNames
          .filter((n) => c.items.indexOf(n) < 0)
          .map((n) => ({
            name: 'добавить: ' + n,
            add: () => {
              this.setState(
                (p) => ({
                  collections: p.collections.map((x, xi) =>
                    xi === ci ? { ...x, items: x.items.concat([n]) } : x,
                  ),
                }),
                () => this.persistProfile(),
              );
              this.showToast('«' + n + '» — в коллекции «' + c.name + '»');
            },
          })),
      })),
      matCount: String((DEMO ? 2 : 0) + s.libMats.length),
      libMatRows: s.libMats.map((m) => ({
        name: m.name,
        spec: m.spec + ' · добавлен вами',
        pan: m.pan || '—',
        sw:
          'width:14px;height:14px;flex:none;border-radius:5px;background:' +
          m.hex +
          ';border:1px solid rgba(14,14,14,.14)',
      })),
      matFormOpen: s.matFormOpen,
      matAdd: () => this.set('matFormOpen', !s.matFormOpen),
      matAddLabel: s.matFormOpen ? 'Свернуть форму' : 'Добавить материал',
      matNameVal: s.matName,
      matSpecVal: s.matSpec,
      matPanVal: s.matPan,
      onMatName: (e) => this.set('matName', e.target.value),
      onMatSpec: (e) => this.set('matSpec', e.target.value),
      onMatPan: (e) => this.set('matPan', e.target.value),
      matSwatches: ['#0E0E0E', '#B8B8B4', '#E8E2D5', '#4A5A48', '#7A2E2A'].map((h) => ({
        pick: () => this.set('matHex', h),
        style:
          'width:20px;height:20px;flex:none;border-radius:7px;background:' +
          h +
          ';cursor:pointer;border:1px solid rgba(14,14,14,.14)' +
          (s.matHex === h ? ';box-shadow:0 0 0 2px #fff,0 0 0 3.5px #0E0E0E' : ''),
      })),
      matSaveStyle:
        'height:27px;border-radius:8px;display:flex;align-items:center;padding:0 11px;font:600 10.5px/15px Sora,sans-serif;' +
        ((s.matName || '').trim()
          ? 'background:#0E0E0E;color:#fff;cursor:pointer'
          : 'background:rgba(14,14,14,.12);color:rgba(14,14,14,.4);cursor:default'),
      matSave: () => {
        if (!(s.matName || '').trim()) return;
        this.setState(
          (p) => ({
            libMats: p.libMats.concat([
              {
                name: p.matName.trim(),
                spec: (p.matSpec || '').trim() || 'состав уточняется',
                hex: p.matHex,
                pan: (p.matPan || '').trim(),
              },
            ]),
            matFormOpen: false,
            matName: '',
            matSpec: '',
            matPan: '',
          }),
          () => this.persistProfile(),
        );
        this.showToast('Материал сохранён — доступен во всех паках через «+ из библиотеки»');
      },
      gridDot:
        'width:7px;height:7px;flex:none;border-radius:50%;background:' +
        (s.libGrid ? '#2F7C5A' : '#B0ADA6'),
      gridStatus: s.libGrid
        ? 'ваша сетка: 6 размеров (XS–XXL) — перекрывает ГОСТ во всех паках'
        : 'используется: ГОСТ 31396 + отраслевые таблицы',
      gridBtnLabel: s.libGrid ? 'Заменить сетку' : 'Загрузить сетку (CSV)',
      uploadGrid: () => {
        this.set('libGrid', true);
        this.persistProfile();
        this.showToast('Сетка brand-grid.csv загружена — градация пересчитана');
      },
      legalOpen: s.legalOpen,
      legalView: !s.legalOpen,
      legalStRow:
        'display:flex;align-items:center;gap:6px;font:400 10px/15px Sora,sans-serif;color:' +
        (s.legalDone ? '#2F7C5A' : '#C0392B'),
      legalStDot:
        'width:6px;height:6px;border-radius:50%;background:' +
        (s.legalDone ? '#2F7C5A' : '#C0392B'),
      legalStText: s.legalDone ? 'заполнено' : 'не заполнено',
      legalOrgV: s.legalDone ? s.legalOrg : '—',
      legalInnV: s.legalDone ? s.legalInn : '—',
      legalAddrV: s.legalDone ? s.legalAddr : '—',
      legalOrgStyle:
        'text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:' +
        (s.legalDone ? '#0E0E0E' : '#B0ADA6'),
      legalInnStyle:
        "text-align:right;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:" +
        (s.legalDone ? '#0E0E0E' : '#B0ADA6'),
      legalAddrStyle:
        'text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:' +
        (s.legalDone ? '#0E0E0E' : '#B0ADA6'),
      legalBtnLabel: s.legalDone ? 'Изменить' : 'Заполнить',
      legalBtnStyle:
        'align-self:flex-start;height:27px;border-radius:9px;display:flex;align-items:center;padding:0 10px;font:600 10.5px/15px Sora,sans-serif;cursor:pointer;' +
        (s.legalDone
          ? 'border:1px solid rgba(14,14,14,.12);color:#0E0E0E;background:#fff'
          : 'background:#0E0E0E;color:#fff'),
      legalEdit: () =>
        this.setState({
          legalOpen: true,
          legalOrg: s.legalOrg || (DEMO ? 'ИП Кочнев Д. А.' : ''),
          legalInn: s.legalInn || (DEMO ? '662345678901' : ''),
          legalAddr: s.legalAddr || (DEMO ? 'Екатеринбург, ул. Мира 32' : ''),
        }),
      legalOrgIn: s.legalOrg,
      legalInnIn: s.legalInn,
      legalAddrIn: s.legalAddr,
      onLegalOrg: (e) => this.set('legalOrg', e.target.value),
      onLegalInn: (e) => this.set('legalInn', e.target.value),
      onLegalAddr: (e) => this.set('legalAddr', e.target.value),
      legalCancel: () => this.set('legalOpen', false),
      legalSaveStyle:
        'height:27px;border-radius:9px;display:flex;align-items:center;padding:0 11px;font:600 10.5px/15px Sora,sans-serif;' +
        ((s.legalOrg || '').trim()
          ? 'background:#0E0E0E;color:#fff;cursor:pointer'
          : 'background:rgba(14,14,14,.12);color:rgba(14,14,14,.4);cursor:default'),
      legalSave: () => {
        if (!(s.legalOrg || '').trim()) return;
        this.setState({ legalOpen: false, legalDone: true }, () => this.persistProfile());
        this.showToast('Юрданные сохранены — составник и навесной ярлык обновлены');
      },
      logoOff: !s.libLogo,
      logoOn: s.libLogo,
      logoNote: s.libLogo
        ? 'logo-mono.svg · лёг на навесной ярлык и титул PDF'
        : 'Ляжет на навесной ярлык и титульную страницу PDF. Лучше монохромный вектор.',
      uploadLogo: () => {
        this.set('libLogo', true);
        this.persistProfile();
        this.showToast('Логотип загружен — обновили ярлык и титул PDF');
      },
      removeLogo: () => {
        this.set('libLogo', false);
        this.persistProfile();
      },
      libFlagDot:
        'width:5px;height:5px;border-radius:50%;background:' +
        (s.legalDone ? '#2F7C5A' : '#C0392B'),
      libFlagLabel: s.legalDone ? 'готово' : 'заполнить',
      careLegalStyle:
        'font:400 6.8px/10px Sora,sans-serif;text-align:center;color:' +
        (s.legalDone ? '#5A5A56' : '#B0ADA6'),
      careLegalText: s.legalDone
        ? (s.legalOrg || '') + ' · ИНН ' + (s.legalInn || '—')
        : '[юрданные не заполнены]',
      tagBrand: s.legalDone
        ? (s.legalOrg || '').replace('ИП ', '').split(' ')[0].toUpperCase()
        : '[БРЕНД]',
      tagBrandStyle:
        'font:700 8px/11px Sora,sans-serif;max-width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;color:' +
        (s.legalDone ? '#0E0E0E' : '#B0ADA6'),
      tagDesc: s.legalDone
        ? 'Размерник — двойная шкала INT/RU. Имя бренда и юрданные подтянуты из библиотеки.'
        : 'Размерник — двойная шкала INT/RU. На навесном ярлыке не хватает имени бренда и юрданных.',
      tagFlagRow:
        'display:flex;align-items:center;gap:7px;font:400 10.5px/15px Sora,sans-serif;color:' +
        (s.legalDone ? '#2F7C5A' : '#C0392B'),
      tagFlagDot:
        'width:7px;height:7px;flex:none;border-radius:50%;background:' +
        (s.legalDone ? '#2F7C5A' : '#C0392B;box-shadow:0 0 0 3px rgba(192,57,43,.16)'),
      tagFlagText: s.legalDone ? 'данные из библиотеки бренда' : 'заполните профиль бренда',
      legalMissing: !s.legalDone,
      careSetLabel: s.careAlt
        ? 'деликатный набор — 30°, ручной отжим'
        : 'типовое значение — можно изменить',
      careBtnLabel: s.careAlt ? 'Вернуть типовые' : 'Изменить символы',
      careSwap: () => {
        this.set('careAlt', !s.careAlt);
        this.showToast(
          s.careAlt
            ? 'Вернули типовые символы ухода'
            : 'Набор заменён на деликатный — обновится в PDF',
        );
      },
      precChip:
        s.scaleShot || (s.manual || '').trim() ? '±1 см активно' : 'сейчас ±2 см · можно улучшить',
      precChipStyle:
        'flex:none;padding:3px 9px;border-radius:999px;font:600 9.5px/13px Sora,sans-serif;' +
        (s.scaleShot || (s.manual || '').trim()
          ? 'background:rgba(228,247,239,.76);border:1px solid rgba(41,117,82,.18);color:#2F7C5A'
          : 'background:rgba(14,14,14,.05);border:1px solid rgba(14,14,14,.08);color:#6B6B67'),
      scaleOff: !s.scaleShot,
      scaleOn: s.scaleShot,
      addScale: () => {
        this.set('scaleShot', true);
        this.showToast(
          DEMO
            ? 'Эталон найден: А4 = 29,7 см — допуск улучшен до ±1 см'
            : 'Хорошо — положите лист А4 в кадр, эталон улучшит допуск до ±1 см',
        );
      },
      manualOk: !!(s.manual || '').trim(),
      cwChips: (bomReal && doc.bom.colorways.length
        ? doc.bom.colorways.map((c) => c.name_ru)
        : s.cwAdded
          ? ['Чёрный', 'Экрю']
          : ['Чёрный']
      ).map((c) => ({
        label: 'Колорвей: ' + c,
        pick: () => {
          this.set('cwSel', c);
          if (bomReal || s.cwAdded)
            this.showToast('Колорвей «' + c + '» — свотчи и Pantone обновлены');
        },
        style:
          'height:25px;border-radius:8px;display:flex;align-items:center;padding:0 10px;font:600 10.5px/15px Sora,sans-serif;cursor:pointer;' +
          ((
            bomReal
              ? (doc.bom.colorways.find((x) => x.name_ru === s.cwSel) || doc.bom.colorways[0] || {})
                  .name_ru === c
              : s.cwSel === c
          )
            ? 'background:#0E0E0E;color:#fff'
            : 'border:1px solid rgba(14,14,14,.12);color:#5A5A56;background:#fff'),
      })),
      cwCanAdd: !bomReal && !s.cwAdded,
      addCw: () => {
        this.setState({ cwAdded: true, cwSel: 'Экрю' });
        this.showToast('Колорвей «Экрю» добавлен — полотно перекрашено, фурнитура общая');
      },
      bomLibOpen: s.bomLibOpen,
      toggleBomLib: () => this.set('bomLibOpen', !s.bomLibOpen),
      libPick: libAllMats.map((m) => ({
        name: m[0],
        spec: m[1],
        sw:
          'width:14px;height:14px;flex:none;border-radius:5px;background:' +
          m[2] +
          ';border:1px solid rgba(14,14,14,.14)',
        add: () => {
          this.setState((p) => ({
            bomExtra: p.bomExtra.concat([
              ['ДОП-0' + (p.bomExtra.length + 1), m[0], m[1], m[2], m[3], 'уточнить', 'user'],
            ]),
            bomLibOpen: false,
          }));
          this.showToast('«' + m[0] + '» добавлен в BOM из библиотеки');
        },
      })),
      goLibFromBom: () => this.setState({ bomLibOpen: false, screen: 'lib', toolMode: null }),
      dlAgain: () => {
        if (TOKEN && s.curId && doc) {
          location.href = PDF_URL(s.curId);
          this.showToast('PDF собирается заново — скачается автоматически');
          return;
        }
        this.showToast('Файл скачан повторно (имитация)');
      },
      gtinInfo: () =>
        this.showToast(
          'GTIN выдаёт ГС1 РУС — сгенерируем номера при первом тираже, гид в базе знаний',
        ),
      upgradePlan: () =>
        this.showToast('Записали в лист ожидания «Студии» — оплата откроется после беты'),
      legalDocs: () => this.showToast('Документ откроется на seamster.pro (имитация)'),
      panelModelName: s.panelAlt ? 'Стандартная точность' : 'Максимальная точность',
      panelModelTime: s.panelAlt ? 'Модель · ~3–4 мин' : 'Модель · ~6–10 мин',
      togglePanelModel: () => this.set('panelAlt', !s.panelAlt),
      twDesc: this.tw(
        doc ? doc.style.description || '—' : 'Жакет на молнии по асимметрии, рибана 2×2',
        0,
      ),
      docLoading: s.docLoading,
      goDoc: () => {
        if (lastJob)
          return lastJob.stage === 'done'
            ? this.openJobDoc(lastJob.id)
            : this.openJobGen(lastJob.id);
        this.openDoc('cover');
      },
      stripStyle:
        s.screen === 'doc' || s.screen === 'wizard'
          ? 'display:none'
          : 'min-height:34px;padding:5px 14px;background:#D9F2E3;border-bottom:1px solid #9FD8B6;display:flex;align-items:center;justify-content:center;gap:8px 10px;flex-wrap:wrap;text-align:center',
      gridStyle:
        'display:grid;grid-template-columns:' +
        (narrow
          ? '0px minmax(0,1fr) 0px'
          : '300px minmax(0,1fr) ' + (s.screen === 'lib' || s.screen === 'plan' ? '0px' : '69px')) +
        ';height:calc(100vh - ' +
        (s.screen === 'doc' || s.screen === 'wizard' ? '0px' : '34px') +
        ');padding-top:' +
        (s.screen === 'doc' || s.screen === 'wizard' ? '10px' : '0px'),
      notifOn: s.notifOpen,
      toggleNotif: () => {
        if (!DEMO || fresh)
          return this.showToast(
            fresh
              ? 'Уведомлений пока нет — они появятся после первой генерации'
              : 'Новых уведомлений нет',
          );
        this.setState({ notifOpen: !s.notifOpen, userMenu: false });
      },
      closeNotif: () => this.set('notifOpen', false),
      notifCalc: () => {
        if (lastJob && lastJob.stage === 'done') {
          this.setState({ notifOpen: false, calcOpen: true });
          this.openJobDoc(lastJob.id, 'export');
          return;
        }
        this.setState({
          notifOpen: false,
          screen: 'doc',
          section: 'export',
          calcOpen: true,
          docLoading: false,
        });
      },
      notifPom: () => {
        if (lastJob && lastJob.stage === 'done') {
          this.setState({ notifOpen: false, onlyGuess: true });
          this.openJobDoc(lastJob.id, 'pom');
          return;
        }
        this.setState({
          notifOpen: false,
          onlyGuess: true,
          screen: 'doc',
          section: 'pom',
          docLoading: false,
        });
      },
      docMenuOn: s.docMenu,
      toggleDocMenu: () => this.setState({ docMenu: !s.docMenu, exportOpen: false }),
      dmRename: () => {
        this.set('docMenu', false);
        this.showToast('Название можно править прямо в шапке — кликните по нему');
      },
      dmDup: () => {
        this.set('docMenu', false);
        if (TOKEN && s.curId) {
          apiCall('/jobs/' + s.curId + '/duplicate', { method: 'POST' })
            .then(() => {
              this.refreshJobs();
              this.showToast('Копия создана — «' + docNameVal + ' (2)», черновик');
            })
            .catch((e) => this.showToast('Не удалось: ' + e.message));
          return;
        }
        this.showToast('Копия создана — «Структурный жакет (2)», черновик');
      },
      dmVers: () => this.setState({ docMenu: false, section: 'vers' }),
      dmDel: () => {
        this.set('docMenu', false);
        if (TOKEN && s.curId) {
          const id = s.curId;
          clearTimeout(this._delT[id]);
          this._delT[id] = setTimeout(() => {
            apiCall('/jobs/' + id, { method: 'DELETE' })
              .then(() => this.refreshJobs())
              .catch(() => {});
          }, 4200);
          this.setState({ screen: 'home' });
          this.showToast('Пак перемещён в корзину — 30 дней на восстановление', {
            label: 'Отменить',
            fn: () => {
              clearTimeout(this._delT[id]);
              this.showToast('Восстановлено');
            },
          });
          return;
        }
        this.showToast('Пак перемещён в корзину — 30 дней на восстановление', {
          label: 'Отменить',
          fn: () => this.showToast('Восстановлено'),
        });
      },
      packMenuOn: !!s.packMenu,
      packMenuStyle: s.packMenu
        ? 'position:fixed;left:' +
          Math.min(s.packMenu.x, 260) +
          'px;top:' +
          s.packMenu.y +
          'px;z-index:30;width:172px;border-radius:12px;background:#fff;border:1px solid rgba(14,14,14,.1);box-shadow:0 18px 44px rgba(0,0,0,.18);padding:6px;animation:sfup .14s ease'
        : 'display:none',
      closePackMenu: () => this.set('packMenu', null),
      pmRename: () => {
        this.set('packMenu', null);
        this.showToast('Переименование — в шапке документа');
      },
      pmDup: () => {
        const pm = s.packMenu;
        this.set('packMenu', null);
        if (TOKEN && pm && pm.id) {
          apiCall('/jobs/' + pm.id + '/duplicate', { method: 'POST' })
            .then(() => {
              this.refreshJobs();
              this.showToast('Копия создана — появится в списке');
            })
            .catch((e) => this.showToast('Не удалось: ' + e.message));
          return;
        }
        this.showToast('Копия создана — появится в списке после генерации');
      },
      pmDel: () => {
        const pm = s.packMenu;
        const key = (pm && pm.id) || (pm && pm.i);
        this.setState((p) => ({ packMenu: null, deleted: { ...p.deleted, [key]: true } }));
        if (TOKEN && pm && pm.id) {
          clearTimeout(this._delT[pm.id]);
          this._delT[pm.id] = setTimeout(() => {
            apiCall('/jobs/' + pm.id, { method: 'DELETE' })
              .then(() => this.refreshJobs())
              .catch(() => {});
          }, 4200);
        }
        this.showToast('Пак удалён', {
          label: 'Отменить',
          fn: () => {
            if (pm && pm.id) clearTimeout(this._delT[pm.id]);
            this.setState((p) => {
              const d = { ...p.deleted };
              delete d[key];
              return { deleted: d };
            });
          },
        });
      },
      toastActOn: !!s.toastAct,
      toastActLabel: s.toastAct ? s.toastAct.label : '',
      toastActGo: () => {
        const f = s.toastAct && s.toastAct.fn;
        this.setState({ toast: null, toastAct: null });
        if (f) f();
      },
      readyPct: this.readyData(guessCount).pct,
      readyBarStyle:
        'display:block;height:100%;border-radius:99px;background:#0E0E0E;width:' +
        this.readyData(guessCount).pct,
      readyItems: this.readyData(guessCount).items.map((it, i) => ({
        name: it[0],
        sub: it[1],
        dotStyle:
          'width:16px;height:16px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-top:1px;' +
          (it[2] === 'ok'
            ? 'background:rgba(47,124,90,.12)'
            : it[2] === 'warn'
              ? 'background:rgba(192,57,43,.1)'
              : 'background:rgba(14,14,14,.06)') +
          ';box-shadow:inset 0 0 0 4.5px ' +
          (it[2] === 'ok' ? '#2F7C5A' : it[2] === 'warn' ? '#C0392B' : '#B0ADA6') +
          '00;background:' +
          (it[2] === 'ok' ? '#2F7C5A' : it[2] === 'warn' ? '#C0392B' : '#B0ADA6'),
        style:
          'display:flex;gap:8px;align-items:flex-start;padding:10px 13px;cursor:pointer;' +
          (i % 3 < 2 ? 'border-right:1px solid #EFEDE9;' : '') +
          (i < 3 ? 'border-bottom:1px solid #EFEDE9' : ''),
        go: () => {
          const t = it[3];
          if (t === 'pom') this.setState({ section: 'pom', onlyGuess: true });
          else if (t === 'lib') this.setState({ screen: 'lib' });
          else if (t === 'labels') this.setState({ section: 'labels' });
          else if (t === 'flats') this.setState({ section: 'flats' });
        },
      })),
      refCountLabel: 'Референсы ' + s.refFiles.length + ' / 4',
      refChips: s.refFiles.map((f, i) => ({
        name: f,
        bg:
          'width:22px;height:22px;flex:none;border-radius:6px;border:1px solid #E4E1DC;background:' +
          (s.wshots && s.wshots[i] ? 'url(' + s.wshots[i][0] + ')' : 'url(assets/flat-main.png)') +
          ' 50% 50%/cover no-repeat',
        del: (e) => {
          e.stopPropagation();
          if (!DEMO) this._files.splice(i, 1);
          this.setState((p) => ({
            refFiles: p.refFiles.filter((_, j) => j !== i),
            ...(!DEMO ? { wshots: (p.wshots || []).filter((_, j) => j !== i) } : {}),
          }));
        },
      })),
      addRef: () => {
        if (!DEMO) {
          if (s.refFiles.length >= 4) return this.showToast('Максимум 4 референса');
          this.pickFiles(true);
          return;
        }
        if (s.refFiles.length >= 4) return this.showToast('Максимум 4 референса');
        this.setState((p) => ({
          refFiles: [
            ...p.refFiles,
            ['photo-front.jpg', 'photo-back.jpg', 'detail-zip.jpg', 'sketch.png'][
              p.refFiles.length
            ],
          ],
        }));
      },
      addDraw: () => this.set('drawFile', !s.drawFile),
      addFit: () => this.set('fitFile', !s.fitFile),
      drawZoneStyle:
        'border-radius:12px;border:1px ' +
        (s.drawFile
          ? 'solid rgba(47,124,90,.4);background:rgba(228,247,239,.35)'
          : 'dashed rgba(14,14,14,.22)') +
        ';padding:22px 14px;display:flex;flex-direction:column;align-items:center;gap:7px;cursor:pointer',
      drawZoneLabel: s.drawFile ? 'photo-front.jpg загружено ✓' : 'Одно фото анфас',
      fitZoneStyle:
        'border-radius:12px;border:1px ' +
        (s.fitFile
          ? 'solid rgba(47,124,90,.4);background:rgba(228,247,239,.35)'
          : 'dashed rgba(14,14,14,.22)') +
        ';padding:22px 14px;display:flex;flex-direction:column;align-items:center;gap:7px;cursor:pointer',
      fitZoneLabel: s.fitFile ? 'model-full.jpg загружено ✓' : 'Фото модели в полный рост',
      dashNoRes: !s.dashEmpty && dashCards.length === 0,
      dashReset: () => this.setState({ dashQ: '', dashFilter: 'Все' }),
      calcOpen: s.calcOpen,
      // В прототипе этот список тоже назывался fabRows и затирался списком
      // вида фабрики ниже — диалог просчёта рендерился с пустыми полями.
      // Здесь у него своё имя, разметка диалога указывает на него.
      fabsList: [
        ['f1', 'Швейный цех №3, Иваново', 'трикотаж · свой раскрой', 'от 50 ед'],
        ['f2', 'Meridian Textile, Бишкек', 'полный цикл · дешевле на объёме', 'от 300 ед'],
        ['f3', 'TexLine, Челябинск', 'трикотаж и ткань · быстрый образец', 'от 100 ед'],
      ].map(([id, name, sub, terms]) => ({
        name,
        sub,
        terms,
        style:
          'display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:10px;cursor:pointer;background:#fff;border:1px solid ' +
          (s.fabs[id] ? 'rgba(47,124,90,.35)' : '#E4E1DC'),
        boxStyle:
          'width:17px;height:17px;flex:none;border-radius:6px;display:flex;align-items:center;justify-content:center;' +
          (s.fabs[id]
            ? 'background:#1F8A4C'
            : 'background:#fff;border:1px solid rgba(14,14,14,.2)'),
        go: () => this.setState((p) => ({ fabs: { ...p.fabs, [id]: !p.fabs[id] } })),
      })),
      sendCalcLabel: 'Отправить ' + Object.values(s.fabs).filter(Boolean).length + ' фабрикам',
      sendCalc: () => {
        this.setState({ calcOpen: false, onCalc: true });
        this.showToast(
          'Пак у ' +
            Object.values(s.fabs).filter(Boolean).length +
            ' фабрик — ответ обычно за 2–3 дня',
        );
      },
      langChips: ['Русский', 'English', '中文'].map((l) => ({
        label: l,
        style:
          'padding:5px 9px;border-radius:8px;cursor:pointer;font:600 10px/14px Sora,sans-serif;' +
          (s.pdfLang === l
            ? 'background:#0E0E0E;color:#fff'
            : 'background:#fff;border:1px solid rgba(14,14,14,.12);color:#5A5A56'),
        go: () => this.set('pdfLang', l),
      })),
      qtyHint:
        {
          50: 'малый тираж: фурнитуру берём из розничных партий — дороже на единицу',
          100: 'при 100 ед: молния — партия от 100 м, материалы ≈ 1 240 ₽/ед',
          300: '300 ед: оптовые цены полотна, −12% к материалам',
          '500+': 'от 500 ед: имеет смысл просчёт у 2–3 фабрик сразу',
        }[s.picks.qty] || 'влияет на подсказки по закупке',
      goHome: () => this.setState({ screen: 'home', toolMode: null, userMenu: false }),
      heroNew: () => this.set('toolMode', 'new'),
      heroDraw: () => this.set('toolMode', 'draw'),
      heroRender: () => this.set('toolMode', 'render'),
      heroPrint: () => this.set('toolMode', 'print'),
      heroFit: () => this.set('toolMode', 'fit'),
      userMenuOn: s.userMenu,
      toggleUserMenu: () => this.set('userMenu', !s.userMenu),
      closeUserMenu: () => this.set('userMenu', false),
      goPlanMenu: () => this.setState({ screen: 'plan', userMenu: false, toolMode: null }),
      signOut: () => {
        if (TOKEN) {
          try {
            sessionStorage.removeItem('seamsterly_invite');
          } catch {
            /* приватный режим */
          }
          location.href = '/app/';
          return;
        }
        if (!DEMO) return this.showToast('Вы гость — вход по инвайт-ссылке');
        this.setState({ screen: 'auth', userMenu: false, toolMode: null, authStep: 'email' });
      },
      userChevStyle:
        'transition:transform .16s ease;transform:rotate(' + (s.userMenu ? 180 : 0) + 'deg)',
      userEmail: s.me
        ? s.me.name + (s.me.org ? ' · ' + s.me.org : '')
        : DEMO
          ? 'danilkochneff652@gmail.com'
          : 'Гость · вход по инвайт-ссылке',
      passVal: s.pass,
      onPass: (e) => this.set('pass', e.target.value),
      signIn: () => {
        if (!DEMO) return this.showToast('Публичного входа нет — вход по инвайт-ссылке');
        this.setState({ screen: 'home', fresh: false });
        this.showToast('С возвращением — продолжим с того же места');
      },
      yandexIn: () => {
        if (!DEMO) return this.showToast('Публичного входа нет — вход по инвайт-ссылке');
        this.setState({ screen: 'home', fresh: false });
        this.showToast('Вход через Яндекс ID выполнен');
      },
      forgotPw: () => this.showToast('Отправили ссылку для сброса — проверьте почту'),
      signUpT: () => {
        if (!DEMO) return this.showToast('Публичного входа нет — вход по инвайт-ссылке');
        this.setState({
          screen: 'home',
          fresh: true,
          dashEmpty: true,
          sideOpen: false,
          toolMode: null,
        });
        this.showToast('Аккаунт создан — 3 генерации в месяц бесплатно');
      },
      goLib: () => this.setState({ screen: 'lib', toolMode: null }),
      goPlan: () => this.setState({ screen: 'plan', toolMode: null }),
      libRowStyle:
        'display:flex;align-items:center;gap:9px;padding:11px 10px;border-radius:12px;cursor:pointer;' +
        (s.screen === 'lib' ? 'background:rgba(14,14,14,.055)' : ''),
      planRowStyle:
        'display:flex;align-items:center;gap:9px;padding:11px 10px;border-radius:12px;cursor:pointer;' +
        (s.screen === 'plan' ? 'background:rgba(14,14,14,.055)' : ''),
      secLabels: s.screen === 'doc' && !s.docLoading && s.section === 'labels',
      secVers: s.screen === 'doc' && !s.docLoading && s.section === 'vers',
      skuRows: (doc && doc.base && (doc.base.size_range || []).length
        ? doc.base.size_range.map((ru) => INT_OF(ru, bru))
        : ['XS', 'S', 'M', 'L', 'XL']
      ).map((size) => ({ sku: artShortVal + '-BLK-' + size, size })),
      fitRows: FIT.map(([code, name, spec, tol, def]) => {
        const raw = s.fitVals[code] !== undefined ? s.fitVals[code] : def;
        const fact = parseFloat(String(raw).replace(',', '.'));
        const d = isNaN(fact) ? null : fact - spec;
        const ok = d !== null && Math.abs(d) <= tol + 1e-9;
        return {
          code,
          name,
          spec: spec.toFixed(1).replace('.', ','),
          fact: raw,
          onFact: (e) => {
            const v = e.target.value;
            this.setState((p) => ({ fitVals: { ...p.fitVals, [code]: v } }));
          },
          delta: d === null ? '—' : (d > 0 ? '+' : '') + d.toFixed(1).replace('.', ','),
          deltaStyle:
            "padding:0 11px;font:500 10px/1 'JetBrains Mono',monospace;text-align:right;color:" +
            (d === null ? '#B0ADA6' : ok ? '#5A5A56' : '#C0392B'),
          ok: d === null ? '—' : ok ? 'да' : 'нет',
          okStyle:
            'display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;font:700 9px/11px Sora,sans-serif;letter-spacing:.4px;text-transform:uppercase;' +
            (d === null || ok
              ? 'background:rgba(228,247,239,.76);border:1px solid rgba(41,117,82,.18);color:#2F7C5A'
              : 'background:rgba(192,57,43,.07);border:1px solid rgba(192,57,43,.2);color:#C0392B'),
        };
      }),
      applyFit: () => {
        if (TOKEN && s.curId && doc) {
          const edits = Object.entries(s.fitVals)
            .map(([code, v]) => ({ code, n: parseFloat(String(v).replace(',', '.')) }))
            .filter((x) => isFinite(x.n));
          if (edits.length) {
            (async () => {
              try {
                let p = null;
                for (const e of edits) {
                  p = await apiCall('/jobs/' + s.curId + '/measurements', {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ code: e.code, value_cm: e.n }),
                  });
                }
                if (p) {
                  this._specs[s.curId] = { spec: p.spec, flat_defaults: p.flat_defaults };
                  delete this._thumbs[s.curId];
                  this.setState({ curSpec: p.spec, curDefaults: p.flat_defaults, fitVals: {} });
                }
                this.showToast('Факты примерки применены — замеры и чертёж обновлены');
              } catch (e2) {
                this.showToast('Не применилось: ' + e2.message);
              }
            })();
          }
          this.setState({ screen: 'doc', section: 'pom' });
          return;
        }
        this.setState({ screen: 'doc', section: 'pom' });
        this.showToast('Версия v1.1 создана из фактов примерки — открыты замеры');
      },
      unitLabel: s.unit,
      baseHdr: 'База ' + INT_OF(bru, bru) + ' · ' + s.unit,
      unitChips: ['см', 'in'].map((u) => ({
        label: u,
        go: () => {
          if (u !== s.unit) {
            this.set('unit', u);
            this.showToast(
              u === 'in'
                ? 'Показываем в дюймах — храним и экспортируем в сантиметрах'
                : 'Показываем в сантиметрах',
            );
          }
        },
        style:
          'height:21px;display:inline-flex;align-items:center;padding:0 8px;border-radius:6px;cursor:pointer;font:600 10px/14px Sora,sans-serif;' +
          (s.unit === u ? 'background:#0E0E0E;color:#fff' : 'color:#6B6B67'),
      })),
      selWarnOn: !!selWarn,
      selWarnText: selWarn
        ? 'Вне типового диапазона ' +
          selWarn[0] +
          '–' +
          selWarn[1] +
          ' см. Проверьте единицы: возможно, введён полный обхват вместо половины.'
        : '',
      selHist: (selRow
        ? [
            {
              t: curJob ? fmtDay(curJob.created_at) : '16.07',
              txt: HIST_SRC[selRow[10]] + ' → ' + selRow[3] + ' см',
            },
          ]
        : []
      ).concat(s.sel ? s.history[s.sel] || [] : []),
      diffRows,
      diffHas: diffRows.length > 0,
      diffNone: diffRows.length === 0,
      diffCount: diffRows.length ? diffRows.length + ' изм.' : 'нет изменений',
      copyShare: () => {
        if (TOKEN && s.curId && s.shareTok) {
          try {
            navigator.clipboard.writeText('https://' + location.host + '/p/' + s.shareTok);
          } catch {
            /* без клипборда ссылка остаётся видимой текстом рядом */
          }
          track('share_copy', { id: s.curId });
        }
        this.showToast('Ссылка скопирована — фабрика откроет без аккаунта');
      },
      openFab: () => this.setState({ fabView: true, docMenu: false, exportOpen: false }),
      dmFab: () => this.setState({ fabView: true, docMenu: false }),
      fabClose: () => this.setState({ fabView: false, fabQOpen: null }),
      fabOn: s.fabView,
      fabT: FTL,
      fabRows,
      fabLangChips: ['RU', 'EN', 'CN'].map((l) => ({
        label: l === 'CN' ? '中文' : l,
        go: () => this.set('fabLang', l),
        style:
          'height:23px;display:inline-flex;align-items:center;padding:0 9px;border-radius:7px;cursor:pointer;font:600 10px/14px Sora,sans-serif;' +
          (s.fabLang === l
            ? 'background:#0E0E0E;color:#fff'
            : 'background:#fff;border:1px solid rgba(14,14,14,.12);color:#6B6B67'),
      })),
      fabQText: s.fabQText,
      onFabQ: (e) => this.set('fabQText', e.target.value),
      wizModeTabs: [
        ['photo', 'С фото или эскиза'],
        ['import', 'Импорт PDF · Excel'],
      ].map(([id, label]) => ({
        label,
        go: () => this.set('wizMode', id),
        style:
          'height:31px;display:inline-flex;align-items:center;padding:0 13px;border-radius:9px;cursor:pointer;font:600 11px/16px Sora,sans-serif;' +
          (s.wizMode === id
            ? 'background:#0E0E0E;color:#fff'
            : 'background:#fff;border:1px solid rgba(14,14,14,.12);color:#5A5A56'),
      })),
      wizPhoto: s.wizMode === 'photo',
      wizImport: s.wizMode === 'import',
      impEmpty: !s.impFile,
      impDone: s.impFile,
      impDrop: () => {
        this.set('impFile', true);
        this.showToast('Файл разобран — проверьте, что распознали');
      },
      impClear: () => this.set('impFile', false),
      impRows: [
        ['Категория и описание', 'жакет · трикотаж', 'ok'],
        ['Замеры POM', '10 точек · база M', 'ok'],
        ['Материалы (BOM)', '9 позиций, 2 без Pantone', 'warn'],
        ['Чертёж', 'векторный, 3 вида', 'ok'],
        ['Градация', 'не найдена — построим от базы M', 'warn'],
      ].map(([name, note, st]) => ({
        name,
        note,
        dotStyle:
          'width:9px;height:9px;flex:none;border-radius:50%;background:' +
          (st === 'ok' ? '#2F7C5A' : '#C0392B') +
          (st === 'warn' ? ';box-shadow:0 0 0 3px rgba(192,57,43,.14)' : ''),
      })),
      heroImport: () =>
        this.setState({
          screen: 'wizard',
          wizStep: 1,
          wizMode: 'import',
          impFile: false,
          baseFrom: null,
        }),
      baseFromOn: !!s.baseFrom,
      baseFromName: s.baseFrom || '',
      pmBase: () => {
        const nm =
          (s.packMenu && s.packMenu.name) ||
          packNames[s.packMenu ? s.packMenu.i : 0] ||
          'Структурный жакет';
        this.setState({
          packMenu: null,
          screen: 'wizard',
          wizStep: 2,
          wizMode: 'photo',
          baseFrom: nm,
        });
        this.showToast('Размерная сетка и BOM перенесены из «' + nm + '»');
      },
      isWork: s.screen === 'doc' || s.screen === 'wizard',
      isDocScreen: s.screen === 'doc',
      goDash: () => this.setState({ screen: 'dash', toolMode: null }),
      goAuth: () => {
        if (!DEMO) return this.showToast('Публичного входа нет — вход по инвайт-ссылке');
        this.setState({
          screen: 'auth',
          authStep: 'email',
          code: '',
          codeErr: false,
          toolMode: null,
        });
      },
      authEmail: s.authStep === 'email',
      authCode: s.authStep === 'code',
      emailVal: s.email,
      onEmail: (e) => this.set('email', e.target.value),
      sendCode: () =>
        DEMO
          ? this.set('authStep', 'code')
          : this.showToast('Публичного входа нет — вход по инвайт-ссылке'),
      codeVal: s.code,
      onCode: (e) => this.setState({ code: e.target.value, codeErr: false }),
      codeInputStyle:
        'width:100%;padding:12px 14px;border-radius:11px;border:1px solid ' +
        (s.codeErr ? '#C0392B' : 'rgba(14,14,14,.14)') +
        ";background:#FAF9F7;font:500 18px/24px 'JetBrains Mono',monospace;letter-spacing:.32em;text-align:center",
      codeErr: s.codeErr,
      enterCode: () => {
        if (/^\d{6}$/.test(s.code.trim())) {
          this.setState({ screen: 'dash', dashEmpty: true, authStep: 'email', code: '' });
          this.showToast('Вы вошли — начнём с первого техпака');
        } else this.set('codeErr', true);
      },
      backEmail: () => this.setState({ authStep: 'email', code: '', codeErr: false }),
      skipAuth: () => this.setState({ screen: 'home' }),
      dashEmpty: jobsLive ? fresh : DEMO ? s.dashEmpty : true,
      dashFull: jobsLive ? !fresh : DEMO ? !s.dashEmpty : false,
      toggleDashEmpty: () => DEMO && this.set('dashEmpty', !s.dashEmpty),
      dashToggleLabel: !DEMO ? '' : s.dashEmpty ? 'показать с паками' : 'показать пустое состояние',
      fillDash: () => DEMO && this.setState({ dashEmpty: false, fresh: false }),
      dashQ: s.dashQ,
      onDashQ: (e) => this.set('dashQ', e.target.value),
      dashCount: jobsLive
        ? s.jobs.length +
          ' ' +
          plural(s.jobs.length, 'пак', 'пака', 'паков') +
          ' · ' +
          s.jobs.filter((j) => j.stage === 'done').length +
          ' готовы'
        : DEMO
          ? '3 пака · 2 готовы'
          : '',
      dashFilters,
      dashCards,
      t1Style: toolBtn('new'),
      t2Style: toolBtn('draw'),
      t3Style: toolBtn('render'),
      t4Style: toolBtn('print'),
      t5Style: toolBtn('fit'),
      t1Go: toolGo('new'),
      t2Go: toolGo('draw'),
      t3Go: toolGo('render'),
      t4Go: toolGo('print'),
      t5Go: toolGo('fit'),
      toolOpen: !!tmv,
      toolTitle: tmv ? tmv.title : '',
      toolKicker: tmv ? tmv.kicker : '',
      toolHead: tmv ? tmv.head : '',
      toolDesc: tmv ? tmv.desc : '',
      tmNew: s.toolMode === 'new',
      tmDraw: s.toolMode === 'draw',
      tmRender: s.toolMode === 'render',
      tmPrint: s.toolMode === 'print',
      tmFit: s.toolMode === 'fit',
      toolCta: s.toolBusy !== null ? 'Генерируем…' : tmv ? tmv.cta : '',
      toolCredit: s.toolBusy !== null ? (s.toolBusy || 0) + '%' : tmv ? tmv.credit : '',
      toolHintOn: !!(tmv && !tmv.on && tmv.hint),
      toolHint: tmv ? tmv.hint : '',
      toolCtaStyle:
        'height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;gap:8px;font:600 12px/17px Sora,sans-serif;' +
        (tmv && tmv.on
          ? 'background:#0E0E0E;color:#fff;cursor:pointer'
          : 'background:rgba(14,14,14,.12);color:rgba(14,14,14,.4);cursor:default'),
      toolCtaGo: () => {
        if (!tmv || !tmv.on || s.toolBusy !== null) return;
        if (s.toolMode === 'new') {
          if (TOKEN || !DEMO) {
            this.setState({ toolMode: null, screen: 'wizard', wizStep: 2, wizMode: 'photo' });
            return;
          }
          this.setState({ toolMode: null, screen: 'gen' });
          this.startGen();
          return;
        }
        if (s.toolMode === 'draw') {
          if (TOKEN || !DEMO) {
            this.setState({
              toolMode: null,
              drawFile: false,
              screen: 'wizard',
              wizStep: 1,
              wizMode: 'photo',
            });
            this.showToast('Соберём полный пак — чертёж будет внутри');
            return;
          }
          this.setState({ toolMode: null, drawFile: false });
          this.openDoc('flats');
          this.showToast('Чертёж построен — 3 вида, бесплатно');
          return;
        }
        if (!DEMO) {
          this.showToast(tmv.title + ' появится после беты — сначала соберём полный техпак');
          return;
        }
        this.startToolRun(s.toolMode);
      },
      toolBusyOn: s.toolBusy !== null,
      toolBusyPct: (s.toolBusy || 0) + '%',
      toolBusyLabel:
        { render: 'Собираем 3D-рендер…', print: 'Генерируем принт…', fit: 'Считаем посадку…' }[
          s.toolMode
        ] || 'Генерация…',
      toolBusyBar:
        'display:block;height:100%;border-radius:99px;background:#0E0E0E;transition:width .24s ease;width:' +
        (s.toolBusy || 0) +
        '%',
      toolResOn: !!s.toolResult && s.toolResult === s.toolMode && s.toolBusy === null,
      toolResTitle:
        {
          render: '3D-рендер · 3 ракурса',
          print: 'Принт · раскладка',
          fit: 'Примерка · RU 46 / M',
        }[s.toolResult] || '',
      toolResNote:
        {
          render: 'Материал из BOM: рибана 2×2, 240 г/м². Черновик для проверки силуэта.',
          print: 'Файл 300 DPI с раскладкой по зоне — добавьте в галерею пака.',
          fit: 'Натяжение по груди в норме, длина рукава на границе допуска (−0,8 см).',
        }[s.toolResult] || '',
      toolResShots: (s.toolResult === 'render'
        ? [
            ['background:url(assets/thumb.jpg) 50% 18%/cover no-repeat', 'перед'],
            ['background:url(assets/thumb.jpg) 50% 50%/cover no-repeat', '¾'],
            ['background:url(assets/thumb.jpg) 50% 82%/cover no-repeat', 'спинка'],
          ]
        : s.toolResult === 'fit'
          ? [
              ['background:url(assets/flat-main.png) 50% 28%/cover no-repeat', 'на модели'],
              ['background:url(assets/flat-main.png) 50% 65%/cover no-repeat', 'деталь'],
            ]
          : s.toolResult === 'print'
            ? [
                [
                  'background-color:#F4F2EF;background-image:repeating-linear-gradient(45deg,#0E0E0E 0 1.6px,transparent 1.6px 9px)',
                  'растр 45°',
                ],
                [
                  'background-color:#F4F2EF;background-image:repeating-radial-gradient(circle at 30% 30%,#0E0E0E 0 1.4px,transparent 1.4px 9px)',
                  'точка',
                ],
              ]
            : []
      ).map(([st, label]) => ({
        label,
        bg: 'display:block;height:64px;border-radius:8px;border:1px solid #E4E1DC;' + st,
      })),
      toolResToGal: () => {
        const k = s.toolResult;
        this.setState((p) => ({
          galExtra: p.galExtra.indexOf(k) < 0 ? [...p.galExtra, k] : p.galExtra,
          gal: k,
          toolMode: null,
          toolResult: null,
        }));
        this.openDoc('cover');
        this.showToast(
          'Добавлено в галерею пака — вкладка «' +
            ({ render: '3D-рендер', print: 'Принт', fit: 'Примерка' }[k] || '') +
            '»',
        );
      },
      toolResDl: () =>
        this.showToast(
          'Скачан ' +
            ({ render: 'render', print: 'print', fit: 'fitting' }[s.toolResult] || 'result') +
            '-' +
            artShortVal +
            '.png',
        ),
      toolSecOn: !!(tmv && tmv.sec),
      toolManual: () =>
        this.setState({
          toolMode: null,
          screen: 'wizard',
          wizStep: 1,
          genDone: false,
          genErr: false,
        }),
      closeTool: () => {
        clearInterval(this._tb);
        this.setState({ toolMode: null, toolBusy: null, toolResult: null });
      },
      printTextVal: s.printText,
      onPrintText: (e) => this.set('printText', e.target.value),
      renderChips,
      placeChips,
      fitChips,
      roleChips,
      refreshPdf: () => this.showToast('Превью PDF пересобрано по текущим данным'),
      downloadPdf: () => {
        if (TOKEN && s.curId && doc) {
          const loc = { English: 'en', 中文: 'zh' }[s.pdfLang] || '';
          location.href = PDF_URL(s.curId) + (loc ? '&locale=' + loc : '');
          track('pdf_click', { id: s.curId, locale: loc || 'ru' });
          this.showToast('Собираем PDF — скачается автоматически');
          return;
        }
        this.showToast(
          'Скачан seamsterly-' +
            artShortVal +
            '-' +
            (s.pdfLang === 'Русский' ? 'ru' : s.pdfLang === 'English' ? 'en' : 'zh') +
            '.pdf · роли: ' +
            Object.keys(s.roles)
              .filter((k) => s.roles[k])
              .join(', '),
        );
      },
      tipOn: !!s.tip,
      tipText: s.tip ? s.tip.text : '',
      tipStyle: s.tip
        ? 'position:fixed;left:' +
          s.tip.x +
          'px;top:' +
          (s.tip.y - 8) +
          'px;transform:translate(-50%,-100%);z-index:50;max-width:240px;background:#0E0E0E;color:#fff;border-radius:9px;padding:7px 10px;font:400 10.5px/15px Sora,sans-serif;pointer-events:none;box-shadow:0 12px 30px rgba(0,0,0,.25);text-wrap:pretty'
        : 'display:none',
      tipLeave: () => this.set('tip', null),
      toastOn: !!s.toast,
      toastText: s.toast || '',
      toWizard: () =>
        this.setState({
          screen: 'wizard',
          wizStep: 1,
          genDone: false,
          genErr: false,
          wizMode: 'photo',
          impFile: false,
          baseFrom: null,
        }),
      wiz1: s.wizStep === 1,
      wiz2: s.wizStep === 2,
      wizTitle:
        s.wizStep === 1
          ? s.wizMode === 'import'
            ? 'Импорт готового техпака'
            : 'Фото или эскиз'
          : 'Пять вопросов простыми словами',
      wizStepLabel: 'шаг ' + s.wizStep + ' из 2',
      wizBarStyle:
        'height:3px;background:#0E0E0E;transition:width .25s ease;width:' + s.wizStep * 50 + '%',
      wizClose: () =>
        s.wizStep === 1 ? this.set('screen', 'home') : this.set('closeConfirm', true),
      closeConfirm: s.closeConfirm,
      wizExit: () => {
        clearInterval(this._g);
        this.setState({ closeConfirm: false, screen: 'home' });
        this.showToast('Черновик сохранён в «Одиночных паках»');
      },
      wizStay: () => this.set('closeConfirm', false),
      precOpen: s.precOpen,
      togglePrec: () => this.set('precOpen', !s.precOpen),
      precChevStyle:
        'transition:transform .16s ease;transform:rotate(' + (s.precOpen ? 90 : 0) + 'deg)',
      manualVal: s.manual,
      onManual: (e) => this.set('manual', e.target.value),
      genErr: s.genErr,
      genDone: s.genDone,
      genSpin: !s.genDone,
      genPct: s.genDone ? '100%' : Math.round((s.genStep / 5) * 100) + '%',
      genRetry: () => {
        if (TOKEN) {
          if (this._files.length) return this.launchGeneration();
          this.setState({ screen: 'wizard', wizStep: 1, wizMode: 'photo', genErr: false });
          this.showToast('Создайте генерацию заново — добавьте фото ещё раз, лимит не списан');
          return;
        }
        this.startGen();
      },
      wizBack: () =>
        s.wizStep === 1 ? this.set('screen', 'home') : this.set('wizStep', s.wizStep - 1),
      wizCta:
        s.wizStep === 2
          ? 'Запустить генерацию'
          : s.wizMode === 'import'
            ? 'Создать пак из импорта'
            : 'Дальше',
      wizCtaStyle:
        'height:33px;border-radius:10px;display:flex;align-items:center;gap:7px;padding:0 16px;font:600 11.5px/17px Sora,sans-serif;' +
        (wizCtaOn
          ? 'background:#0E0E0E;color:#fff;cursor:pointer'
          : 'background:rgba(14,14,14,.12);color:rgba(14,14,14,.4);cursor:default'),
      wizNext: () => {
        if (s.wizStep === 1) {
          if (s.wizMode === 'import') {
            if (!s.impFile) {
              this.showToast('Сначала добавьте файл техпака — PDF или Excel');
              return;
            }
            this.openDoc('cover');
            this.showToast(
              'Импортировано: 10 замеров, BOM 9 позиций — 2 места отмечены как предположения',
            );
            return;
          }
          if (TOKEN && !(s.wshots || []).length) {
            this.showToast('Добавьте хотя бы одно фото изделия');
            return;
          }
          return this.set('wizStep', 2);
        }
        if (s.wizStep === 2) {
          if (TOKEN) {
            this.launchGeneration();
            return;
          }
          if (!DEMO) return this.showToast('Запуск генерации — по инвайт-ссылке');
          this.setState({ screen: 'gen' });
          return this.startGen();
        }
      },
      // --- проводка: данные документа в статических местах разметки ---
      docName: docNameVal,
      docArt: docArtVal,
      artShort: artShortVal,
      docUpdated: docUpdatedVal,
      shareLink: doc
        ? s.shareTok
          ? location.host + '/p/' + s.shareTok
          : 'готовим ссылку…'
        : 'seamster.pro/p/' + artShortVal + '-123E',
      coverBrand: doc ? doc.style.brand || 'не указан' : 'не указан',
      coverBrandStyle:
        'font:300 12px/18px Inter,sans-serif;color:' +
        (doc && doc.style.brand ? '#C0392B' : '#B0ADA6'),
      coverFabric: (() => {
        if (!doc || !doc.bom) return 'Рибана 2×2';
        const shell = doc.bom.lines.find((l) => l.role === 'shell');
        return shell ? shell.name_ru : '—';
      })(),
      coverDate:
        curJob && curJob.created_at ? String(curJob.created_at).slice(0, 10) : '2026-07-16',
      coverSeason: doc ? doc.style.season || 'не указан' : 'не указан',
      coverSeasonStyle:
        'font:300 12px/18px Inter,sans-serif;color:' +
        (doc && doc.style.season ? '#C0392B' : '#B0ADA6'),
      coverSize: doc ? 'RU ' + bru + ' / ' + INT_OF(bru, bru) : 'RU 46 / M',
      contOn: jobsLive ? !!lastJob : !fresh,
      contThumb:
        'width:34px;height:34px;flex:none;border-radius:9px;overflow:hidden;border:1px solid #E4E1DC;background:' +
        (lastJob && this.thumbUrl(lastJob.id)
          ? this.thumbUrl(lastJob.id) + ' 50% 50%/contain no-repeat,#fff'
          : 'url(assets/thumb.jpg) 50% 50%/cover no-repeat'),
      contName: (lastJob ? lastJob.name : 'Структурный жакет') + ' — Обзор',
      contDate: lastJob ? fmtDay(lastJob.created_at) : '16 июл',
      fabSize: doc ? INT_OF(bru, bru) + ' / RU ' + bru : 'M / RU 46',
      fabHeroBg:
        'position:absolute;inset:14px;background:' +
        ((liveOn && this.flatAllUrl()) || 'url(assets/flat-alt.png)') +
        ' 50% 50%/contain no-repeat',
    };
  }

  plural(n) {
    return n === 1 ? 'значение' : n < 5 ? 'значения' : 'значений';
  }

  readyData(guessCount) {
    const spec = this.state.curSpec;
    const items = spec
      ? [
          ['Чертёж построен', '3 вида, слои', 'ok', 'flats'],
          [
            'Замеры и градация',
            spec.measurements.points.length +
              ' точек · ' +
              ((spec.base && spec.base.size_range) || []).length +
              ' размеров',
            'ok',
            'pom',
          ],
          [
            guessCount + ' предположений',
            'подтвердить по образцу',
            guessCount > 0 ? 'warn' : 'ok',
            'pom',
          ],
          [
            'Материалы (BOM)',
            spec.bom
              ? spec.bom.lines.length +
                ' позиций · ' +
                spec.bom.colorways.length +
                ' ' +
                (spec.bom.colorways.length === 1 ? 'колорвей' : 'колорвея')
              : 'раздел не собран',
            spec.bom ? 'ok' : 'warn',
            'bom',
          ],
          [
            'Юрданные бренда',
            this.state.legalDone ? 'из библиотеки · на ярлыках' : 'нужны для ярлыков',
            this.state.legalDone ? 'ok' : 'warn',
            'lib',
          ],
          ['GTIN для маркировки', 'не требуется до тиража', 'off', 'labels'],
        ]
      : [
          ['Чертёж построен', '3 вида, слои', 'ok', 'flats'],
          ['Замеры и градация', '10 точек · XS–XL', 'ok', 'pom'],
          [
            guessCount + ' предположений',
            'подтвердить по образцу',
            guessCount > 0 ? 'warn' : 'ok',
            'pom',
          ],
          [
            'Материалы (BOM)',
            9 +
              (this.state.bomExtra || []).length +
              ' позиций · ' +
              (this.state.cwAdded ? '2 колорвея' : '1 колорвей'),
            'ok',
            'bom',
          ],
          [
            'Юрданные бренда',
            this.state.legalDone ? 'из библиотеки · на ярлыках' : 'нужны для ярлыков',
            this.state.legalDone ? 'ok' : 'warn',
            'lib',
          ],
          ['GTIN для маркировки', 'не требуется до тиража', 'off', 'labels'],
        ];
    const done = items.filter((i) => i[2] === 'ok').length;
    return { items, pct: Math.round((done / items.length) * 100) + '%' };
  }

  pomColsRaw(pro) {
    return '54px minmax(0,1fr) 92px 74px 62px 62px 62px 62px' + (pro ? ' 74px' : '') + ' 150px';
  }
}
