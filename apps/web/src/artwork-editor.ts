import {
  garmentBoxFromLuma,
  placementOverlaySvg,
  type GarmentBox,
  type PlacementRect,
} from '@seamster/flats/client';

/**
 * Раскладка нанесения поверх технического рисунка — в браузере.
 *
 * Рисунок кладётся фоном, рамки макетов — поверх. Рамку можно двигать и
 * тянуть за угол; каждое движение отдаётся наружу в пикселях картинки,
 * а в сантиметры его переводит кабинет по геометрии из спецификации
 * (packages/flats/src/placement.ts). Редактор ничего не знает о сантиметрах
 * намеренно: одна геометрия на кабинет и документ, и живёт она не здесь.
 */
export interface ArtworkEditorBox {
  pid: string;
  letter: string;
  rect: PlacementRect;
  active?: boolean;
}

export interface ArtworkEditorOptions {
  host: HTMLElement;
  imageUrl: string;
  boxes: readonly ArtworkEditorBox[];
  /** Габарит изделия найден — кабинет считает по нему масштаб. */
  onReady: (image: { w: number; h: number }, box: GarmentBox | null) => void;
  /** Рамку подвинули или растянули: pid и новый прямоугольник в пикселях картинки. */
  onChange: (pid: string, rect: PlacementRect) => void;
  onSelect: (pid: string) => void;
}

export interface ArtworkEditorHandle {
  update(boxes: readonly ArtworkEditorBox[]): void;
  destroy(): void;
}

export function mountArtworkEditor(options: ArtworkEditorOptions): ArtworkEditorHandle {
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
  let boxes: ArtworkEditorBox[] = [...options.boxes];

  /** Пиксели картинки → пиксели экрана: картинка растянута на ширину хоста. */
  const scale = (): number => (image.w ? host.clientWidth / image.w : 1);

  function draw(): void {
    overlay.innerHTML = image.w
      ? placementOverlaySvg(
          boxes.map((b) => ({ letter: b.letter, rect: b.rect, active: !!b.active })),
          image,
        )
      : '';
    handles.innerHTML = '';
    if (!image.w) return;
    const k = scale();
    for (const b of boxes) {
      const el = document.createElement('div');
      el.dataset.pid = b.pid;
      el.style.cssText =
        `position:absolute;left:${b.rect.x * k}px;top:${b.rect.y * k}px;width:${b.rect.w * k}px;` +
        `height:${b.rect.h * k}px;cursor:move;border-radius:2px`;
      const grip = document.createElement('div');
      grip.dataset.grip = '1';
      grip.style.cssText =
        'position:absolute;right:-6px;bottom:-6px;width:12px;height:12px;border-radius:3px;' +
        'background:#0E0E0E;border:2px solid #fff;cursor:nwse-resize;box-shadow:0 1px 3px rgba(0,0,0,.3)';
      el.appendChild(grip);
      handles.appendChild(el);
    }
  }

  // --- pointer -------------------------------------------------------
  let drag: {
    pid: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    rect: PlacementRect;
  } | null = null;

  const onDown = (e: PointerEvent): void => {
    const target = e.target as HTMLElement;
    const el = target.closest('[data-pid]') as HTMLElement | null;
    if (!el || !el.dataset.pid) return;
    const box = boxes.find((b) => b.pid === el.dataset.pid);
    if (!box) return;
    e.preventDefault();
    drag = {
      pid: box.pid,
      mode: target.dataset.grip ? 'resize' : 'move',
      startX: e.clientX,
      startY: e.clientY,
      rect: { ...box.rect },
    };
    handles.setPointerCapture(e.pointerId);
    options.onSelect(box.pid);
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    const k = scale();
    const dx = (e.clientX - drag.startX) / k;
    const dy = (e.clientY - drag.startY) / k;
    const box = boxes.find((b) => b.pid === drag!.pid);
    if (!box) return;
    if (drag.mode === 'move') {
      box.rect = {
        ...drag.rect,
        x: clamp(drag.rect.x + dx, 0, image.w - drag.rect.w),
        y: clamp(drag.rect.y + dy, 0, image.h - drag.rect.h),
      };
    } else {
      box.rect = {
        ...drag.rect,
        w: clamp(drag.rect.w + dx, image.w * 0.02, image.w - drag.rect.x),
        h: clamp(drag.rect.h + dy, image.h * 0.02, image.h - drag.rect.y),
      };
    }
    draw();
  };
  const onUp = (e: PointerEvent): void => {
    if (!drag) return;
    const box = boxes.find((b) => b.pid === drag!.pid);
    const pid = drag.pid;
    drag = null;
    try {
      handles.releasePointerCapture(e.pointerId);
    } catch {
      /* захват уже снят */
    }
    if (box) options.onChange(pid, { ...box.rect });
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
      // Габарит — по яркости в уменьшенной копии: точности до пикселя не
      // нужно, а полный лист в канвасе тяжёл на телефоне.
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
      boxes = next.map((b) => ({ ...b, rect: { ...b.rect } }));
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
