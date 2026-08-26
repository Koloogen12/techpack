/**
 * Движок чертежа для кабинета.
 *
 * Кабинет — дословный порт прототипа хендоффа, он исполняется рантаймом
 * прототипа (design_handoff_seamsterly/support.js) как обычный скрипт, без
 * бандлера. Единственное, что ему нужно из нашего кода, — чистая геометрия
 * флэтов, поэтому она выкладывается на window одним объектом.
 *
 * Живой чертёж пересобирается на каждое нажатие клавиши в замерах — сеть
 * в этой петле недопустима, вся геометрия считается здесь, в браузере.
 */
import { measurementsFrom, renderFlat } from '@seamsterly/flats/client';

declare global {
  interface Window {
    SeamsterlyEngine: {
      measurementsFrom: typeof measurementsFrom;
      renderFlat: typeof renderFlat;
    };
  }
}

window.SeamsterlyEngine = { measurementsFrom, renderFlat };
