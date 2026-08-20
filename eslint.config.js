const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier');

/**
 * TSLint is gone; this replaces it (UPGRADE_PLAN Phase 4).
 *
 * Two things it deliberately does not do. It does not format: Prettier owns
 * that, `eslint-config-prettier` switches off every rule that would argue with
 * it, and `npm run format` is a separate command - a production build must not
 * rewrite source files. And it does not run type-aware rules: those need a
 * full program per lint, and `npm run typecheck` already builds one.
 */
module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'baseline/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // `interface Props {}` and `interface State {}` are how a React class
      // component declares that it has neither. Phase 9 deletes every one of
      // them along with React; until then they are the idiom, not a mistake.
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'always' },
      ],
      // TypeScript resolves every identifier already, and it knows about the
      // DOM, Node and Jest globals that ESLint would otherwise report.
      'no-undef': 'off',
      // The interpreter's values are genuinely dynamic: `Variable.getValue()`
      // returns a number, an array of Variables, or null, and unicoen.ts types
      // most of it as `any` at the boundary.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Phase 5's boundary, enforced rather than remembered: `src/core` runs the
    // program and describes it, and knows nothing about the interface. Break
    // this and the Worker in Phase 6 stops being a move and becomes a rewrite.
    files: ['src/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/components/**', '**/ui/**'],
              message:
                'src/core may not depend on the interface. Report through a callback and let the caller wire it up.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['test/**'],
    languageOptions: { globals: globals.jest },
    rules: {
      // Tests reach into private state to check it, which needs the cast.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // The build's own configuration and scripts: CommonJS, running in Node.
    files: ['*.js', 'scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  }
);
