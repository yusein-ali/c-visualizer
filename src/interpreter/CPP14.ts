import { Interpreter } from 'unicoen.ts/dist/interpreter/Interpreter';
import { CPP14Mapper } from 'unicoen.ts/dist/interpreter/CPP14/CPP14Mapper';
import { SyntaxErrorData } from 'unicoen.ts/dist/interpreter/mapper/SyntaxErrorData';
import { PlivetCPP14Engine } from './CPP14Engine';
import { preprocess } from './preprocess';

/**
 * PLIVET's C interpreter: the stock mapper and engine behaviour, with the
 * preprocessor `unicoen.ts` does not have (`preprocess.ts`) and a `printf` that
 * can format a string literal (`CPP14Engine.ts`).
 *
 * It extends `Interpreter` rather than `CPP14Interpreter` because the engine is
 * `protected readonly` and built in that subclass's constructor - passing our
 * own engine in is cleaner than reassigning the field afterwards. The stock
 * `preProcess` is not inherited and never runs.
 *
 * This module is what `server.ts` imports dynamically, so the interpreter and
 * its parser stay in their own chunk.
 */
export class PlivetCPP14Interpreter extends Interpreter {
  constructor() {
    super(new PlivetCPP14Engine(), new CPP14Mapper());
  }

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
