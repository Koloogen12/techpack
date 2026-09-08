/**
 * Редактор слоя правок поверх эскиза — для кабинета.
 *
 * Правки живут отдельным векторным слоем (`@seamster/flats` → edits.ts):
 * растр эскиза не трогается, ластик — белый штрих того же слоя, и любую
 * правку можно снять через год. Референс запекает правки в пиксели и после
 * сохранения не даёт их трогать — здесь это принципиально иначе.
 *
 * Инструменты и клавиши — индустриальная норма (Illustrator): перо P,
 * выделение V, точка A, кривая C, ластик E, рука H / Space; Enter завершает
 * линию, Esc отменяет, Ctrl+Z / Shift+Ctrl+Z — история.
 *
 * Иконки — Lucide (ISC, https://lucide.dev/license). Стили — токены
 * дизайн-системы с запасными литералами хендоффа.
 */
import {
  EDIT_MAX_WIDTH,
  EDIT_MIN_WIDTH,
  EDIT_PRESETS,
  editsToSvg,
  emptyEdits,
  flattenStroke,
  presetSwatchSvg,
  type EditPoint,
  type EditPreset,
  type EditStroke,
  type SketchEdits,
} from '@seamster/flats/client';

export interface SketchEditorOptions {
  host: HTMLElement;
  imageUrl: string;
  sheet: { w: number; h: number };
  edits: SketchEdits | null;
  onSave: (edits: SketchEdits) => Promise<void> | void;
  onClose: () => void;
}

export interface SketchEditorHandle {
  destroy(): void;
  getEdits(): SketchEdits;
  isDirty(): boolean;
}

type Tool = 'pen' | 'select' | 'point' | 'curve' | 'erase' | 'hand';

const ICON: Record<string, string> = {
  pen: '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.02a1 1 0 0 0-1.216 1.216l3.33 12.643a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/>',
  select:
    '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
  point: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  curve:
    '<circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M5 17A12 12 0 0 1 17 5"/>',
  erase:
    '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  zoomIn:
    '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
  zoomOut:
    '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
};

const icon = (name: string, px = 15): string =>
  `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] ?? ''}</svg>`;

const TOOLS: { id: Tool; key: string; label: string; hint: string }[] = [
  {
    id: 'pen',
    key: 'P',
    label: 'Перо (P)',
    hint: 'Перо: клик ставит точку, клик с протяжкой гнёт сегмент. Enter или ✓ завершает линию, Esc отменяет её; следующий клик начинает новую. Space — рука.',
  },
  {
    id: 'select',
    key: 'V',
    label: 'Выделение — вся линия (V)',
    hint: 'Выделение: кликните линию и тяните — двигается вся линия. Backspace удаляет её.',
  },
  {
    id: 'point',
    key: 'A',
    label: 'Точка — одна опорная (A)',
    hint: 'Точка: тяните любую опорную точку, чтобы изменить форму линии. Backspace удаляет точку.',
  },
  {
    id: 'curve',
    key: 'C',
    label: 'Кривая — выгнуть сегмент (C)',
    hint: 'Кривая: тяните середину сегмента, чтобы выгнуть его дугой; клик по дуге возвращает прямую.',
  },
  {
    id: 'erase',
    key: 'E',
    label: 'Ластик — скрыть линию (E)',
    hint: 'Ластик: проведите по лишней линии — она скроется белым штрихом слоя. Исходный эскиз не портится: штрих можно снять или отменить (Ctrl+Z).',
  },
  {
    id: 'hand',
    key: 'H',
    label: 'Рука — двигать лист (H, Space)',
    hint: 'Рука: тяните, чтобы двигать лист. Работает и так: зажмите Space или среднюю кнопку. Ctrl + колесо — масштаб.',
  },
];

const ZOOMS = [1, 1.3, 1.6, 2, 2.6, 3.4];

