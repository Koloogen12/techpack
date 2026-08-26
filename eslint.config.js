import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      'coverage/**',
      'design_handoff_seamsterly/**',
      'market-research/**',
      '*.html',
    ],
  },
  js.configs.recommended,
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
