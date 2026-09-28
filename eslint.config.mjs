// Конфиг ESLint 9 (плоский формат). Те же правила, что были в .eslintrc.js, который ESLint 9 не читает:
// рекомендованные правила typescript-eslint + prettier как правило линтера.
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export default [
    { ignores: ['dist/**', 'node_modules/**', 'admin-panel/**', 'coverage/**', 'eslint.config.mjs'] },
    ...tsPlugin.configs['flat/recommended'],
    prettierRecommended,
    {
        files: ['**/*.ts'],
        languageOptions: {
            sourceType: 'module',
            globals: { ...globals.node, ...globals.jest },
        },
        rules: {
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            // обязательные по сигнатуре, но не нужные параметры помечаем _ (как уже принято в коде)
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
            ],
        },
    },
];
