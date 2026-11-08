import { CellModel, Response, Server, StepModel } from '../src/core';
import { programArgumentsOf } from '../src/core/server';
import { joinArgs, splitArgs } from '../src/app/programArgs';

/**
 * L16: `int main(int argc, char *argv[])` receives the program's arguments.
 * Programs run as the page runs them - through a `Server` - with the
 * arguments on the request, and the canvas is read from the model the run
 * left.
 */

const quiet = async <T>(work: () => Promise<T>): Promise<T> => {
  const logged = console.log;
  console.log = () => undefined;
  try {
    return await work();
  } finally {
    console.log = logged;
  }
};

const run = async (
  code: string,
  args?: string[],
  entry = 'main.c'
): Promise<Response> => {
  const server = new Server();
  const finished = new Promise<Response>((resolve) => {
    server.onRunEvent = (_event, response) => resolve(response);
  });
  return quiet(async () => {
    const started = await server.send({
      controlEvent: 'Exec',
      sourcecode: code,
      files: [{ path: entry, text: code }],
      entry,
      ...(typeof args === 'undefined' ? {} : { args }),
    });
    return started.debugState === 'Executing' ? finished : started;
  });
};

const outputOf = async (
  code: string,
  args?: string[],
  entry?: string
): Promise<string> => {
  const response = await run(code, args, entry);
  const fatal = (response.runtime ?? []).filter((one) => one.fatal);
  if (fatal.length > 0 || response.errors.length > 0) {
    throw new Error(
      `the program did not run clean: ${JSON.stringify(
        fatal.concat(response.errors as never[])
      )}\n${response.output}`
    );
  }
  return response.output;
};

const program = (signature: string, body: string): string => `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(${signature}) {
${body}
  return 0;
}`;

const rowsOf = (model: StepModel): CellModel[][] =>
  model.stacks.flatMap((stack) => stack.rows);

const rowNamed = (model: StepModel, name: string): CellModel[] | undefined =>
  rowsOf(model).find((cells) =>
    cells.some((cell) => cell.kind === 'name' && cell.text === name)
  );

const textOf = (row: CellModel[] | undefined, kind: string): string | null =>
  row?.find((cell) => cell.kind === kind)?.text ?? null;

