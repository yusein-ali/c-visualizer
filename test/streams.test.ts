import { Response, RUN_EVENT, Server } from '../src/core';
import { scan, ScanResult } from '../src/interpreter/scanf';
import {
  ConsoleInput,
  FileStream,
  encodeText,
  parseMode,
} from '../src/interpreter/stream';

/**
 * `<stdio.h>` past `printf`: the standard streams as objects, end of input
 * from the console, standard error, and the files a program opens, writes,
 * moves and removes. Programs run the way the page runs them - through a
 * `Server`, with the console's answers sent as requests - so what is checked
 * is the whole path from the Request to the program's output.
 */

interface Answer {
  text?: string;
  end?: boolean;
}

interface Session {
  server: Server;
  event: RUN_EVENT;
  response: Response;
  output: string;
  /** The text of every span the program wrote to `stderr`. */
  errors: string[];
  rules: string[];
}

const quietly = async <T>(work: () => Promise<T>): Promise<T> => {
  const log = console.log;
  const error = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return await work();
  } finally {
    console.log = log;
    console.error = error;
  }
};

const bytes = (text: string): ArrayBuffer =>
  Uint8Array.from(text, (character) => character.charCodeAt(0)).buffer;

const text = (contents: ArrayBuffer | undefined): string | undefined =>
  typeof contents === 'undefined'
    ? undefined
    : String.fromCharCode(...new Uint8Array(contents));

/**
 * Runs a program with `Exec`, answering each read it stops at with the next
 * of `answers` - a line, an end of input, or text and then the end - the way
 * the console does: a `StepAll` carrying `stdinText` and `endOfInput`.
 */
const session = (
  code: string,
  answers: Answer[] = [],
  files: Map<string, ArrayBuffer> = new Map()
): Promise<Session> =>
  quietly(async () => {
    const server = new Server();
    server.setFiles(files);
    let arrive: (stop: { event: RUN_EVENT; response: Response }) => void = () =>
      undefined;
    const nextStop = () =>
      new Promise<{ event: RUN_EVENT; response: Response }>((resolve) => {
        arrive = resolve;
      });
    server.onRunEvent = (event, response) => arrive({ event, response });
    let stop = nextStop();
    const started = await server.send({
      controlEvent: 'Exec',
      sourcecode: code,
      files: [{ path: 'main.c', text: code }],
      entry: 'main.c',
    });
    if (started.debugState !== 'Executing') {
      throw new Error(`the program did not start: ${started.debugState}`);
    }
    let reached = await stop;
    for (const answer of answers) {
      if (reached.event !== 'stdin') {
        throw new Error(
          `the program ended before reading ${JSON.stringify(answer)}:\n` +
            reached.response.output
        );
      }
      stop = nextStop();
      await server.send({
        controlEvent: 'StepAll',
        sourcecode: code,
        stdinText: answer.text,
        ...(answer.end === true ? { endOfInput: true } : {}),
      });
      reached = await stop;
    }
    const { response } = reached;
    return {
      server,
      event: reached.event,
      response,
      output: response.output,
      errors: (response.errorSpans ?? []).map((span) =>
        response.output.slice(span.start, span.end)
      ),
      rules: (response.runtime ?? []).map((diagnostic) => diagnostic.rule),
    };
  });

const line = (value: string): Answer => ({ text: value });
const END: Answer = { end: true };

