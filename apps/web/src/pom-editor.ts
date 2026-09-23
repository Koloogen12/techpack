import {
  garmentBoxFromLuma,
  pomDrawingSvg,
  type GarmentBox,
  type PomGrid,
  type PomLine,
  type PomPoint,
} from '@seamster/flats/client';

/**
 * Чертёж замеров поверх рисунка вида — в браузере.
 *
 * Рисунок кладётся картинкой, линии точек табеля и сетка — слоем SVG, тем же,
 * что печатает документ (packages/flats/src/pom-drawing.ts). Редактор умеет
 * три вещи: выделить точку кликом по подписи, подвинуть концы выделенной
 * линии, поставить новую линию двумя кликами. Всё наружу — в пикселях
 * картинки; в доли габарита и в спеку это переводит кабинет.
 */
export interface PomEditorState {
  lines: readonly PomLine[];
  grid: PomGrid | null;
  active: string | null;
  /** Код точки, для которой ждём два клика по рисунку. */
  placing: string | null;
}

export interface PomEditorOptions extends PomEditorState {
  host: HTMLElement;
  imageUrl: string;
  onReady: (image: { w: number; h: number }, box: GarmentBox | null) => void;
  onChange: (code: string, pts: PomPoint[]) => void;
  onSelect: (code: string) => void;
}

export interface PomEditorHandle {
  update(state: PomEditorState): void;
  destroy(): void;
}

