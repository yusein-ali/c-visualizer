import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createContext, runInContext } from 'vm';
import { Response, Server } from '../src/core';
import {
  argumentSlots,
  directivesOf,
  formatPrintf,
  parseFormat,
  PrintfArgument,
} from '../src/interpreter/printf';
import { CStdio, STDIO_API_VERSION } from '../src/stdio';

/**
 * The parity table, `test/fixtures/stdio-parity.json`: one set of formats,
 * arguments and expected text, run through every path that formats - the
 * formatter itself, the interpreter's `printf`, and the `c-stdio.js` a course
 * page loads - so the three cannot drift apart.
 */

interface ParityCase {
  format: string;
  args: PrintfArgument[];
  expected: string;
  diagnostics?: string[];
  /** False when the case cannot be written as a program this engine runs. */
  engine?: boolean;
  why?: string;
  defect?: string;
}

const table: { version: number; cases: ParityCase[] } = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'stdio-parity.json'), 'utf8')
);

const rulesOf = (diagnostics: { rule: string }[]): string[] =>
  diagnostics.map((diagnostic) => diagnostic.rule).sort();

const labelled = table.cases.map(
  (one, index) =>
    [`${index}: ${JSON.stringify(one.format)}`, one] as [string, ParityCase]
);

it('is a table worth having', () => {
  expect(table.version).toBe(1);
  const conversions = new Set(
    table.cases.flatMap((one) =>
      directivesOf(parseFormat(one.format)).map((d) => d.conversion)
    )
  );
  for (const conversion of 'diuoxXeEfFgGaAcspn%') {
    expect(conversions).toContain(conversion);
  }
  const lengths = new Set(
    table.cases.flatMap((one) =>
      directivesOf(parseFormat(one.format)).map((d) => d.length)
    )
  );
  for (const length of ['hh', 'h', 'l', 'll', 'j', 'z', 't']) {
    expect(lengths).toContain(length);
  }
  // Every case the engine skips says why.
  for (const one of table.cases.filter((c) => c.engine === false)) {
    expect(one.why).toBeTruthy();
  }
});

describe('formatPrintf', () => {
  it.each(labelled)('%s', (_label, one) => {
    const result = formatPrintf(one.format, one.args);
    expect(result.text).toBe(one.expected);
    expect(rulesOf(result.diagnostics)).toEqual(
      [...(one.diagnostics ?? [])].sort()
    );
  });
});

/** A C string literal for text the table holds. */
const cString = (text: string): string => {
  // The engine's escape handling turns a lone backslash into a slash, so the
  // table keeps clear of them rather than testing that.
  if (text.indexOf('\\') !== -1) {
    throw new Error(`no backslashes in the parity table: ${text}`);
  }
  return `"${text
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}"`;
};

/**
 * A C expression for a double, including the values C has no literal for.
 *
 * Negative values are spelled with a binary minus: the engine's unary minus
 * leaves a floating-point operand as it is (unicoen's `execUnaryOp` compares
 * the value with the string 'number'), which is a defect of its own and not
 * what this table is about.
 */
const cDouble = (value: number | string): string => {
  switch (String(value).toLowerCase()) {
    case 'inf':
      return '(1e308 * 10.0)';
    case '-inf':
      return '((0.0 - 1e308) * 10.0)';
    case 'nan':
      return '(1e308 * 10.0 - 1e308 * 10.0)';
    default: {
      const number = Number(value);
      if (Object.is(number, -0)) {
        return '((0.0 - 1.0) * 0.0)';
      }
      return number < 0 ? `(0.0 - ${String(-number)})` : String(number);
    }
  }
};

