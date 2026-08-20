module.exports = {
  roots: ['<rootDir>/test'],
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: {
    '\\.(css|less)$': 'identity-obj-proxy',
    // `spawnWorker` is one line of `import.meta`, which is module syntax the
    // CommonJS build these tests run under cannot express. Nothing under test
    // starts a Worker; anything that tried would get this instead.
    '/spawnWorker$': '<rootDir>/test/spawnWorker.stub.ts',
    // hashids' "main" is its ESM build, which Jest cannot parse. webpack
    // picks the browser/import build on its own; only Jest needs the CJS one.
    '^hashids$': 'hashids/cjs',
  },
};
