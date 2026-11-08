import { Int } from 'unicoen.ts/dist/interpreter/CPP14/Int';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { installAssert } from './assert';
import { LIBRARY_CONSTANTS, isIntConstant } from './constants';
import { installCtype } from './ctype';
import { LibraryHost } from './host';
import { installMath } from './math';
import { installRealloc } from './realloc';
import { installSearch } from './search';
import { installStdarg } from './stdarg';
import { installStdlib } from './stdlib';
import { installStddef } from './stddef';
import { installString } from './string';
import { installTime } from './time';

export type {
  LibraryHost,
  RecordCell,
  SourceLine,
  VariadicFrame,
} from './host';

/**
 * Registers the part of the C library PLIVET implements itself, after the
 * upstream engine has registered its own.
 *
 * Called once per program run from `PlivetCPP14Engine.loadLibarary`, which
 * is what makes per-run state - `strtok`'s position, the `rand` seed - start
 * afresh with every run. The engine restores any name the program defines
 * itself afterwards, so a program's own `strlen` or `div` still wins.
 */
export function installLibrary(global: Scope, host: LibraryHost): void {
  installStddef(global, host);
  installCtype(global, host);
  installString(global, host);
  installStdlib(global, host);
  installRealloc(global, host);
  installSearch(global, host);
  installStdarg(global, host);
  installMath(global, host);
  installTime(global, host);
  installAssert(global, host);
  installConstants(global);
}

/**
 * The object-like macros, as system variables beside `NULL`: on the code
 * segment, never drawn, read by name.
 */
function installConstants(global: Scope): void {
  for (const [name, constant] of Object.entries(LIBRARY_CONSTANTS)) {
    global.setSystemVariable(
      'SYSTEM',
      name,
      isIntConstant(constant) ? new Int(constant.value) : constant.value
    );
  }
}
