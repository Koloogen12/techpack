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
import { measurementsFrom, renderFlat } from '@seamster/flats/client';

declare global {
  interface Window {
    SeamsterEngine: {
      measurementsFrom: typeof measurementsFrom;
      renderFlat: typeof renderFlat;
    };
  }
}

window.SeamsterEngine = { measurementsFrom, renderFlat };