describe('EOF and the end of input', () => {
  it('ends the getchar loop every C course teaches', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  int c;
  int n = 0;
  while ((c = getchar()) != EOF) {
    n++;
  }
  printf("%d characters, EOF is %d, feof %d\\n", n, EOF, feof(stdin));
  return 0;
}`,
      [line('ab'), line('c'), END]
    );
    expect(run.event).toBe('EOF');
    // The two lines echo as typed; their newlines are characters too.
    expect(run.output).toBe('ab\nc\n5 characters, EOF is -1, feof 1\n');
  });

  it('ends the fgets loop with a null pointer', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  char buffer[8];
  int lines = 0;
  while (fgets(buffer, 8, stdin)) {
    lines++;
    printf("[%s]", buffer);
  }
  printf("\\n%d pieces\\n", lines);
  return 0;
}`,
      [line('hello world'), END]
    );
    // Seven characters at a time, then the rest of the line with its newline.
    expect(run.output).toBe('hello world\n[hello w][orld\n]\n2 pieces\n');
  });

  it('reads text given with the end before reporting the end', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  int c;
  while ((c = getchar()) != EOF) {
    putchar(c == 'x' ? 'X' : c);
  }
  puts("|done");
  return 0;
}`,
      [{ text: 'xyx', end: true }]
    );
    // No Enter after the text, so no newline in the echo or the input.
    expect(run.output).toBe('xyxXyX|done\n');
  });

  it('returns NULL from gets at the end of input', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  char name[16];
  char *got = gets(name);
  printf("%d\\n", got == NULL);
  return 0;
}`,
      [END]
    );
    expect(run.output).toBe('1\n');
  });

  it('makes scanf return EOF before its first conversion, and the count after it', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  int a = 0, b = 0;
  int first = scanf("%d %d", &a, &b);
  int second = scanf("%d", &a);
  printf("first=%d a=%d second=%d\\n", first, a, second);
  return 0;
}`,
      [line('7'), END, END]
    );
    expect(run.output).toBe('7\nfirst=1 a=7 second=-1\n');
  });

  it('lets a read after the end wait for new input', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  int c = getchar();
  int d = getchar();
  printf("%d %c\\n", c, d);
  return 0;
}`,
      [END, line('z')]
    );
    expect(run.output).toBe('z\n-1 z\n');
  });

  it('makes fscanf on stdin the same read as scanf', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  int n = 0;
  int sum = 0;
  while (fscanf(stdin, "%d", &n) == 1) {
    sum += n;
  }
  printf("sum %d\\n", sum);
  return 0;
}`,
      [line('1 2'), line('3'), END]
    );
    expect(run.output).toBe('1 2\n3\nsum 6\n');
  });

  it('pushes a character back with ungetc', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  int c = getchar();
  ungetc(c, stdin);
  int n = 0;
  scanf("%d", &n);
  printf("%c then %d\\n", c, n);
  return 0;
}`,
      [line('42')]
    );
    expect(run.output).toBe('42\n4 then 42\n');
  });
});

describe('the standard streams', () => {
  it('draws stdin, stdout and stderr as FILE * objects for a program that names them', async () => {
    const run = await session(`#include <stdio.h>
int main(void) {
  FILE *in = stdin;
  fputs("x", stdout);
  fputs("y", stderr);
  return 0;
}`);
    const globals = run.response.model.variables.filter(
      (variable) => variable.frame === 'GLOBAL'
    );
    expect(
      globals.map((variable) => [variable.name, variable.type, variable.region])
    ).toEqual([
      ['stdin', 'FILE*', 'data'],
      ['stdout', 'FILE*', 'data'],
      ['stderr', 'FILE*', 'data'],
    ]);
    const local = run.response.model.variables.find(
      (variable) => variable.name === 'in'
    );
    expect(local?.value).toBe(globals[0].value);
  });

  it('leaves them off the canvas of a program that does not', async () => {
    const run = await session(`#include <stdio.h>
int main(void) {
  printf("hi\\n");
  return 0;
}`);
    expect(
      run.response.model.variables.map((variable) => variable.name)
    ).toEqual([]);
  });

  it('marks what the program wrote to stderr, in order with stdout', async () => {
    const run = await session(`#include <stdio.h>
int main(void) {
  printf("one\\n");
  fprintf(stderr, "warning %d\\n", 2);
  fputc('!', stderr);
  printf("three\\n");
  fputs("four\\n", stderr);
  return 0;
}`);
    expect(run.output).toBe('one\nwarning 2\n!three\nfour\n');
    expect(run.errors).toEqual(['warning 2\n!', 'four\n']);
  });

  it('writes with puts, putchar and fprintf to stdout', async () => {
    const run = await session(`#include <stdio.h>
int main(void) {
  int a = puts("line");
  int b = putchar('c');
  int c = fprintf(stdout, "\\n%05.1f|%s\\n", 3.14159, "s");
  printf("%d %d %d\\n", a > 0, b, c);
  return 0;
}`);
    expect(run.output).toBe('line\nc\n003.1|s\n1 99 9\n');
    expect(run.errors).toEqual([]);
  });

  it('prints errno with perror, on stderr', async () => {
    const run = await session(`#include <stdio.h>
#include <errno.h>
int main(void) {
  FILE *f = fopen("missing.txt", "r");
  if (f == NULL) {
    perror("missing.txt");
    printf("errno %d\\n", errno == ENOENT);
  }
  perror(NULL);
  return 0;
}`);
    expect(run.output).toBe(
      'missing.txt: No such file or directory\nerrno 1\n' +
        'No such file or directory\n'
    );
    expect(run.errors).toEqual([
      'missing.txt: No such file or directory\n',
      'No such file or directory\n',
    ]);
  });

  it('refuses a stream that has been closed', async () => {
    const run = await session(`#include <stdio.h>
int main(void) {
  FILE *f = fopen("a.txt", "w");
  fclose(f);
  fputc('x', f);
  return 0;
}`);
    expect(run.rules).toContain('closed-stream');
  });

  it('refuses a null stream, and says to check fopen', async () => {
    const run = await session(`#include <stdio.h>
int main(void) {
  FILE *f = fopen("missing.txt", "r");
  int c = fgetc(f);
  return c;
}`);
    expect(run.rules).toContain('null-stream');
    expect(run.output).toContain('check what it returned');
  });
});

