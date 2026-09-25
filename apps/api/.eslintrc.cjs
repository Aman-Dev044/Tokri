/* eslint-env node */
/**
 * apps/api lint configuration.
 *
 * Everything of substance lives in `@mandi/config/eslint/base.cjs` — in
 * particular the `no-restricted-syntax` gate that makes
 * `process.env.X || 'fallback'` a build failure rather than a code-review
 * opinion. See the comments in that file.
 *
 * `require.resolve` is used instead of a bare package specifier so the
 * config resolves deterministically under pnpm's non-flat node_modules.
 */
module.exports = {
  root: true,
  extends: [require.resolve('@mandi/config/eslint/base.cjs')],
  parserOptions: {
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage', '.eslintrc.cjs'],
};