const STYLE = `
.ske{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--sf-paper,#fff);font:var(--sf-text-body,400 12px/18px Manrope,Sora,sans-serif);color:var(--sf-ink,#0E0E0E)}
.ske-view{flex:1;min-height:0;overflow:auto;position:relative;background:var(--sf-paper,#fff);touch-action:none}
.ske-view.t-pen,.ske-view.t-erase{cursor:crosshair}.ske-view.t-select{cursor:move}.ske-view.t-hand,.ske-view.panning{cursor:grab}.ske-view.panning:active{cursor:grabbing}
.ske-sheet{position:relative;margin:0 auto;line-height:0}
.ske-sheet img{display:block;width:100%;height:auto;user-select:none;-webkit-user-drag:none;pointer-events:none}
.ske-sheet svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.ske-pill{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;max-width:calc(100% - 24px);padding:6px 8px;border-radius:var(--sf-radius-md,14px);background:var(--sf-frost,rgba(255,255,255,.82));-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid var(--sf-glass-border,rgba(14,14,14,.08));box-shadow:var(--sf-shadow-float,0 16px 42px rgba(0,0,0,.1),inset 0 1px 0 rgba(255,255,255,.8));z-index:3}
.ske-name{font:var(--sf-text-kicker,650 9px/12px Manrope,sans-serif);letter-spacing:var(--sf-track-kicker,1.2px);text-transform:uppercase;color:var(--sf-secondary,#6B6B67);margin:0 6px 0 4px;white-space:nowrap}
.ske-group{display:inline-flex;align-items:center;gap:2px}
.ske-sep{width:1px;height:20px;background:var(--sf-hairline,#E4E1DC);margin:0 4px}
.ske-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--sf-radius-xs,8px);border:1px solid transparent;background:transparent;color:var(--sf-ink-2,#5A5A56);cursor:pointer;padding:0;transition:background var(--sf-dur-fast,120ms) var(--sf-ease,ease),color var(--sf-dur-fast,120ms) var(--sf-ease,ease),transform var(--sf-dur,160ms) var(--sf-ease,ease)}
.ske-btn:hover:not(:disabled){background:var(--sf-ink-a06,rgba(14,14,14,.06));color:var(--sf-ink,#0E0E0E)}
.ske-btn:active:not(:disabled){transform:scale(.94)}
.ske-btn.on{background:var(--sf-ink,#0E0E0E);border-color:var(--sf-ink,#0E0E0E);color:#fff}
.ske-btn:disabled{opacity:.38;cursor:not-allowed}
.ske-btn:focus-visible,.ske-swatch:focus-visible,.ske-text:focus-visible{outline:2px solid var(--sf-ink,#0E0E0E);outline-offset:1px}
.ske-swatch{display:inline-flex;align-items:center;justify-content:center;width:52px;height:28px;border-radius:var(--sf-radius-xs,8px);border:1px solid var(--sf-hairline,#E4E1DC);background:var(--sf-paper,#fff);cursor:pointer;padding:0;transition:border-color var(--sf-dur-fast,120ms),background var(--sf-dur-fast,120ms)}
.ske-swatch:hover{border-color:var(--sf-hairline-strong,#C8C4BC);background:var(--sf-paper-2,#F8F7F5)}
.ske-swatch.on{border-color:var(--sf-ink,#0E0E0E);box-shadow:inset 0 0 0 1px var(--sf-ink,#0E0E0E)}
.ske-swatch svg{display:block}
.ske-slider{display:inline-flex;align-items:center;gap:6px;margin:0 4px}
.ske-slider label{font:var(--sf-text-kicker,650 9px/12px Manrope,sans-serif);letter-spacing:var(--sf-track-kicker,1.2px);text-transform:uppercase;color:var(--sf-secondary,#6B6B67)}
.ske-slider input{width:74px;accent-color:var(--sf-ink,#0E0E0E)}
.ske-val{font:var(--sf-text-mono-md,500 10.5px/15px 'JetBrains Mono',monospace);color:var(--sf-ink-2,#5A5A56);min-width:64px;font-variant-numeric:tabular-nums}
.ske-text{height:28px;padding:0 12px;border-radius:var(--sf-radius-xs,8px);border:1px solid var(--sf-ink-a12,rgba(14,14,14,.12));background:var(--sf-paper,#fff);color:var(--sf-ink,#0E0E0E);font:var(--sf-text-body-md,500 12px/18px Manrope,sans-serif);cursor:pointer;transition:background var(--sf-dur-fast,120ms),border-color var(--sf-dur-fast,120ms)}
.ske-text:hover:not(:disabled){background:var(--sf-paper-2,#F8F7F5);border-color:var(--sf-ink-a18,rgba(14,14,14,.18))}
.ske-text.primary{background:var(--sf-ink,#0E0E0E);border-color:var(--sf-ink,#0E0E0E);color:#fff}
.ske-text.primary:hover:not(:disabled){background:#262626}
.ske-text:disabled{opacity:.45;cursor:not-allowed}
.ske-tip{position:absolute;left:12px;top:12px;display:inline-flex;align-items:center;gap:6px;max-width:calc(100% - 24px);padding:5px 10px;border-radius:var(--sf-radius-xs,8px);background:var(--sf-frost-strong,rgba(255,255,255,.92));border:1px solid var(--sf-hairline,#E4E1DC);font:var(--sf-text-caption,400 10.5px/16px Manrope,sans-serif);color:var(--sf-secondary,#6B6B67);z-index:3;pointer-events:none}
.ske-tip svg{flex:none;color:var(--sf-muted,#8A8A86)}
.ske-cursor{position:fixed;pointer-events:none;border-radius:50%;border:1.5px dashed var(--sf-ink,#0E0E0E);background:rgba(14,14,14,.05);transform:translate(-50%,-50%);z-index:4;display:none}
@media (prefers-reduced-motion: reduce){.ske-btn,.ske-swatch,.ske-text{transition:none}}
`;