describe('files', () => {
  it('creates a file, which reaches the file system when it is closed', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  FILE *out = fopen("out.txt", "w");
  fprintf(out, "x=%d\\n", 42);
  fputs("end\\n", out);
  int wait = getchar();
  fclose(out);
  return 0;
}`,
      [],
      new Map()
    );
    // Stopped at the getchar: created and empty, its writes still buffered.
    expect(run.event).toBe('stdin');
    expect(text(run.server.fileSnapshot().get('out.txt'))).toBe('');

    const finished = await quietly(async () => {
      const stopped = new Promise<Response>((resolve) => {
        run.server.onRunEvent = (_event, response) => resolve(response);
      });
      await run.server.send({
        controlEvent: 'StepAll',
        sourcecode: '',
        stdinText: '',
      });
      return stopped;
    });
    expect(finished.debugState).toBe('EOF');
    expect(text(run.server.fileSnapshot().get('out.txt'))).toBe('x=42\nend\n');
  });

  it('flushes what is still open when the program ends', async () => {
    const run = await session(`#include <stdio.h>
int main(void) {
  FILE *out = fopen("left-open.txt", "w");
  fputs("kept", out);
  return 0;
}`);
    expect(text(run.server.fileSnapshot().get('left-open.txt'))).toBe('kept');
  });

  it('reads an uploaded file with fscanf, fgets and fgetc', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  FILE *in = fopen("data.txt", "r");
  int a = 0, b = 0;
  int r = fscanf(in, "%d %d", &a, &b);
  printf("r=%d a+b=%d at %ld\\n", r, a + b, ftell(in));
  char line[16];
  fgets(line, 16, in);
  fgets(line, 16, in);
  printf("[%s]", line);
  fgets(line, 16, in);
  printf("[%s] eof=%d\\n", line, feof(in));
  printf("more=%d\\n", fgets(line, 16, in) != NULL);
  rewind(in);
  printf("first=%c eof=%d\\n", fgetc(in), feof(in));
  fclose(in);
  return 0;
}`,
      [],
      new Map([['data.txt', bytes('12 30\r\nhello\r\nlast')]])
    );
    // The carriage return of a Windows line ending is part of the ending.
    expect(run.output).toBe(
      'r=2 a+b=42 at 5\n[hello\n][last] eof=1\nmore=0\nfirst=1 eof=0\n'
    );
  });

  it('sets the end-of-file indicator when fscanf reads past the end', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  FILE *in = fopen("n.txt", "r");
  int n = 0;
  int sum = 0;
  while (fscanf(in, "%d", &n) == 1) {
    sum += n;
  }
  printf("sum=%d eof=%d last=%d\\n", sum, feof(in), fscanf(in, "%d", &n));
  return 0;
}`,
      [],
      new Map([['n.txt', bytes('1 2 3')]])
    );
    expect(run.output).toBe('sum=6 eof=1 last=-1\n');
  });

  it('writes and reads binary blocks, and seeks in them', async () => {
    const run = await session(`#include <stdio.h>
