module.exports = {
  roots: ['<rootDir>/test'],
  globals: {
    'ts-jest': {
      tsConfig: 'tsconfig.test.json',
      diagnostics: {
        //NumericInput does not have any construct or call signatures.
        ignoreCodes: [2604],
      },
    },
  },
  transform: {
    '.*\\.tsx?$': 'ts-jest',
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
    // Same story: an ESM "main" with the CJS build reachable only through
    // the "exports" map, which Jest 26 does not read. @codemirror/state
    // pulls it in.
    '^@marijn/find-cluster-break$': '@marijn/find-cluster-break/dist/index.cjs',
  },
};
