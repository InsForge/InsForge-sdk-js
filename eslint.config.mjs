import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';

// Rules shared across the SDK. Kept intentionally aligned with the InsForge
// OSS monorepo (backend) config so the two codebases feel the same, minus the
// type-aware/React rules that don't apply to this standalone library.
const sharedRules = {
  // TypeScript rules
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/explicit-module-boundary-types': 'off',
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    },
  ],
  '@typescript-eslint/no-non-null-assertion': 'warn',

  // General rules
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-debugger': 'error',
  'no-duplicate-imports': 'error',
  'no-unused-expressions': 'error',
  // Allow `let x; ...closure reads x...; x = ...` where a binding is assigned
  // once but referenced by a closure defined before the assignment.
  'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
  'no-var': 'error',
  eqeqeq: ['error', 'always'],
  curly: ['error', 'all'],

  // Prettier integration
  'prettier/prettier': 'error',
};

export default defineConfig(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  // Library source
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: sharedRules,
  },
  // Unit and integration tests: same style, but relaxed for test ergonomics
  {
    files: [
      'src/**/__tests__/**/*.ts',
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'integration-tests/**/*.ts',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      ...sharedRules,
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.config.ts',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.d.ts',
    ],
  }
);
