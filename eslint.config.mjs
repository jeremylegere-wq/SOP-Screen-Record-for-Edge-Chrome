// ESLint flat config. Plain JavaScript (no build step), so lint is the "type check" for this project.
import js from '@eslint/js';
import globals from 'globals';

const sharedRules = {
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  'no-undef': 'error'
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,

  // Extension code: classic browser scripts that share globals via lib/*.js
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        chrome: 'readonly',
        StepText: 'readonly',
        StepGuide: 'readonly',
        StepStore: 'readonly',
        StepRender: 'readonly'
      }
    },
    rules: sharedRules
  },
  // The service worker has no DOM
  {
    files: ['extension/background.js'],
    languageOptions: { globals: { ...globals.serviceworker, importScripts: 'readonly', chrome: 'readonly' } }
  },
  // lib/*.js also load under Node (tests) via a UMD wrapper
  {
    files: ['extension/lib/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },

  // Tooling and tests: modern Node ESM
  {
    files: ['scripts/**/*.mjs', 'test/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: sharedRules
  },
  // Code passed to page.evaluate()/worker.evaluate() runs in the browser
  {
    files: ['test/e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, chrome: 'readonly' } }
  }
];