const cChar = (value: number | string): string =>
  typeof value === 'string' && /^[A-Za-z0-9 !#-&(-[\]-~]$/.test(value)
    ? `'${value}'`
    : String(typeof value === 'string' ? value.charCodeAt(0) : value);

const cArgument = (argument: PrintfArgument): string => {
  switch (argument.kind) {
    case 'string':
      return cString(String(argument.value));
    case 'double':
      return cDouble(argument.value);
    case 'char':
      return cChar(argument.value);
    default:
      if (typeof argument.value !== 'number') {
        throw new Error(`a program cannot spell ${argument.value} here`);
      }
      return String(argument.value);
  }
};

/** Where each case's call sits, to match its diagnostics to it. */
interface Program {
  text: string;
  lines: Map<number, number>;
}

/**
 * Every engine case as one program, each call followed by a marker so the
 * output can be cut back into cases. `defect` is declared first, which puts
 * it at the address the two defect cases print: the old wrapper turned any
 * argument equal to the address of a live `char` into that string.
 */
const program = (cases: [number, ParityCase][]): Program => {
  const declarations = ["  char defect = 'A';"];
  const statements: string[] = ['  printf("%p<<prelude>>", &defect);'];
  const lines = new Map<number, number>();
  for (const [index, one] of cases) {
    const args: string[] = [];
    let next = 0;
    for (const directive of directivesOf(parseFormat(one.format))) {
      for (const slot of argumentSlots(directive)) {
        if (one.args.length <= next) {
          break;
        }
        if (slot === 'value' && directive.conversion === 'n') {
          declarations.push(`  int counted${index} = 0;`);
          args.push(`&counted${index}`);
        } else {
          args.push(cArgument(one.args[next]));
        }
        next += 1;
      }
    }
    statements.push(
      `  printf(${[cString(one.format), ...args].join(', ')});`,
      `  printf("<<${index}>>");`
    );
    lines.set(index, statements.length - 2);
  }
  const head = ['#include <stdio.h>', 'int main(void) {', ...declarations];
  return {
    text: [...head, ...statements, '  return 0;', '}', ''].join('\n'),
    // One-based, as the interpreter counts: statement k follows the head.
    lines: new Map(
      Array.from(lines.entries()).map(([index, statement]) => [
        index,
        head.length + statement + 1,
      ])
    ),
  };
};

const quiet = async <T>(run: () => Promise<T>): Promise<T> => {
  const logged = console.log;
  console.log = () => undefined;
  try {
    return await run();
  } finally {
    console.log = logged;
  }
};

/** Runs a program to its end through the session the Worker drives. */
const execute = async (code: string): Promise<Response> => {
  const server = new Server();
  const finished = new Promise<Response>((resolve) => {
    server.onRunEvent = (_event, response) => resolve(response);
  });
  await quiet(() =>
    server.send({
      controlEvent: 'Exec',
      sourcecode: code,
      files: [{ path: 'main.c', text: code }],
      entry: 'main.c',
    })
  );
  return quiet(() => finished);
};

describe("the interpreter's printf", () => {
  const cases = table.cases
    .map((one, index) => [index, one] as [number, ParityCase])
    .filter(([, one]) => one.engine !== false);
  const built = program(cases);
  let response: Response;
  let outputs: Map<number, string>;

  beforeAll(async () => {
    response = await execute(built.text);
    outputs = new Map();
    const pattern = /<<(\d+|prelude)>>/g;
    let start = 0;
    let found = pattern.exec(response.output);
    while (found !== null) {
      const key = found[1] === 'prelude' ? -1 : Number(found[1]);
      outputs.set(key, response.output.slice(start, found.index));
      start = found.index + found[0].length;
      found = pattern.exec(response.output);
    }
  }, 30000);

  it('runs the whole table to the end', () => {
    expect(response.debugState).toBe('EOF');
    expect(outputs.size).toBe(cases.length + 1);
  });

  it('puts the char the defect cases name where they name it', () => {
    expect(outputs.get(-1)).toBe('0xc352');
  });

  it.each(cases.map(([index, one]) => [labelled[index][0], index, one]))(
    '%s',
    (_label, index, one) => {
      const caseIndex = index as number;
      const expected = (one as ParityCase).expected;
      expect(outputs.get(caseIndex)).toBe(expected);
      const line = built.lines.get(caseIndex);
      const said = (response.runtime ?? []).filter(
        (diagnostic) => diagnostic.line === line
      );
      expect(rulesOf(said)).toEqual(
        [...((one as ParityCase).diagnostics ?? [])].sort()
      );
    }
  );
});

describe('c-stdio', () => {
  it('publishes the API on window from its entry', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../src/stdio.entry');
    });
    const scope = window as unknown as {
      CStdio: CStdio;
      CStdioReady: Promise<CStdio>;
    };
    expect(scope.CStdio.version).toBe(STDIO_API_VERSION);
    expect(Object.keys(scope.CStdio).sort()).toEqual([
      'argumentSlots',
      'explainDirective',
      'formatPrintf',
      'parseFormat',
      'parseScanFormat',
      'scanAll',
      'version',
    ]);
    return expect(scope.CStdioReady).resolves.toBe(scope.CStdio);
  });

  describe('the additions to version 1', () => {
    let api: CStdio;
    beforeAll(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../src/stdio.entry');
      });
      api = (window as unknown as { CStdio: CStdio }).CStdio;
    });

    it('says which arguments each printf directive consumes', () => {
      const slotsOf = (format: string) =>
        api
          .parseFormat(format)
          .flatMap((segment) =>
            segment.kind === 'directive' ? [api.argumentSlots(segment)] : []
          );
      expect(slotsOf('%*.*f|%-*d|%.*s|%%|%q|%d')).toEqual([
        ['width', 'precision', 'value'],
        ['width', 'value'],
        ['precision', 'value'],
        [],
        [],
        ['value'],
      ]);
    });

    it('numbers the arguments as formatPrintf consumes them', () => {
      const format = '%*.*f %d %% %.*s';
      let next = 0;
      const expected = api
        .parseFormat(format)
        .flatMap((segment) =>
          segment.kind === 'directive' ? [api.argumentSlots(segment)] : []
        )
        .map((slots) => {
          const taken: Record<string, number> = {};
          for (const slot of slots) {
            taken[slot] = next;
            next += 1;
          }
          return taken;
        });
      const result = api.formatPrintf(format, [
        { kind: 'int', value: 8 },
        { kind: 'int', value: 2 },
        { kind: 'double', value: 3.14159 },
        { kind: 'int', value: 7 },
        { kind: 'int', value: 2 },
        { kind: 'string', value: 'hello' },
      ]);
      expect(result.text).toBe('    3.14 7 % he');
      expect(
        result.directives.map((one) => {
          const taken: Record<string, number> = {};
          if (one.widthArgument !== null) taken.width = one.widthArgument;
          if (one.precisionArgument !== null)
            taken.precision = one.precisionArgument;
          if (one.argument !== null) taken.value = one.argument;
          return taken;
        })
      ).toEqual(expected);
    });

    it('splits a scanf format where the scan splits it, with offsets', () => {
      const format = 'x=%d, %*5[^,;]%lf%%%q %';
      const directives = api.parseScanFormat(format);
      expect(
        directives.map((one) => [one.kind, one.source, one.start, one.end])
      ).toEqual([
        ['literal', 'x=', 0, 2],
        ['conversion', '%d', 2, 4],
        ['literal', ',', 4, 5],
        ['space', ' ', 5, 6],
        ['conversion', '%*5[^,;]', 6, 14],
        ['conversion', '%lf', 14, 17],
        ['conversion', '%%', 17, 19],
        ['invalid', '%', 19, 20],
        ['literal', 'q', 20, 21],
        ['space', ' ', 21, 22],
        ['invalid', '%', 22, 23],
      ]);
      expect(directives[4]).toMatchObject({
        suppress: true,
        width: 5,
        length: '',
        spec: '[',
        scanset: { negated: true, members: ',;', closed: true },
      });
      expect(directives[5]).toMatchObject({ length: 'l', spec: 'f' });
      expect(directives[7]).toMatchObject({ written: '%q', spec: 'q' });
      expect(directives[10]).toMatchObject({ written: '%', spec: '' });
      for (const one of directives) {
        expect(format.slice(one.start, one.end)).toBe(one.source);
      }
    });

    it('names a failing directive by the source the splitter gives it', () => {
      const format = '%d %5[a-z] %c';
      const sources = api
        .parseScanFormat(format)
        .filter((one) => one.kind === 'conversion')
        .map((one) => one.source);
      expect(api.scanAll(format, '12 345').failure?.directive).toBe(sources[1]);
    });
  });

  const bundle = join(__dirname, '..', 'dist', 'embed', 'c-stdio.js');
  const built = existsSync(bundle);
  if (!built) {
    it.skip('runs the parity table through the built c-stdio.js (run `npm run deploy:debug` to build dist/embed/c-stdio.js)', () =>
      undefined);
    return;
  }

  it('runs the parity table through the built c-stdio.js', async () => {
    const sandbox: Record<string, any> = {};
    sandbox.window = sandbox;
    createContext(sandbox);
    runInContext(readFileSync(bundle, 'utf8'), sandbox);
    const api: CStdio = await sandbox.CStdioReady;
    expect(api.version).toBe(STDIO_API_VERSION);
    const failures = table.cases
      .map((one, index) => {
        const result = api.formatPrintf(one.format, one.args);
        return {
          index,
          format: one.format,
          expected: one.expected,
          got: result.text,
          rules: rulesOf(result.diagnostics),
          wanted: [...(one.diagnostics ?? [])].sort(),
        };
      })
      .filter(
        (one) =>
          one.got !== one.expected ||
          JSON.stringify(one.rules) !== JSON.stringify(one.wanted)
      );
    expect(failures).toEqual([]);
    expect(api.scanAll('%d %d', '7 x')).toMatchObject({
      returns: 1,
      rest: 'x',
      failure: { directive: '%d', found: '"x"' },
    });
    expect(api.parseScanFormat('%d %s').map((one) => one.kind)).toEqual([
      'conversion',
      'space',
      'conversion',
    ]);
    const [star] = api
      .parseFormat('%*d')
      .filter((segment) => segment.kind === 'directive');
    expect(api.argumentSlots(star as never)).toEqual(['width', 'value']);
  });

  it('ships the same parity table the tests read', () => {
    const shipped = join(
      __dirname,
      '..',
      'dist',
      'embed',
      'c-stdio.parity.json'
    );
    expect(JSON.parse(readFileSync(shipped, 'utf8'))).toEqual(table);
  });
});
