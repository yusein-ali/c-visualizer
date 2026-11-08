import { readFileSync } from 'fs';
import { libraryHelp, libraryNames } from '../src/app/libraryHelp';
import {
  LIBRARY_MANIFEST_VERSION,
  LibraryManifest,
  libraryManifest,
  libraryManifestText,
} from '../src/app/libraryManifest';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { PREDEFINED_MACRO_NAMES } from '../src/interpreter/preprocess';
import { REFUSED_CONSTRUCTS } from '../src/interpreter/refused';
import { outputOf } from './library';

/**
 * V0: the library table is the callable set, and `library.json` is the
 * table. A name the engine registers that the table leaves out is a function
 * the course's lint would refuse although it runs; an entry with nothing
 * registered behind it is one the lint would allow although it fails at run
 * time. Both fail here, naming the function.
 */

/**
 * Registered with the engine but not part of the library a program calls.
 * Each needs a reason.
 */
const ENGINE_INTERNAL: Record<string, string> = {
  // An operator. Upstream implements it as a function registered under its
  // name; the table documents it, as kind `operator`, for hover help, and the
  // manifest leaves operators out.
  sizeof: 'operator',
};

/**
 * The names a running engine knows: everything registered into the global
 * scope - functions, the object-like macros (system variables), the record
 * types and typedefs - and the macros the preprocessor predefines.
 *
 * `stdin`, `stdout`, `stderr` and `errno` are registered only for a program
 * that names them, so that a program that does not is not drawn carrying
 * them; this one names all four.
 */
const registeredNames = (): Set<string> => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  try {
    interpreter.startStepExecution(`#include <stdio.h>
#include <errno.h>
int main(void) {
  FILE *streams[3];
  streams[0] = stdin;
  streams[1] = stdout;
  streams[2] = stderr;
  errno = 0;
  return 0;
}`);
  } finally {
    console.log = log;
  }
  const global = (
    interpreter as unknown as {
      plivetEngine: {
        globalScope: {
          variableAddress: Map<string, number>;
          typedefList: Map<string, string>;
        };
      };
    }
  ).plivetEngine.globalScope;
  return new Set([
    ...global.variableAddress.keys(),
    ...global.typedefList.keys(),
    ...PREDEFINED_MACRO_NAMES,
  ]);
};

const manifestNames = (manifest: LibraryManifest): string[] => [
  ...manifest.functions.map((entry) => entry.name),
  ...manifest.macros.map((entry) => entry.name),
  ...manifest.objects.map((entry) => entry.name),
  ...manifest.types.map((entry) => entry.name),
];

describe('the library table against a running engine', () => {
  const registered = registeredNames();
  const manifest = libraryManifest();
  const listed = new Set(manifestNames(manifest));

  it('documents every name the engine registers', () => {
    const undocumented = Array.from(registered)
      .filter(
        (name) =>
          !Object.prototype.hasOwnProperty.call(ENGINE_INTERNAL, name) &&
          !listed.has(name)
      )
      .sort();
    expect(undocumented).toEqual([]);
  });

  it('lists nothing the engine does not register', () => {
    // Types are checked by a program below: the scalar typedefs and `FILE`
    // are type names to the parser rather than entries in a scope.
    const unregistered = [
      ...manifest.functions,
      ...manifest.macros,
      ...manifest.objects,
    ]
      .map((entry) => entry.name)
      .filter((name) => !registered.has(name))
      .sort();
    expect(unregistered).toEqual([]);
  });

  it('keeps each engine-internal name out of the manifest, and only those', () => {
    for (const name of Object.keys(ENGINE_INTERNAL)) {
      expect(registered.has(name)).toBe(true);
      expect(listed.has(name)).toBe(false);
    }
  });

  it('accepts a declaration of every type it lists', async () => {
    const declarations = manifest.types
      .map((type, i) => `  ${type.name} *p${i} = 0;\n  n += p${i} == 0;`)
      .join('\n');
    expect(
      await outputOf(`#include <stdio.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdlib.h>
#include <time.h>
int main(void) {
  int n = 0;
${declarations}
  printf("%d\\n", n);
  return 0;
}`)
    ).toBe(`${manifest.types.length}\n`);
  });
});

