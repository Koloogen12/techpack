/**
 * Движок чертежа для кабинета.
 *
 * Кабинет — дословный порт прототипа хендоффа, он исполняется рантаймом
 * прототипа (design_handoff_seamster/support.js) как обычный скрипт, без
 * бандлера. Единственное, что ему нужно из нашего кода, — чистая геометрия
 * флэтов, поэтому она выкладывается на window одним объектом.
 *
 * Живой чертёж пересобирается на каждое нажатие клавиши в замерах — сеть
 * в этой петле недопустима, вся геометрия считается здесь, в браузере.
 */
import {
  editsDataUri,
  editsToSvg,
  garmentGeometry,
  imageViewOfZone,
  measurementsFrom,
  placementRect,
  pomCodesWithPlace,
  pomGrid,
  pomLines,
  rectToCm,
  renderFlat,
  toDrawing,
} from '@seamster/flats/client';
import { mountSketchEditor } from './sketch-editor.js';
import { mountArtworkEditor } from './artwork-editor.js';
import { mountPomEditor } from './pom-editor.js';

declare global {
  interface Window {
    SeamsterEngine: {
      measurementsFrom: typeof measurementsFrom;
      renderFlat: typeof renderFlat;
      /** Слой правок эскиза: тот же SVG, что печатает документ. */
      editsToSvg: typeof editsToSvg;
      editsDataUri: typeof editsDataUri;
      mountSketchEditor: typeof mountSketchEditor;
      /** Раскладка нанесения: геометрия та же, что печатает документ. */
      mountArtworkEditor: typeof mountArtworkEditor;
      garmentGeometry: typeof garmentGeometry;
      placementRect: typeof placementRect;
      rectToCm: typeof rectToCm;
      imageViewOfZone: typeof imageViewOfZone;
      /** Чертёж замеров: линии точек табеля на рисунке вещи, та же геометрия, что в документе. */
      mountPomEditor: typeof mountPomEditor;
      pomLines: typeof pomLines;
      pomGrid: typeof pomGrid;
      pomCodesWithPlace: typeof pomCodesWithPlace;
      toDrawing: typeof toDrawing;
    };
  }
}

window.SeamsterEngine = {
  measurementsFrom,
  renderFlat,
  editsToSvg,
  editsDataUri,
  mountSketchEditor,
  mountArtworkEditor,
  garmentGeometry,
  placementRect,
  rectToCm,
  imageViewOfZone,
  mountPomEditor,
  pomLines,
  pomGrid,
  pomCodesWithPlace,
  toDrawing,
};
