import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dev-dist/**',
      'terraform/**',
      'openspec/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      // Intentionally empty catch blocks are used for best-effort
      // browser APIs (audio unlock, device-motion permission) and for
      // swallowing non-fatal errors where the fallback is the return.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Catch bindings are routinely unused when the fallback is a
      // fixed value; don't require deleting the binding.
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },
  // Server: Node environment; console output is intentional (startup
  // lines, warnings), so the recommended no-console rule is off here.
  {
    files: ['server/**/*.{js,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },
  // Client: browser environment + classic react-hooks recommended
  // rules. Only console.warn/console.error are allowed.
  {
    files: ['client/**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  // Vitest runs with globals: true, so test files may use the
  // injected globals without importing them.
  {
    files: ['client/src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.vitest,
    },
  },
];
