import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';
import ts from 'typescript';

// Path aliases (e.g. the ones added by `nest g library`) live in tsconfig.json,
// so they are read from there instead of being duplicated here.
const { config: tsconfig } = ts.readConfigFile(
  './tsconfig.json',
  ts.sys.readFile,
);
const paths = tsconfig?.compilerOptions?.paths ?? {};

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  // @nestjs packages ship as pure ESM with no CommonJS build. Rather than
  // transpiling them down (fragile, and defeats native `import`), run our
  // own test files as real ESM too (via --experimental-vm-modules, set in
  // the npm scripts) so Jest loads everything through one consistent
  // module graph.
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    // tsconfig.json's "module": "nodenext" defers to the nearest
    // package.json's "type" field per file, which is unset here (the app
    // itself stays CommonJS - Nest's webpack build doesn't care either
    // way), so it would silently keep emitting CJS `exports.x = ...`
    // despite useESM. Override just for the test transform so ts-jest
    // actually emits real `import`/`export` syntax.
    '^.+\\.(t|j)s$': ['ts-jest', { useESM: true, tsconfig: { module: 'ESNext' } }],
  },
  moduleNameMapper: {
    // Allow relative imports written with an explicit `.js` extension
    // (the NodeNext convention) to resolve back to their `.ts` source.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    ...pathsToModuleNameMapper(paths, { prefix: '<rootDir>/' }),
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    'libs/**/*.(t|j)s',
    'apps/**/*.(t|j)s',
  ],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};

export default config;
