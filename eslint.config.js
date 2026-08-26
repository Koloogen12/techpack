import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      // Рабочие копии субагентов: у них свой прогон проверок.
      '.claude/worktrees/**',
      '**/dist/**',
      'coverage/**',
      'design_handoff_seamsterly/**',
      'market-research/**',
      '*.html',
    ],
  },
  js.configs.recommended,
  {
    // Сборочные скрипты кабинета — нодовые ESM без TypeScript.
    files: ['apps/web/scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    // Логика кабинета — дословный порт прототипа хендоффа: исполняется его
    // рантаймом (support.js) в браузере через new Function, без сборки.
    // DCLogic приходит из рантайма, остальные глобалы браузерные.
    files: ['apps/web/proto/**/*.js'],
    languageOptions: {
      globals: {
        DCLogic: 'readonly',
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        history: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        navigator: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Date: 'readonly',
        JSON: 'readonly',
        Math: 'readonly',
        Number: 'readonly',
        String: 'readonly',
        Object: 'readonly',
        Array: 'readonly',
        Set: 'readonly',
        Promise: 'readonly',
        Error: 'readonly',
        isFinite: 'readonly',
        isNaN: 'readonly',
        parseFloat: 'readonly',
        encodeURIComponent: 'readonly',
        clearTimeout: 'readonly',
        setTimeout: 'readonly',
        clearInterval: 'readonly',
        setInterval: 'readonly',
      },
    },
  },
  {
    // Сборщик вердиктов — обычный ESM на сервере, без сборки и без TypeScript.
    // Глобалы у него нодовые, а не браузерные.
    files: ['apps/site/server/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Date: 'readonly',
        Map: 'readonly',
        JSON: 'readonly',
        Number: 'readonly',
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          // Деструктуризация с отбрасыванием поля — законный приём в тестах:
          // `const { not_visible: _omitted, ...rest } = report`.
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Значение без источника не компилируется — принцип §1.3 CTO-SPEC.
      // Запрещаем тихие any в доменном коде.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
