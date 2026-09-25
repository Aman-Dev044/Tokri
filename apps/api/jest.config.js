/* eslint-env node */
/**
 * Unit-test configuration (`pnpm test`).
 *
 * Unit specs are fast and dependency-free: no database, no Nest container,
 * no network. Anything that needs a real MongoDB replica set belongs in
 * `test/integration` and runs under `test/jest-integration.json`
 * (`pnpm test:integration`), because those specs take tens of seconds and
 * must not slow down the inner development loop.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'test/unit/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: false },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@database/(.*)$': '<rootDir>/src/database/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/database/seeds/**',
  ],
  coverageDirectory: 'coverage',
  clearMocks: true,
};
