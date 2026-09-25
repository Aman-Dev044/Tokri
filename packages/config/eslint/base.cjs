/* eslint-env node */
/**
 * @mandi/config — shared ESLint base.
 *
 * ────────────────────────────────────────────────────────────────────────
 *  THIS FILE IS A SECURITY CONTROL, NOT A STYLE GUIDE.
 * ────────────────────────────────────────────────────────────────────────
 *
 * The client's requirement is "zero hardcoded credentials". A convention
 * cannot deliver that — someone always types the convenient thing at 2am:
 *
 *     const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
 *
 * So the ban is mechanical. The rules below fail `pnpm lint`, which fails
 * the Turborepo pipeline, which fails CI. The fallback cannot be merged.
 *
 * Consumed via `require.resolve('@mandi/config/eslint/base.cjs')` from each
 * app's `.eslintrc.cjs`.
 */

/** The message a developer sees the moment they type the banned pattern. */
const NO_ENV_FALLBACK =
  'BANNED: a fallback value for an environment variable. ' +
  '`process.env.X || "default"` (or `?? "default"`) lets the application ' +
  'BOOT SUCCESSFULLY WHILE MISCONFIGURED. It will then sign real user ' +
  'tokens with a known development secret, or connect to the wrong ' +
  'database, and nobody finds out until the breach. ' +
  'Instead: declare the variable in `src/config/env.validation.ts` as ' +
  '`.required()` with NO `.default()`, expose it through ' +
  '`src/config/configuration.ts`, and read it with ' +
  '`config.getOrThrow(...)`. Fail fast at boot, never fall back at runtime.';

/** Same failure mode, one layer up: a default on the ConfigService read. */
const NO_CONFIG_FALLBACK =
  'BANNED: a fallback value on a ConfigService read. ' +
  '`config.get("x") || "default"` and `config.get("x", "default")` ' +
  'reintroduce exactly the hole that `env.validation.ts` exists to close — ' +
  'the process boots half-configured instead of refusing to start. ' +
  'Use `config.getOrThrow<T>("x")`.';

/** Reading raw `process.env` outside the config layer. */
const NO_RAW_ENV =
  'Read configuration through `ConfigService.getOrThrow()`, not raw ' +
  '`process.env`. Raw access bypasses the Joi schema in ' +
  '`src/config/env.validation.ts`, which is the only thing guaranteeing ' +
  'the value exists and is well-formed. Direct `process.env` access is ' +
  'permitted ONLY inside `src/config/**` (and test/tooling files).';

/**
 * `process.env.FOO` parses as:
 *   MemberExpression {
 *     object:   MemberExpression { object: `process`, property: `env` },
 *     property: `FOO`
 *   }
 * so the selectors below key off `object.object.name` + `object.property.name`.
 * `TSAsExpression` variants catch `process.env.PORT as string || '4000'`.
 */
const BANNED_SYNTAX = [
  // ── process.env.X || 'fallback' ──────────────────────────────────────
  {
    selector:
      'LogicalExpression[operator="||"] > MemberExpression.left[object.object.name="process"][object.property.name="env"]',
    message: NO_ENV_FALLBACK,
  },
  // ── process.env.X ?? 'fallback' ──────────────────────────────────────
  {
    selector:
      'LogicalExpression[operator="??"] > MemberExpression.left[object.object.name="process"][object.property.name="env"]',
    message: NO_ENV_FALLBACK,
  },
  // ── (process.env.X as string) || 'fallback' ──────────────────────────
  {
    selector:
      'LogicalExpression[operator="||"] > TSAsExpression.left > MemberExpression[object.object.name="process"][object.property.name="env"]',
    message: NO_ENV_FALLBACK,
  },
  {
    selector:
      'LogicalExpression[operator="??"] > TSAsExpression.left > MemberExpression[object.object.name="process"][object.property.name="env"]',
    message: NO_ENV_FALLBACK,
  },
  // ── process.env.X ||= 'fallback' / ??= 'fallback' ────────────────────
  {
    selector:
      'AssignmentExpression[operator="||="] > MemberExpression.left[object.object.name="process"][object.property.name="env"]',
    message: NO_ENV_FALLBACK,
  },
  {
    selector:
      'AssignmentExpression[operator="??="] > MemberExpression.left[object.object.name="process"][object.property.name="env"]',
    message: NO_ENV_FALLBACK,
  },
  // ── process.env.X ? process.env.X : 'fallback' ───────────────────────
  {
    selector:
      'ConditionalExpression > MemberExpression.test[object.object.name="process"][object.property.name="env"]',
    message: NO_ENV_FALLBACK,
  },

  // ── config.get('x') || 'fallback'  /  this.config.get('x') ?? 'y' ────
  {
    selector:
      'LogicalExpression > CallExpression.left[callee.property.name="get"][callee.object.name=/^(config|configService)$/i]',
    message: NO_CONFIG_FALLBACK,
  },
  {
    selector:
      'LogicalExpression > CallExpression.left[callee.property.name="get"][callee.object.property.name=/^(config|configService)$/i]',
    message: NO_CONFIG_FALLBACK,
  },
  // ── config.get('x', 'fallback') — the defaultValue overload ──────────
  {
    selector:
      'CallExpression[callee.property.name="get"][callee.object.name=/^(config|configService)$/i][arguments.length>1]',
    message: NO_CONFIG_FALLBACK,
  },
  {
    selector:
      'CallExpression[callee.property.name="get"][callee.object.property.name=/^(config|configService)$/i][arguments.length>1]',
    message: NO_CONFIG_FALLBACK,
  },
];