export function mountPomEditor(options: PomEditorOptions): PomEditorHandle {
  const { host } = options;
  host.innerHTML = '';
  host.style.position = 'relative';
  host.style.userSelect = 'none';
  host.style.touchAction = 'none';

  const img = document.createElement('img');
  img.src = options.imageUrl;
  img.alt = '';
  img.draggable = false;
  img.style.cssText = 'display:block;width:100%;height:auto;pointer-events:none';
  host.appendChild(img);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0';
  host.appendChild(overlay);

  const handles = document.createElement('div');
  handles.style.cssText = 'position:absolute;inset:0';
  host.appendChild(handles);

  let image = { w: 0, h: 0 };
  let state: PomEditorState = {
    lines: options.lines.map((l) => ({ ...l, pts: l.pts.map((p) => ({ ...p })) })),
    grid: options.grid,
    active: options.active,
    placing: options.placing,
  };
  let pending: PomPoint[] = [];

  const scale = (): number => (image.w ? host.clientWidth / image.w : 1);

  function draw(): void {
    overlay.innerHTML = image.w
      ? pomDrawingSvg(state.lines, state.grid, image, { active: state.active })
      : '';
    handles.innerHTML = '';
    handles.style.cursor = state.placing ? 'crosshair' : 'default';
    if (!image.w) return;
    const k = scale();
    // Клики по подписям — выделение точки: подписи живут в слое SVG, а
    // слой перехватывать нельзя (он под ручками), поэтому ручки-невидимки.
    for (const line of state.lines) {
      const label = overlay.querySelector(`[data-pom-label="${line.code}"] rect`);
      if (!label) continue;
      const r = label as SVGRectElement;
      const el = document.createElement('div');
      el.dataset.label = line.code;
      el.style.cssText =
        `position:absolute;left:${Number(r.getAttribute('x')) * k}px;top:${Number(r.getAttribute('y')) * k}px;` +
        `width:${Number(r.getAttribute('width')) * k}px;height:${Number(r.getAttribute('height')) * k}px;cursor:pointer`;
      handles.appendChild(el);
    }
    const active = state.lines.find((l) => l.code === state.active);
    if (active && !state.placing) {
      active.pts.forEach((p, i) => {
        const grip = document.createElement('div');
        grip.dataset.grip = String(i);
        grip.style.cssText =
          `position:absolute;left:${p.x * k - 7}px;top:${p.y * k - 7}px;width:14px;height:14px;border-radius:50%;` +
          'background:#0E0E0E;border:2px solid #fff;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.35)';
        handles.appendChild(grip);
      });
    }
    // Первая точка новой линии — маркер, пока ждём вторую.
    if (state.placing && pending.length) {
      const p = pending[0]!;
      const mark = document.createElement('div');
      mark.style.cssText =
        `position:absolute;left:${p.x * k - 5}px;top:${p.y * k - 5}px;width:10px;height:10px;border-radius:50%;` +
        'background:#fff;border:2px solid #0E0E0E;pointer-events:none';
      handles.appendChild(mark);
    }
  }

  let drag: { index: number; pts: PomPoint[] } | null = null;

  const toImage = (e: PointerEvent): PomPoint => {
    const rect = host.getBoundingClientRect();
    const k = scale();
    return {
      x: clamp((e.clientX - rect.left) / k, 0, image.w),
      y: clamp((e.clientY - rect.top) / k, 0, image.h),
    };
  };

  const onDown = (e: PointerEvent): void => {
    if (!image.w) return;
    const target = e.target as HTMLElement;
    if (state.placing) {
      e.preventDefault();
      pending.push(toImage(e));
      if (pending.length >= 2) {
        const pts = pending;
        pending = [];
        options.onChange(state.placing, pts);
      } else draw();
      return;
    }
    if (target.dataset.label) {
      e.preventDefault();
      options.onSelect(target.dataset.label);
      return;
    }
    if (target.dataset.grip !== undefined && state.active) {
      const line = state.lines.find((l) => l.code === state.active);
      if (!line) return;
      e.preventDefault();
      drag = { index: Number(target.dataset.grip), pts: line.pts.map((p) => ({ ...p })) };
      handles.setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag || !state.active) return;
    const line = state.lines.find((l) => l.code === state.active);
    if (!line) return;
    line.pts[drag.index] = toImage(e);
    draw();
  };
  const onUp = (e: PointerEvent): void => {
    if (!drag) return;
    const line = state.lines.find((l) => l.code === state.active);
    drag = null;
    try {
      handles.releasePointerCapture(e.pointerId);
    } catch {
      /* захват уже снят */
    }
    if (line)
      options.onChange(
        line.code,
        line.pts.map((p) => ({ ...p })),
      );
  };
  handles.addEventListener('pointerdown', onDown);
  handles.addEventListener('pointermove', onMove);
  handles.addEventListener('pointerup', onUp);
  handles.addEventListener('pointercancel', onUp);
  const onResize = (): void => draw();
  window.addEventListener('resize', onResize);

  img.onload = () => {
    image = { w: img.naturalWidth, h: img.naturalHeight };
    let box: GarmentBox | null = null;
    try {
      const k = Math.min(1, 600 / image.w);
      const cw = Math.max(1, Math.round(image.w * k));
      const ch = Math.max(1, Math.round(image.h * k));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0, cw, ch);
        const data = ctx.getImageData(0, 0, cw, ch).data;
        const luma = new Uint8Array(cw * ch);
        for (let i = 0; i < cw * ch; i++)
          luma[i] = (data[i * 4]! * 299 + data[i * 4 + 1]! * 587 + data[i * 4 + 2]! * 114) / 1000;
        const small = garmentBoxFromLuma(luma, cw, ch);
        if (small) box = { x0: small.x0 / k, y0: small.y0 / k, x1: small.x1 / k, y1: small.y1 / k };
      }
    } catch {
      box = null;
    }
    draw();
    options.onReady(image, box);
  };
  img.onerror = () => options.onReady({ w: 0, h: 0 }, null);

  return {
    update(next) {
      if (next.placing !== state.placing) pending = [];
      state = {
        lines: next.lines.map((l) => ({ ...l, pts: l.pts.map((p) => ({ ...p })) })),
        grid: next.grid,
        active: next.active,
        placing: next.placing,
      };
      draw();
    },
    destroy() {
      handles.removeEventListener('pointerdown', onDown);
      handles.removeEventListener('pointermove', onMove);
      handles.removeEventListener('pointerup', onUp);
      handles.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
      host.innerHTML = '';
    },
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
