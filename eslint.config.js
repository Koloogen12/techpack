import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      'coverage/**',
      'design_handoff_specform/**',
      'market-research/**',
      '*.html',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Значение без источника не компилируется — принцип §1.3 CTO-SPEC.
      // Запрещаем тихие any в доменном коде.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
