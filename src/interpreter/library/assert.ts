import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { LibraryHost } from './host';

/**
 * The file name `assert` reports when nothing has told the engine which file
 * a line came from: an interpreter driven directly, with one source and no
 * name for it. A run through the server names the file the line is in.
 */
export const ASSERT_FILE = 'main.c';

/**
 * `<assert.h>`: `assert(expr)` stops the program when `expr` is false,
 * with the message the C standard gives as its example -
 * `Assertion failed: expr, file main.c, line N` - and a runtime diagnostic on
 * the line.
 *
 * `assert` is a macro in C, and what the macro adds over a function is the
 * text of its argument and the line it was written on. Both come from the
 * call node the engine is executing, so the message quotes the condition as
 * the reader wrote it. The program ends as `abort` ends it, with status 134
 * (128 + SIGABRT), from however deep in the call stack the assertion was.
 */
export function installAssert(global: Scope, host: LibraryHost): void {
  global.setTop(
    'assert',
    (value: unknown) => {
      if (host.truthy(value)) {
        return;
      }
      const call = host.currentCall();
      const argument =
        call === null || call.args.length === 0 ? null : call.args[0];
      const text = argument === null ? '' : host.sourceText(argument);
      const line =
        call !== null && call.codeRange
          ? call.codeRange.begin.y
          : host.currentLine();
      // `__FILE__` and `__LINE__` as the macro would expand them: the file
      // the assertion is written in, counted from that file's first line.
      const at = line === null ? null : host.sourceLocation(line);
      const where =
        at === null
          ? `file ${ASSERT_FILE}, line ?`
          : `file ${at.file}, line ${at.line}`;
      host.terminate(
        134,
        `Assertion failed: ${text}, ${where}\n`,
        'assertion-failed',
        `the assertion ${text} failed, so the program was aborted`
      );
    },
    'FUNCTION'
  );
}