describe('the library table', () => {
  it('gives every entry but an operator a header', () => {
    const headless = libraryNames().filter((name) => {
      const entry = libraryHelp(name)!;
      return entry.kind !== 'operator' && typeof entry.header === 'undefined';
    });
    expect(headless).toEqual([]);
  });

  it('marks the macros called like functions', () => {
    const functionLike = libraryNames().filter(
      (name) => libraryHelp(name)!.functionLike === true
    );
    expect(functionLike.sort()).toEqual([
      'assert',
      'isfinite',
      'isinf',
      'isnan',
      'offsetof',
      'signbit',
      'va_arg',
      'va_copy',
      'va_end',
      'va_start',
    ]);
    for (const name of functionLike) {
      expect(libraryHelp(name)!.kind).toBe('macro');
    }
  });
});

describe('library.json', () => {
  const manifest = libraryManifest();

  it('has the version and the five lists, and nothing else', () => {
    expect(manifest.version).toBe(1);
    expect(LIBRARY_MANIFEST_VERSION).toBe(1);
    expect(Object.keys(manifest)).toEqual([
      'version',
      'functions',
      'macros',
      'objects',
      'types',
      'refused',
    ]);
  });

  it('gives each entry its fields and no others', () => {
    for (const list of [manifest.functions, manifest.objects, manifest.types]) {
      for (const entry of list) {
        expect(Object.keys(entry)).toEqual(['name', 'header', 'signature']);
        expect(entry.header).toMatch(/^[a-z]+\.h$/);
        expect(entry.signature).toContain(entry.name);
      }
    }
    for (const entry of manifest.macros) {
      expect(Object.keys(entry)).toEqual([
        'name',
        'header',
        'signature',
        'functionLike',
      ]);
      expect(typeof entry.functionLike).toBe('boolean');
      expect(entry.signature.startsWith('#define ')).toBe(!entry.functionLike);
    }
    for (const entry of manifest.refused) {
      expect(Object.keys(entry)).toEqual([
        'id',
        'construct',
        'pattern',
        'message',
      ]);
    }
  });

  it('sorts every list in code-point order, with no name twice', () => {
    const sorted = (names: string[]) =>
      [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const list of [
      manifest.functions,
      manifest.macros,
      manifest.objects,
      manifest.types,
    ]) {
      const names = list.map((entry) => entry.name);
      expect(names).toEqual(sorted(names));
    }
    const ids = manifest.refused.map((entry) => entry.id);
    expect(ids).toEqual(sorted(ids));
    const all = manifestNames(manifest);
    expect(new Set(all).size).toBe(all.length);
  });

  it('files each kind of name in its own list', () => {
    const names = (list: { name: string }[]) => list.map((entry) => entry.name);
    expect(names(manifest.functions)).toEqual(
      expect.arrayContaining(['printf', 'malloc', 'strlen', 'qsort', 'sqrt'])
    );
    expect(names(manifest.functions)).not.toContain('sizeof');
    expect(names(manifest.functions)).not.toContain('assert');
    expect(names(manifest.macros)).toEqual(
      expect.arrayContaining(['EOF', 'NULL', 'INT_MAX', 'true', 'assert'])
    );
    expect(names(manifest.objects)).toEqual([
      'errno',
      'stderr',
      'stdin',
      'stdout',
    ]);
    expect(names(manifest.types)).toEqual(
      expect.arrayContaining(['FILE', 'size_t', 'va_list', 'div_t'])
    );
    expect(manifest.functions.find((entry) => entry.name === 'printf')).toEqual(
      {
        name: 'printf',
        header: 'stdio.h',
        signature: 'int printf(const char* format, ...)',
      }
    );
  });

  it('carries the refused-construct list', () => {
    expect(manifest.refused).toEqual(
      [...REFUSED_CONSTRUCTS].sort((a, b) => (a.id < b.id ? -1 : 1))
    );
  });

  it('is the same text every time it is generated', () => {
    expect(libraryManifestText()).toBe(libraryManifestText());
    expect(libraryManifestText().endsWith('}\n')).toBe(true);
    expect(JSON.parse(libraryManifestText())).toEqual(manifest);
  });

  it('is what the deploy writes, through the Node loader', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { generateLibraryManifest } = require('../scripts/library-manifest');
    const { text, files } = generateLibraryManifest() as {
      text: string;
      files: string[];
    };
    expect(text).toBe(libraryManifestText());
    expect(files.some((file) => file.endsWith('libraryHelp.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('refused.ts'))).toBe(true);
  });

  it('is emitted by both deploy configurations', () => {
    const config = readFileSync(
      `${__dirname}/../webpack.config.deploy.js`,
      'utf8'
    );
    expect(config).toContain("'library.json'");
  });
});
