import js from '@eslint/js';
import type { Linter } from 'eslint';
import globals from 'globals';
import ts from 'typescript-eslint';
import { entriesOnLines, noEmDash } from './rules.ts';

const config: Linter.Config[] = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.deslop/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      deslop: {
        rules: {
          'entries-on-lines': entriesOnLines,
          'no-em-dash': noEmDash,
        },
      },
    },
    rules: {
      'deslop/entries-on-lines': 'error',
      'deslop/no-em-dash': 'error',
      'no-unused-vars': 'error',
    },
  },
  {
    files: ['**/*.{ts,cts,mts,tsx}'],
    languageOptions: { parser: ts.parser },
    plugins: { '@typescript-eslint': ts.plugin },
    rules: {
      ...ts.configs.eslintRecommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
];

export default config;
