import { CPP14Interpreter } from 'unicoen.ts/dist/interpreter/CPP14/CPP14Interpreter';
import { SyntaxErrorData } from 'unicoen.ts/dist/interpreter/mapper/SyntaxErrorData';
import { preprocess } from './preprocess';

/**
 * The stock CPP14Interpreter's `preProcess` is a substring replace that hangs
 * on a valueless define and corrupts string literals and identifiers; see
 * `preprocess.ts`. Overriding the method is enough - `Interpreter` calls it on
 * every `startStepExecution`.
 *
 * This module is what `server.ts` imports dynamically, so the interpreter and
 * its parser stay in their own chunk.
 */
export class PlivetCPP14Interpreter extends CPP14Interpreter {
  preProcess(code: string): string {
    return preprocess(code);
  }

  /**
   * The syntax check goes straight to the mapper, whose own `preProcess` is the
   * identity, so without this it lints the raw directives: a block excluded by
   * #if 0 is reported as a syntax error even though it never reaches the
   * parser. The pass preserves line numbers, so the annotations still land on
   * the right lines.
   */
  checkSyntaxError(code: string): SyntaxErrorData[] {
    return super.checkSyntaxError(preprocess(code));
  }
}