describe('main(int argc, char *argv[])', () => {
  it('counts argv[0] and the arguments, and ends argv with a null pointer', async () => {
    expect(
      await outputOf(
        program(
          'int argc, char *argv[]',
          `  printf("%d %s %d\\n", argc, argv[0], argv[argc] == NULL);`
        ),
        ['one', 'two']
      )
    ).toBe('3 main 1\n');
  });

  it('loops over argc', async () => {
    expect(
      await outputOf(
        program(
          'int argc, char *argv[]',
          `  for (int i = 0; i < argc; i++) {
    printf("[%d] %s\\n", i, argv[i]);
  }`
        ),
        ['input.txt', '-v', 'last word']
      )
    ).toBe('[0] main\n[1] input.txt\n[2] -v\n[3] last word\n');
  });

  it('reads characters with argv[i][j], and strlen and atoi read the strings', async () => {
    expect(
      await outputOf(
        program(
          'int argc, char *argv[]',
          `  printf("%c%c %d %d\\n", argv[1][0], argv[1][4], (int)strlen(argv[1]), atoi(argv[2]) * 2);
  printf("%d\\n", argv[1][5] == '\\0');`
        ),
        ['hello', '21']
      )
    ).toBe('ho 5 42\n1\n');
  });

  it('takes char **argv as well', async () => {
    expect(
      await outputOf(
        program(
          'int n, char **v',
          `  char **p = v + 1;
  printf("%d %s %s\\n", n, *p, v[n - 1]);`
        ),
        ['a', 'bc']
      )
    ).toBe('3 a bc\n');
  });

  it('lets the program write into an argument string', async () => {
    expect(
      await outputOf(
        program(
          'int argc, char *argv[]',
          `  argv[1][0] = 'J';
  printf("%s\\n", argv[1]);`
        ),
        ['jam']
      )
    ).toBe('Jam\n');
  });

  it('runs with argc 1 when no arguments are given', async () => {
    expect(
      await outputOf(
        program(
          'int argc, char *argv[]',
          `  printf("%d %s %d\\n", argc, argv[0], argv[1] == NULL);`
        )
      )
    ).toBe('1 main 1\n');
  });

  it('names argv[0] after the entry file', async () => {
    const code = program(
      'int argc, char *argv[]',
      '  printf("%s\\n", argv[0]);'
    );
    expect(await outputOf(code, [], 'src/hello.c')).toBe('hello\n');
  });

  it('ignores the arguments in a main without parameters', async () => {
    const response = await run(program('void', '  printf("ok\\n");'), [
      'ignored',
    ]);
    expect(response.output).toBe('ok\n');
    expect(rowNamed(response.model, '_argv')).toBeUndefined();
  });

  it('draws the strings and the array of pointers in the data segment', async () => {
    const response = await run(
      program('int argc, char *argv[]', '  int seen = argc;'),
      ['hi']
    );
    const { model } = response;
    const data = model.memory.find((segment) => segment.key === 'data')!;
    const names = data.rows.flatMap((row) =>
      row.filter((cell) => cell.kind === 'name').map((cell) => cell.text)
    );
    expect(names).toEqual(
      expect.arrayContaining([
        '_argv',
        '_argv[0]',
        '_argv[1]',
        '_argv[2]',
        '_argv_0',
        '_argv_1',
      ])
    );
    expect(textOf(rowNamed(model, '_argv'), 'type')).toBe('char*[3]');
    expect(textOf(rowNamed(model, '_argv_1'), 'type')).toBe('char[3]');
    expect(textOf(rowNamed(model, '_argv[2]'), 'value')).toBe('0x0');
    // argv's arrow lands on the array, and each element's on its string.
    const argv = rowNamed(model, 'argv')!;
    expect(textOf(argv, 'type')?.replace(/\s/g, '')).toBe('char**');
    const target = argv.find((cell) => cell.kind === 'value')?.pointerTarget;
    expect(target).toBeDefined();
    const element = rowNamed(model, '_argv[1]')!;
    const elementTarget = element.find(
      (cell) => cell.kind === 'value'
    )?.pointerTarget;
    expect(elementTarget).toBeDefined();
    expect(
      rowsOf(model).some((row) =>
        row.some((cell) => cell.key === elementTarget)
      )
    ).toBe(true);
  });
});

describe('the request', () => {
  it('builds argv from the entry and the arguments', () => {
    expect(
      programArgumentsOf({
        controlEvent: 'Start',
        sourcecode: '',
        entry: 'main.c',
        args: ['a', 'b c'],
      })
    ).toEqual(['main', 'a', 'b c']);
    expect(
      programArgumentsOf({ controlEvent: 'Start', sourcecode: '' })
    ).toEqual(['main']);
    expect(
      programArgumentsOf({
        controlEvent: 'Start',
        sourcecode: '',
        entry: 'lab/prog.c',
        args: [1 as unknown as string, 'x'],
      })
    ).toEqual(['prog', 'x']);
  });
});

describe('splitting an argument line', () => {
  it.each([
    ['', []],
    ['   ', []],
    ['one two  three', ['one', 'two', 'three']],
    ['"two words" plain', ['two words', 'plain']],
    ['\'single quoted\' "double"', ['single quoted', 'double']],
    ['a"b c"d', ['ab cd']],
    ['"" x', ['', 'x']],
    ['back\\ slash \\"q\\"', ['back slash', '"q"']],
    ['"in \\"double\\" \\\\ \\n"', ['in "double" \\ \\n']],
    ["'no \\escape'", ['no \\escape']],
    ['tab\tand\nnewline', ['tab', 'and', 'newline']],
    ['"unclosed quote', ['unclosed quote']],
  ])('splits %j as a shell would', (line, expected) => {
    expect(splitArgs(line)).toEqual(expected);
  });

  it('joins arguments back into a line that splits the same', () => {
    const args = ['plain', 'two words', '', "it's", 'say "hi"', 'back\\slash'];
    expect(splitArgs(joinArgs(args))).toEqual(args);
    expect(joinArgs(['a', 'b'])).toBe('a b');
  });
});