module.exports = {
  root: true,

  env: {
    node: true,
    es2022: true,
    jest: true,
  },

  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },

  extends: ['eslint:recommended'],

  ignorePatterns: [
    'dist',
    'build',
    '.next',
    'coverage',
    'node_modules',
    '*.js.map',
  ],

  rules: {
    // ★ THE ZERO-HARDCODED-CREDENTIALS GATE ★
    'no-restricted-syntax': ['error', ...BANNED_SYNTAX],

    // Raw process.env is confined to the config layer (relaxed below).
    'no-restricted-properties': [
      'error',
      { object: 'process', property: 'env', message: NO_RAW_ENV },
    ],

    // Defence in depth: nothing may reach into a `.env` file directly.
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'dotenv',
            message:
              'Do not load dotenv directly. `ConfigModule.forRoot()` loads ' +
              '.env and validates it against the Joi schema first.',
          },
        ],
      },
    ],

    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-var': 'error',
    'prefer-const': 'error',
  },

  overrides: [
    // ── TypeScript ─────────────────────────────────────────────────────
    {
      files: ['**/*.ts', '**/*.tsx'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: [
        'plugin:@typescript-eslint/recommended',
        // Must stay LAST: disables every stylistic rule Prettier owns.
        'eslint-config-prettier',
      ],
      rules: {
        // `any` erases the type system exactly where it is load-bearing —
        // request payloads and JWT claims.
        '@typescript-eslint/no-explicit-any': 'error',
        // @ts-ignore silences the compiler without leaving a reason behind.
        '@typescript-eslint/ban-ts-comment': [
          'error',
          {
            'ts-ignore': true,
            'ts-nocheck': true,
            'ts-expect-error': 'allow-with-description',
            minimumDescriptionLength: 10,
          },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
          },
        ],
        '@typescript-eslint/no-non-null-assertion': 'error',
        // TypeScript resolves globals and types; ESLint's own resolver does not.
        'no-undef': 'off',
        'no-unused-vars': 'off',
      },
    },

    // ── The config layer is the ONE place raw process.env is legitimate ─
    //    (the `||` / `??` fallback ban above is NOT relaxed here — it is
    //     absolute, everywhere, including this directory.)
    {
      files: [
        '**/src/config/**/*.ts',
        '**/src/database/seeds/**/*.ts',
        '**/test/**/*.ts',
        '**/*.spec.ts',
        '**/*.e2e-spec.ts',
        '**/*.config.js',
        '**/*.config.ts',
        '**/*.config.mjs',
        '**/*.config.cjs',
        '**/next.config.*',
        '**/jest.config.*',
        '**/.eslintrc.cjs',
      ],
      rules: {
        'no-restricted-properties': 'off',
      },
    },

    // Decorator-heavy Nest/Mongoose classes declare fields without an
    // initializer on purpose; that is not an unused variable.
    {
      files: ['**/*.schema.ts', '**/*.dto.ts', '**/*.entity.ts'],
      rules: {
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
  ],
};