int main(void) {
  int numbers[3] = {1, 256, -2};
  FILE *out = fopen("numbers.bin", "wb");
  size_t written = fwrite(numbers, sizeof(int), 3, out);
  fclose(out);
  FILE *in = fopen("numbers.bin", "rb");
  fseek(in, 0, SEEK_END);
  long size = ftell(in);
  fseek(in, 4, SEEK_SET);
  int back[2] = {0, 0};
  size_t got = fread(back, sizeof(int), 2, in);
  size_t none = fread(back, sizeof(int), 1, in);
  printf("%d %ld %d %d %d %d\\n", (int)written, size, (int)got, back[0], back[1], (int)none);
  fseek(in, -4, SEEK_CUR);
  printf("%ld %d\\n", ftell(in), fseek(in, -100, SEEK_SET));
  fclose(in);
  return 0;
}`);
    expect(run.output).toBe('3 12 2 256 -2 0\n8 -1\n');
    expect(
      Array.from(new Uint8Array(run.server.fileSnapshot().get('numbers.bin')!))
    ).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 254, 255, 255, 255]);
  });

  it('appends with mode a, and reads back what it wrote with w+', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  FILE *log = fopen("log.txt", "a");
  fputs("second\\n", log);
  fclose(log);
  FILE *both = fopen("scratch.txt", "w+");
  fputs("abc", both);
  rewind(both);
  printf("%c\\n", fgetc(both));
  fclose(both);
  return 0;
}`,
      [],
      new Map([['log.txt', bytes('first\n')]])
    );
    expect(run.output).toBe('a\n');
    expect(text(run.server.fileSnapshot().get('log.txt'))).toBe(
      'first\nsecond\n'
    );
  });

  it('renames and removes files', async () => {
    const run = await session(
      `#include <stdio.h>
#include <errno.h>
int main(void) {
  printf("%d ", rename("old.txt", "new.txt"));
  printf("%d ", remove("gone.txt"));
  errno = 0;
  printf("%d %d ", remove("gone.txt"), errno == ENOENT);
  printf("%d\\n", rename("nothing.txt", "x.txt"));
  return 0;
}`,
      [],
      new Map([
        ['old.txt', bytes('moved')],
        ['gone.txt', bytes('bye')],
      ])
    );
    expect(run.output).toBe('0 0 -1 1 -1\n');
    const files = run.server.fileSnapshot();
    expect(Array.from(files.keys())).toEqual(['new.txt']);
    expect(text(files.get('new.txt'))).toBe('moved');
  });

  it('keeps a removed file removed when a stream on it is flushed', async () => {
    const run = await session(`#include <stdio.h>
int main(void) {
  FILE *f = fopen("temp.txt", "w");
  remove("temp.txt");
  fputs("lost", f);
  fclose(f);
  FILE *g = fopen("before.txt", "w");
  rename("before.txt", "after.txt");
  fputs("follows", g);
  fclose(g);
  return 0;
}`);
    const files = run.server.fileSnapshot();
    expect(Array.from(files.keys())).toEqual(['after.txt']);
    expect(text(files.get('after.txt'))).toBe('follows');
  });

  it('fails a write to a stream opened for reading, and clears the error', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  FILE *in = fopen("r.txt", "r");
  int r = fputc('x', in);
  int e = ferror(in);
  clearerr(in);
  printf("%d %d %d\\n", r, e, ferror(in));
  return 0;
}`,
      [],
      new Map([['r.txt', bytes('r')]])
    );
    expect(run.output).toBe('-1 1 0\n');
    expect(run.rules).toContain('stream-mode');
  });

  it('refuses an fgets that would write past its array', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  char small[4];
  FILE *in = fopen("long.txt", "r");
  fgets(small, 100, in);
  return 0;
}`,
      [],
      new Map([['long.txt', bytes('much too long\n')]])
    );
    expect(run.rules).toContain('buffer-overflow');
    expect(run.output).toContain('the size argument (100)');
  });

  it('fails fopen on a mode C does not have', async () => {
    const run = await session(`#include <stdio.h>
int main(void) {
  FILE *f = fopen("x.txt", "rw");
  printf("%d\\n", f == NULL);
  return 0;
}`);
    expect(run.output).toBe('1\n');
    expect(run.rules).toContain('invalid-mode');
  });

  it('warns that fflush(stdin) is undefined', async () => {
    const run = await session(`#include <stdio.h>
int main(void) {
  fflush(stdin);
  fflush(NULL);
  return 0;
}`);
    expect(run.rules).toEqual(['flush-input']);
  });
});

