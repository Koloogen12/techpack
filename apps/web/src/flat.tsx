import { useMemo, useRef, useState } from 'react';
import type { StyleSpec } from '@seamsterly/stylespec';
import { measurementsFrom, renderFlat, type FlatLayer } from '@seamsterly/flats/client';

/**
 * Живой чертёж: SVG строится В БРАУЗЕРЕ из спеки.
 *
 * Это и есть демонстрация рва: правка замера перестраивает геометрию
 * на том же кадре, без похода на сервер. Ходить за SVG по сети значило бы
 * вставить сеть в петлю набора текста — и на созвоне пауза в полсекунды
 * убьёт весь эффект.
 *
 * Величины, которых нет в табеле (глубина бока, угол рукава), приходят
 * с сервера данными: клиент не читает справочников.
 */

const LAYERS: { id: FlatLayer; label: string }[] = [
  { id: 'outline', label: 'Контур' },
  { id: 'seams', label: 'Швы' },
  { id: 'stitches', label: 'Строчки' },
  { id: 'artwork', label: 'Нанесение' },
];

const VIEWS = [
  { id: 'front', label: 'Перед' },
  { id: 'back', label: 'Спинка' },
  { id: 'side', label: 'Бок' },
] as const;

export function LiveFlat({
  spec,
  defaults,
  pulse,
  compact,
  onCallout,
}: {
  spec: StyleSpec;
  defaults: { depthCm?: number; minSleeveAngleDeg?: number };
  /** Метка последней правки — по ней вспыхивает рамка «чертёж обновлён». */
  pulse: number;
  /** Режим обложки: без панели слоёв, вписан в контейнер. */
  compact?: boolean;
  /** Клик по чертежу ведёт в конструкцию — выноски связывают их. */
  onCallout?: () => void;
}) {
  const [view, setView] = useState<'front' | 'back' | 'side'>('front');
  const [layers, setLayers] = useState<Set<FlatLayer>>(
    () => new Set<FlatLayer>(['outline', 'seams', 'stitches', 'artwork']),
  );
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const hasSide =
    defaults.depthCm !== undefined && spec.measurements.points.some((p) => p.code === 'H01');

  const svg = useMemo(() => {
    const m = measurementsFrom(spec);
    const options = {
      view,
      layers: [...layers],
      ...(defaults.minSleeveAngleDeg !== undefined
        ? { minSleeveAngleDeg: defaults.minSleeveAngleDeg }
        : {}),
      ...(view === 'side' && defaults.depthCm !== undefined ? { depthCm: defaults.depthCm } : {}),
    };
    try {
      return renderFlat(m, options).svg;
    } catch {
      return null;
    }
  }, [spec, view, layers, defaults]);

  if (compact) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        {svg ? (
          <div style={{ width: '70%' }} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span style={{ color: 'var(--secondary)' }}>Чертёж не построился</span>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {VIEWS.filter((v) => v.id !== 'side' || hasSide).map((v) => (
          <button
            key={v.id}
            className={`chip ${view === v.id ? 'on' : ''}`}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
        <span style={{ width: 16 }} />
        {LAYERS.map((l) => (
          <button
            key={l.id}
            className={`chip ${layers.has(l.id) ? 'on' : ''}`}
            onClick={() => {
              const next = new Set(layers);
              if (next.has(l.id)) next.delete(l.id);
              else next.add(l.id);
              setLayers(next);
            }}
          >
            {l.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          className="chip"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          1:1
        </button>
      </div>

      <div
        key={pulse}
        onWheel={(e) => {
          e.preventDefault();
          setZoom((z) => Math.min(6, Math.max(0.5, z * (e.deltaY < 0 ? 1.12 : 0.89))));
        }}
        onPointerDown={(e) => {
          dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          setPan({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
        }}
        onPointerUp={() => (dragging.current = null)}
        style={{
          background: 'var(--paper)',
          borderRadius: 14,
          boxShadow: 'var(--shadow-doc)',
          height: '62vh',
          overflow: 'hidden',
          cursor: dragging.current ? 'grabbing' : 'grab',
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
          touchAction: 'none',
          animation: pulse ? 'flatFlash 900ms ease' : undefined,
        }}
      >
        <style>{`@keyframes flatFlash { 0% { box-shadow: 0 0 0 3px rgba(47,124,90,.55), var(--shadow-doc); } 100% { box-shadow: var(--shadow-doc); } }`}</style>
        <div className="kicker" style={{ position: 'absolute', top: 14, left: 18 }}>
          Технический чертёж · масштаб не соблюдён — размеры в замерах
        </div>
        {svg ? (
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: dragging.current ? 'none' : 'transform 120ms ease',
              width: '58%',
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div style={{ color: 'var(--secondary)' }}>Чертёж не построился</div>
        )}
      </div>
      <div style={{ color: 'var(--secondary)', fontSize: 12.5, marginTop: 10 }}>
        Геометрия правится только через данные: измените замер — чертёж перестроится. Колесо —
        масштаб, перетаскивание — сдвиг.
        {onCallout && (
          <a style={{ cursor: 'pointer', marginLeft: 10 }} onClick={onCallout}>
            Узлы обработки этого чертежа — в Конструкции →
          </a>
        )}
      </div>
    </div>
  );
}
