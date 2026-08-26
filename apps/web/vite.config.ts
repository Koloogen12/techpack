import { defineConfig } from 'vite';

/**
 * Сборка кабинета — двухшаговая:
 *
 *  1. vite собирает движок чертежа в один классический скрипт (engine.js):
 *     кабинет — дословный порт прототипа хендоффа и исполняется его же
 *     рантаймом без бандлера, движку остаётся лечь рядом простым файлом;
 *  2. scripts/build-proto.mjs собирает dist/index.html из разметки прототипа
 *     и логики proto/logic.js (см. `pnpm build`).
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/engine.ts',
      name: 'SeamsterlyEngine',
      formats: ['iife'],
      fileName: () => 'engine.js',
    },
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },
});