describe('scanf %p', () => {
  it('reads back what %p prints, null included', async () => {
    const run = await session(
      `#include <stdio.h>
int main(void) {
  int x = 5;
  int *p = &x;
  int *q = NULL;
  int *r = &x;
  char text[32];
  sprintf(text, "%p", (void *)p);
  sscanf(text, "%p", &q);
  scanf("%p", &r);
  printf("%d %d %d\\n", q == p, *q, r == NULL);
  return 0;
}`,
      [line('(nil)')]
    );
    expect(run.output).toBe('(nil)\n1 5 1\n');
  });
});

/** The matcher on its own, resumed the way `library/stdio.ts` resumes it. */
const scanLines = (format: string, lines: (string | null)[]): ScanResult => {
  const scanner = scan(format, '');
  let step = scanner.next('');
  for (const one of lines) {
    if (step.done) {
      break;
    }
    step = scanner.next(one === null ? null : `${one}\n`);
  }
  if (!step.done) {
    throw new Error('the scan still wants input');
  }
  return step.value;
};

describe('the scan at the end of input', () => {
  it('fails the waiting directive with an input failure', () => {
    const result = scanLines('%d %d', ['3', null]);
    expect(result.values.map((value) => value.kind)).toEqual(['int']);
    expect(result.failure).toMatchObject({ directive: '%d', endOfInput: true });
    expect(result.reachedEnd).toBe(true);
  });

  it('asks for nothing more once the input has ended', () => {
    const scanner = scan('%d', '');
    expect(scanner.next('').done).toBe(false);
    expect(scanner.next(null).done).toBe(true);
  });

  it('parses %p as hexadecimal, with or without 0x, and (nil)', () => {
    expect(scanLines('%p %p %p', ['0x1f ff (nil)']).values).toEqual([
      { kind: 'int', value: 31, counted: true },
      { kind: 'int', value: 255, counted: true },
      { kind: 'int', value: 0, counted: true },
    ]);
  });
});

describe('the FILE object', () => {
  it('reads the modes C defines and nothing else', () => {
    expect(parseMode('r')).toMatchObject({ read: true, write: false });
    expect(parseMode('a+')).toMatchObject({
      read: true,
      write: true,
      append: true,
    });
    expect(parseMode('rb+')).toMatchObject({ binary: true, write: true });
    expect(parseMode('r+b')).toMatchObject({ binary: true, write: true });
    expect(parseMode('wb')).toMatchObject({ truncate: true, binary: true });
    expect(parseMode('rw')).toBeNull();
    expect(parseMode('r++')).toBeNull();
    expect(parseMode('')).toBeNull();
  });

  it('folds CRLF in text mode and keeps it in binary mode', () => {
    const contents = Uint8Array.from([0x61, 0x0d, 0x0a]);
    const asText = new FileStream('f', parseMode('r')!, contents);
    const asBinary = new FileStream('f', parseMode('rb')!, contents);
    expect([asText.getc(), asText.getc(), asText.getc()]).toEqual([
      0x61, 0x0a, -1,
    ]);
    expect(asText.eof).toBe(true);
    expect([asBinary.getc(), asBinary.getc(), asBinary.getc()]).toEqual([
      0x61, 0x0d, 0x0a,
    ]);
  });

  it('fills a gap after a seek past the end with zero bytes', () => {
    const stream = new FileStream('f', parseMode('w')!, new Uint8Array(0));
    stream.seek(3, 0);
    stream.write([0x41]);
    expect(Array.from(new Uint8Array(stream.contents()))).toEqual([
      0, 0, 0, 0x41,
    ]);
  });

  it('hands back pushed-back characters first, and counts them in ftell', () => {
    const stream = new FileStream(
      'f',
      parseMode('r')!,
      Uint8Array.from([1, 2])
    );
    stream.getc();
    stream.unget(9);
    expect(stream.tell()).toBe(0);
    expect(stream.peek(10).text).toBe('\u0009\u0002');
    expect(stream.getc()).toBe(9);
  });

  it('keeps console input and its pushed-back characters in order', () => {
    const input = new ConsoleInput();
    input.buffer = 'bc';
    input.unget(0x61);
    expect(input.takeAll()).toBe('abc');
    input.endPending = true;
    expect(input.take()).toBeNull();
    expect(input.takeEnd()).toBe(true);
    expect(input.eof).toBe(true);
    expect(input.takeEnd()).toBe(false);
  });

  it('writes a byte-sized character as itself and a wider one as UTF-8', () => {
    expect(encodeText('aä€')).toEqual([0x61, 0xe4, 0xe2, 0x82, 0xac]);
  });
});