function ensureStyle(): void {
  if (document.getElementById('ske-style')) return;
  const el = document.createElement('style');
  el.id = 'ske-style';
  el.textContent = STYLE;
  document.head.appendChild(el);
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const uid = (): string => Math.random().toString(36).slice(2, 10);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Расстояние от точки до отрезка и ближайшая точка на нём. */
function segDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + dx * t, y: a.y + dy * t });
}

export function mountSketchEditor(options: SketchEditorOptions): SketchEditorHandle {
  ensureStyle();
  const { host, sheet } = options;
  const edits: SketchEdits = options.edits ? clone(options.edits) : emptyEdits(sheet);
  edits.sheet = { w: sheet.w, h: sheet.h };
  let tool: Tool = 'pen';
  let preset: EditPreset = 'seam';
  let width = 4;
  let eraser = 12;
  let zoomIx = 0;
  let current: EditStroke | null = null;
  let selected: { id: string; point?: number } | null = null;
  let dirty = false;
  let saving = false;
  const history: string[] = [];
  const future: string[] = [];
  let spaceHeld = false;

  // --- DOM -----------------------------------------------------------------
  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'ske';
  root.innerHTML =
    `<div class="ske-view t-pen">` +
    `<div class="ske-sheet"><img alt=""><svg class="ske-layer" viewBox="0 0 ${sheet.w} ${sheet.h}"></svg><svg class="ske-work" viewBox="0 0 ${sheet.w} ${sheet.h}"></svg></div>` +
    `</div>` +
    `<div class="ske-tip" role="status" aria-live="polite">${icon('info', 12)}<span></span></div>` +
    `<div class="ske-pill" role="toolbar" aria-label="Правка рисунка"></div>` +
    `<div class="ske-cursor"></div>`;
  host.appendChild(root);
  const view = root.querySelector<HTMLDivElement>('.ske-view')!;
  const sheetEl = root.querySelector<HTMLDivElement>('.ske-sheet')!;
  const img = root.querySelector<HTMLImageElement>('img')!;
  const layer = root.querySelector<SVGSVGElement>('.ske-layer')!;
  const work = root.querySelector<SVGSVGElement>('.ske-work')!;
  const tip = root.querySelector<HTMLSpanElement>('.ske-tip span')!;
  const pill = root.querySelector<HTMLDivElement>('.ske-pill')!;
  const cursor = root.querySelector<HTMLDivElement>('.ske-cursor')!;
  img.src = options.imageUrl;

  const svgInner = (svg: string): string => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

  // --- toolbar --------------------------------------------------------------
  const btn = (name: string, label: string, cls = 'ske-btn'): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon(name);
    return b;
  };
  const textBtn = (text: string, primary = false): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ske-text' + (primary ? ' primary' : '');
    b.textContent = text;
    return b;
  };
  const sep = (): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = 'ske-sep';
    return s;
  };
  const group = (): HTMLSpanElement => {
    const g = document.createElement('span');
    g.className = 'ske-group';
    return g;
  };

  const name = document.createElement('span');
  name.className = 'ske-name';
  name.textContent = 'Правка рисунка';
  pill.appendChild(name);

  const toolGroup = group();
  toolGroup.setAttribute('role', 'group');
  toolGroup.setAttribute('aria-label', 'Инструменты');
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOLS) {
    const b = btn(t.id, t.label);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => setTool(t.id));
    toolBtns.set(t.id, b);
    toolGroup.appendChild(b);
  }
  pill.appendChild(toolGroup);
  pill.appendChild(sep());

  const swatchGroup = group();
  swatchGroup.setAttribute('role', 'group');
  swatchGroup.setAttribute('aria-label', 'Тип строчки');
  const swatchBtns = new Map<EditPreset, HTMLButtonElement>();
  for (const p of EDIT_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ske-swatch';
    b.title = `${p.label_ru} — ${p.hint_ru}`;
    b.setAttribute('aria-label', p.label_ru);
    b.innerHTML = presetSwatchSvg(p.id, 46, 20);
    b.addEventListener('click', () => {
      preset = p.id;
      if (tool === 'erase') setTool('pen');
      renderToolbar();
    });
    swatchBtns.set(p.id, b);
    swatchGroup.appendChild(b);
  }
  pill.appendChild(swatchGroup);

  const slider = document.createElement('span');
  slider.className = 'ske-slider';
  slider.innerHTML = `<label></label><input type="range" min="${EDIT_MIN_WIDTH}" max="${EDIT_MAX_WIDTH}" step="1"><span class="ske-val"></span>`;
  const sliderLabel = slider.querySelector('label')!;
  const range = slider.querySelector('input')!;
  const readout = slider.querySelector('.ske-val')!;
  range.addEventListener('input', () => {
    const v = Number(range.value);
    if (tool === 'erase') eraser = v;
    else width = v;
    renderToolbar();
  });
  pill.appendChild(slider);
  pill.appendChild(sep());

  const actions = group();
  const confirmBtn = btn('check', 'Завершить линию (Enter)');
  const undoBtn = btn('undo', 'Отменить (Ctrl+Z)');
  const redoBtn = btn('redo', 'Вернуть (Shift+Ctrl+Z)');
  const resetBtn = btn('reset', 'Снять все правки');
  confirmBtn.addEventListener('click', () => commitCurrent());
  undoBtn.addEventListener('click', () => undo());
  redoBtn.addEventListener('click', () => redo());
  resetBtn.addEventListener('click', () => {
    if (!edits.strokes.length && !current) return;
    pushHistory();
    edits.strokes = [];
    current = null;
    selected = null;
    dirty = true;
    renderAll();
  });
  for (const b of [confirmBtn, undoBtn, redoBtn, resetBtn]) actions.appendChild(b);
  pill.appendChild(actions);
  pill.appendChild(sep());

  const zoomGroup = group();
  const zoomOutBtn = btn('zoomOut', 'Уменьшить');
  const zoomVal = document.createElement('span');
  zoomVal.className = 'ske-val';
  zoomVal.style.minWidth = '38px';
  zoomVal.style.textAlign = 'center';
  const zoomInBtn = btn('zoomIn', 'Увеличить');
  zoomOutBtn.addEventListener('click', () => setZoom(zoomIx - 1));
  zoomInBtn.addEventListener('click', () => setZoom(zoomIx + 1));
  zoomGroup.append(zoomOutBtn, zoomVal, zoomInBtn);
  pill.appendChild(zoomGroup);
  pill.appendChild(sep());

  const cancelBtn = textBtn('Отмена');
  const saveBtn = textBtn('Сохранить', true);
  cancelBtn.addEventListener('click', () => close());
  saveBtn.addEventListener('click', () => void save());
  pill.append(cancelBtn, saveBtn);

  // --- rendering -----------------------------------------------------------
  function renderToolbar(): void {
    for (const [id, b] of toolBtns) {
      b.classList.toggle('on', id === tool);
      b.setAttribute('aria-pressed', String(id === tool));
    }
    for (const [id, b] of swatchBtns) b.classList.toggle('on', id === preset);
    swatchGroup.style.display = tool === 'erase' ? 'none' : '';
    const w = tool === 'erase' ? eraser : width;
    sliderLabel.textContent = tool === 'erase' ? 'Ластик' : 'Толщина';
    range.value = String(w);
    readout.textContent = `${w} px · ${(Math.round((w / sheet.h) * 1000) / 10).toString().replace('.', ',')} %`;
    confirmBtn.disabled = !current || current.points.length < 2;
    undoBtn.disabled = history.length === 0;
    redoBtn.disabled = future.length === 0;
    resetBtn.disabled = edits.strokes.length === 0 && !current;
    saveBtn.disabled = !dirty || saving;
    saveBtn.textContent = saving ? 'Сохраняем…' : 'Сохранить';
    zoomVal.textContent = `${Math.round(ZOOMS[zoomIx]! * 100)}%`;
    zoomOutBtn.disabled = zoomIx === 0;
    zoomInBtn.disabled = zoomIx === ZOOMS.length - 1;
    view.className = `ske-view t-${tool}${spaceHeld ? ' panning' : ''}`;
    tip.textContent = TOOLS.find((t) => t.id === tool)?.hint ?? '';
    cursor.style.display = tool === 'erase' ? '' : 'none';
  }

  function renderLayer(): void {
    layer.innerHTML = svgInner(editsToSvg(edits));
  }

  function renderWork(): void {
    const scale = sheetEl.getBoundingClientRect().width / sheet.w || 1;
    const hs = 7 / scale; // ручка 7px на экране
    let out = '';
    const handles = (s: EditStroke, active: boolean): string =>
      s.points
        .map((p, i) => {
          const x = p.x * sheet.w;
          const y = p.y * sheet.h;
          const ctrl =
            p.cx !== undefined && p.cy !== undefined
              ? `<line x1="${x}" y1="${y}" x2="${p.cx * sheet.w}" y2="${p.cy * sheet.h}" stroke="#1A4A7A" stroke-width="${1 / scale}" stroke-dasharray="${3 / scale} ${3 / scale}"/>` +
                `<circle cx="${p.cx * sheet.w}" cy="${p.cy * sheet.h}" r="${hs * 0.6}" fill="#fff" stroke="#1A4A7A" stroke-width="${1.2 / scale}"/>`
              : '';
          const on = active && selected?.point === i;
          return (
            ctrl +
            `<rect x="${x - hs / 2}" y="${y - hs / 2}" width="${hs}" height="${hs}" fill="${on ? '#1A4A7A' : '#fff'}" stroke="#1A4A7A" stroke-width="${1.2 / scale}"/>`
          );
        })
        .join('');
    if (current) {
      out += svgInner(editsToSvg({ ...edits, strokes: [current] }));
      out += handles(current, false);
    }
    if (selected) {
      const s = edits.strokes.find((x) => x.id === selected!.id);
      if (s) {
        const outline = flattenStroke(s, sheet);
        out +=
          `<polyline points="${outline.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#1A4A7A" stroke-opacity=".35" stroke-width="${Math.max(s.width + 6 / scale, 8 / scale)}" stroke-linecap="round" stroke-linejoin="round"/>` +
          handles(s, true);
      }
    }
    work.innerHTML = out;
  }

  function renderAll(): void {
    renderLayer();
    renderWork();
    renderToolbar();
  }

  function setTool(t: Tool): void {
    if (t !== 'pen' && current) commitCurrent();
    tool = t;
    if (t !== 'select' && t !== 'point' && t !== 'curve') selected = null;
    renderAll();
  }

  function setZoom(ix: number): void {
    zoomIx = Math.max(0, Math.min(ZOOMS.length - 1, ix));
    applyZoom();
    renderAll();
  }

  function applyZoom(): void {
    const base = view.clientWidth - 24;
    const fitByHeight = ((view.clientHeight - 24) * sheet.w) / sheet.h;
    const w = Math.max(80, Math.min(base, fitByHeight)) * ZOOMS[zoomIx]!;
    sheetEl.style.width = `${Math.round(w)}px`;
    sheetEl.style.marginTop = '12px';
    sheetEl.style.marginBottom = '12px';
  }

  // --- history -------------------------------------------------------------
  function pushHistory(): void {
    history.push(JSON.stringify(edits.strokes));
    if (history.length > 100) history.shift();
    future.length = 0;
  }
  function undo(): void {
    if (current) {
      current = null;
      renderAll();
      return;
    }
    const prev = history.pop();
    if (prev === undefined) return;
    future.push(JSON.stringify(edits.strokes));
    edits.strokes = JSON.parse(prev) as EditStroke[];
    selected = null;
    dirty = true;
    renderAll();
  }
  function redo(): void {
    const next = future.pop();
    if (next === undefined) return;
    history.push(JSON.stringify(edits.strokes));
    edits.strokes = JSON.parse(next) as EditStroke[];
    selected = null;
    dirty = true;
    renderAll();
  }

  function commitCurrent(): void {
    if (!current) return;
    if (current.points.length >= 2) {
      pushHistory();
      edits.strokes.push(current);
      dirty = true;
    }
    current = null;
    renderAll();
  }

  // --- geometry helpers ----------------------------------------------------
  const toNorm = (e: PointerEvent): EditPoint => {
    const r = sheetEl.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * 10000) / 10000,
      y: Math.round(((e.clientY - r.top) / r.height) * 10000) / 10000,
    };
  };
  const toPx = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: p.x * sheet.w,
    y: p.y * sheet.h,
  });
  const tolPx = (): number => 8 / (sheetEl.getBoundingClientRect().width / sheet.w || 1);

  function hitStroke(p: EditPoint): { stroke: EditStroke; seg: number } | null {
    const q = toPx(p);
    let best: { stroke: EditStroke; seg: number; d: number } | null = null;
    for (const s of edits.strokes) {
      const flat = flattenStroke(s, sheet);
      for (let i = 1; i < flat.length; i++) {
        const d = segDist(q, flat[i - 1]!, flat[i]!) - s.width / 2;
        if (d <= tolPx() && (!best || d < best.d)) {
          // Номер сегмента исходных точек: у кривых 16 шагов на сегмент.
          const seg = segmentIndex(s, i);
          best = { stroke: s, seg, d };
        }
      }
    }
    return best ? { stroke: best.stroke, seg: best.seg } : null;
  }

  function segmentIndex(s: EditStroke, flatIndex: number): number {
    let acc = 0;
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i]!;
      acc += p.cx !== undefined ? 16 : 1;
      if (flatIndex <= acc) return i;
    }
    return s.points.length - 1;
  }

  function hitPoint(p: EditPoint): { stroke: EditStroke; index: number } | null {
    const q = toPx(p);
    for (const s of edits.strokes) {
      for (let i = 0; i < s.points.length; i++) {
        if (dist(q, toPx(s.points[i]!)) <= tolPx()) return { stroke: s, index: i };
      }
    }
    return null;
  }

  // --- pointer interaction -------------------------------------------------
  let drag:
    | null
    | { kind: 'pen'; start: EditPoint; moved: boolean }
    | { kind: 'move'; start: EditPoint; base: EditPoint[]; stroke: EditStroke }
    | { kind: 'point'; stroke: EditStroke; index: number; start: EditPoint; base: EditPoint }
    | { kind: 'curve'; stroke: EditStroke; index: number; moved: boolean }
    | { kind: 'erase' }
    | { kind: 'pan'; x: number; y: number; left: number; top: number } = null;

  view.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || spaceHeld || tool === 'hand') {
      drag = {
        kind: 'pan',
        x: e.clientX,
        y: e.clientY,
        left: view.scrollLeft,
        top: view.scrollTop,
      };
      view.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const p = toNorm(e);
    if (p.x < -0.02 || p.x > 1.02 || p.y < -0.02 || p.y > 1.02) return;
    view.setPointerCapture(e.pointerId);
    e.preventDefault();
    switch (tool) {
      case 'pen': {
        if (!current) current = { id: uid(), kind: 'line', preset, width, points: [p] };
        else current.points.push(p);
        drag = { kind: 'pen', start: p, moved: false };
        break;
      }
      case 'select': {
        const hit = hitStroke(p);
        selected = hit ? { id: hit.stroke.id } : null;
        drag = hit
          ? { kind: 'move', start: p, base: clone(hit.stroke.points), stroke: hit.stroke }
          : null;
        break;
      }
      case 'point': {
        const hit = hitPoint(p);
        selected = hit ? { id: hit.stroke.id, point: hit.index } : null;
        drag = hit
          ? {
              kind: 'point',
              stroke: hit.stroke,
              index: hit.index,
              start: p,
              base: clone(hit.stroke.points[hit.index]!),
            }
          : null;
        break;
      }
      case 'curve': {
        const hit = hitStroke(p);
        if (hit && hit.seg >= 1) {
          selected = { id: hit.stroke.id };
          pushHistory();
          drag = { kind: 'curve', stroke: hit.stroke, index: hit.seg, moved: false };
        } else {
          selected = null;
          drag = null;
        }
        break;
      }
      case 'erase': {
        pushHistory();
        edits.strokes.push({
          id: uid(),
          kind: 'erase',
          preset: 'seam',
          width: eraser,
          points: [p],
        });
        dirty = true;
        drag = { kind: 'erase' };
        break;
      }
      default:
        drag = null;
    }
    renderAll();
  });

  view.addEventListener('pointermove', (e) => {
    if (tool === 'erase') {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
      const scale = sheetEl.getBoundingClientRect().width / sheet.w || 1;
      cursor.style.width = cursor.style.height = `${Math.max(6, eraser * scale)}px`;
    }
    if (!drag) return;
    const p = toNorm(e);
    switch (drag.kind) {
      case 'pan':
        view.scrollLeft = drag.left - (e.clientX - drag.x);
        view.scrollTop = drag.top - (e.clientY - drag.y);
        return;
      case 'pen': {
        if (!current || current.points.length < 2) return;
        if (
          !drag.moved &&
          dist(toPx(p), toPx(drag.start)) <
            4 / (sheetEl.getBoundingClientRect().width / sheet.w || 1)
        )
          return;
        drag.moved = true;
        const last = current.points[current.points.length - 1]!;
        last.cx = p.x;
        last.cy = p.y;
        break;
      }
      case 'move': {
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        drag.stroke.points = drag.base.map((b) => ({
          x: b.x + dx,
          y: b.y + dy,
          ...(b.cx !== undefined && b.cy !== undefined ? { cx: b.cx + dx, cy: b.cy + dy } : {}),
        }));
        break;
      }
      case 'point': {
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        const b = drag.base;
        drag.stroke.points[drag.index] = {
          x: b.x + dx,
          y: b.y + dy,
          ...(b.cx !== undefined && b.cy !== undefined ? { cx: b.cx + dx, cy: b.cy + dy } : {}),
        };
        break;
      }
      case 'curve': {
        drag.moved = true;
        const pt = drag.stroke.points[drag.index]!;
        pt.cx = p.x;
        pt.cy = p.y;
        break;
      }
      case 'erase': {
        const s = edits.strokes[edits.strokes.length - 1]!;
        const last = s.points[s.points.length - 1]!;
        if (dist(toPx(last), toPx(p)) >= 2) s.points.push(p);
        break;
      }
    }
    if (drag.kind === 'erase') renderLayer();
    renderWork();
  });

  const finishDrag = (): void => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'move' || d.kind === 'point') {
      // История пишется по факту сдвига, чтобы клик без движения её не засорял.
      const changed =
        JSON.stringify(d.stroke.points) !==
        JSON.stringify(d.kind === 'move' ? d.base : d.stroke.points);
      if (d.kind === 'move' && changed) {
        const after = d.stroke.points;
        d.stroke.points = d.base;
        pushHistory();
        d.stroke.points = after;
        dirty = true;
      } else if (d.kind === 'point') {
        const after = d.stroke.points[d.index]!;
        if (JSON.stringify(after) !== JSON.stringify(d.base)) {
          d.stroke.points[d.index] = d.base;
          pushHistory();
          d.stroke.points[d.index] = after;
          dirty = true;
        }
      }
    } else if (d.kind === 'curve') {
      if (!d.moved) {
        // Клик без протяжки по дуге — вернуть прямую.
        const pt = d.stroke.points[d.index]!;
        if (pt.cx !== undefined) {
          delete pt.cx;
          delete pt.cy;
          dirty = true;
        } else history.pop();
      } else dirty = true;
    } else if (d.kind === 'erase') {
      const s = edits.strokes[edits.strokes.length - 1]!;
      if (s.points.length === 1) s.points.push({ x: s.points[0]!.x + 0.0005, y: s.points[0]!.y });
    }
    renderAll();
  };
  view.addEventListener('pointerup', finishDrag);
  view.addEventListener('pointercancel', finishDrag);
  view.addEventListener('dblclick', () => {
    if (tool === 'pen') commitCurrent();
  });
  view.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom(zoomIx + (e.deltaY < 0 ? 1 : -1));
    },
    { passive: false },
  );
  view.addEventListener('pointerleave', () => {
    cursor.style.display = 'none';
  });
  view.addEventListener('pointerenter', () => {
    if (tool === 'erase') cursor.style.display = '';
  });

  // --- keyboard ------------------------------------------------------------
  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (
      t &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) &&
      (t as HTMLInputElement).type !== 'range'
    )
      return;
    if (e.key === ' ' && !e.repeat) {
      spaceHeld = true;
      renderToolbar();
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'Enter':
        commitCurrent();
        break;
      case 'Escape':
        if (current) {
          current = null;
          renderAll();
        } else close();
        break;
      case 'Backspace':
      case 'Delete': {
        if (!selected) return;
        const s = edits.strokes.find((x) => x.id === selected!.id);
        if (!s) return;
        pushHistory();
        if (selected.point !== undefined && s.points.length > 2) s.points.splice(selected.point, 1);
        else edits.strokes = edits.strokes.filter((x) => x.id !== s.id);
        selected = null;
        dirty = true;
        renderAll();
        e.preventDefault();
        break;
      }
      case '+':
      case '=':
        setZoom(zoomIx + 1);
        break;
      case '-':
        setZoom(zoomIx - 1);
        break;
      default: {
        const found = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
        if (found) setTool(found.id);
      }
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') {
      spaceHeld = false;
      renderToolbar();
    }
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);

  // --- save / close --------------------------------------------------------
  async function save(): Promise<void> {
    if (current) commitCurrent();
    if (!dirty || saving) return;
    saving = true;
    renderToolbar();
    try {
      await options.onSave(clone(edits));
      dirty = false;
    } finally {
      saving = false;
      renderToolbar();
    }
  }
  function close(): void {
    if (dirty && !window.confirm('Есть несохранённые правки. Закрыть без сохранения?')) return;
    options.onClose();
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => applyZoom()) : null;
  ro?.observe(view);
  img.addEventListener('load', () => {
    applyZoom();
    renderAll();
  });
  applyZoom();
  renderAll();

  return {
    destroy() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
      ro?.disconnect();
      host.innerHTML = '';
    },
    getEdits: () => clone(edits),
    isDirty: () => dirty,
  };
}
