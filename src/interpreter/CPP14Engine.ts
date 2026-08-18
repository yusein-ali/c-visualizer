import { CPP14Engine } from 'unicoen.ts/dist/interpreter/CPP14/CPP14Engine';
import { Engine } from 'unicoen.ts/dist/interpreter/Engine/Engine';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';

/**
 * `printf` resolves `%s` only for an address whose type in `typeOnMemory` names
 * char - that is, a `char*` variable. A string literal is passed as the byte
 * array the engine represents it with, and agh.sprintf then formats the array
 * itself, so `printf("%s\n", "abc")` prints `97,98,99,0`.
 *
 * That is independent of macros, but it is what stringification produces: `#x`
 * expands to a literal, so `printf("%s", STR(abc))` would hit it every time.
 *
 * The fix wraps the library function rather than restating it: the byte arrays
 * are decoded to strings before the original runs. Argument 0 is left alone -
 * it is the format string, which the original decodes itself.
 */
export class PlivetCPP14Engine extends CPP14Engine {
  protected includeStdio(global: Scope): void {
    super.includeStdio(global);
    const original = global.get('printf');
    if (typeof original !== 'function') {
      return;
    }
    // tslint:disable-next-line:only-arrow-functions
    const wrapped = function (this: unknown) {
      const args = Array.prototype.slice.call(arguments);
      for (let i = 1; i < args.length; i += 1) {
        if (Array.isArray(args[i])) {
          args[i] = Engine.bytesToStr(args[i]);
        }
      }
      return original.apply(this, args);
    };
    global.setTop('printf', wrapped, 'FUNCTION');
  }
}
