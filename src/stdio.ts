/**
 * `c-stdio.js`: the interpreter's `printf` formatter and `scanf` matcher, for a
 * page that wants them without the interpreter.
 *
 * The format playground on a course page explains a format string, shows what
 * it prints and what a scan of some input stores. It has to agree with what
 * the visualizer's programs print, character for character, and the surest
 * way to agree is to run the same code: `printf.ts` and `scanf.ts` import
 * nothing from the engine, so they are bundled here on their own.
 *
 * `npm run deploy` writes this as `c-stdio.js` beside the loader, together with
 * `c-stdio.parity.json` - the table of formats, arguments and expected text
 * that the interpreter's own `printf` is tested against.
 */
import {
  argumentSlots,
  explainDirective,
  formatPrintf,
  parseFormat,
} from './interpreter/printf';
import {
  ScanFailure,
  ScanValue,
  parseScanFormat,
  scanReturnValue,
  scanString,
} from './interpreter/scanf';

export type {
  DirectiveResult,
  FormatDirective,
  FormatFlags,
  FormatLiteral,
  FormatSegment,
  LengthModifier,
  PrintfArgument,
  PrintfArgumentKind,
  PrintfDiagnostic,
  PrintfOptions,
  PrintfResult,
} from './interpreter/printf';
export type {
  ScanDirective,
  ScanFailure,
  ScanValue,
} from './interpreter/scanf';

/**
 * Changes only when a field of the API changes meaning. Adding a field keeps
 * it; a host checks it before trusting the shapes below. `argumentSlots` and
 * `parseScanFormat` were added under version 1.
 */
export const STDIO_API_VERSION = 1;

/** What a scan of complete input found: `sscanf`, as the page sees it. */
export interface ScanAllResult {
  /** The values the conversions would store, in argument order. */
  values: ScanValue[];
  /** The input no directive consumed. */
  rest: string;
  /** The first directive that failed, or null when every one matched. */
  failure: ScanFailure | null;
  /**
   * What `sscanf` returns: the number of assignments, or -1 (`EOF`) when the
   * input ends before the first conversion completes.
   */
  returns: number;
}

/**
 * `format` matched against `input` as `sscanf` matches it: the input is all
 * there is, so a directive that runs out of it fails rather than waiting.
 */
export function scanAll(format: string, input: string): ScanAllResult {
  const result = scanString(format, input);
  return {
    values: result.values,
    rest: result.rest,
    failure: result.failure ?? null,
    returns: scanReturnValue(result),
  };
}

/** What `window.CStdio` holds. */
export interface CStdio {
  version: number;
  parseFormat: typeof parseFormat;
  formatPrintf: typeof formatPrintf;
  scanAll: typeof scanAll;
  explainDirective: typeof explainDirective;
  /**
   * The arguments a `printf` directive consumes, in the order it consumes
   * them: `'width'` for a `*` width, `'precision'` for a `*` precision, then
   * `'value'`. `%%` and a directive with an error consume none of the last.
   */
  argumentSlots: typeof argumentSlots;
  /** A `scanf` format split where the scan splits it, with offsets. */
  parseScanFormat: typeof parseScanFormat;
}

export const createStdio = (): CStdio => ({
  version: STDIO_API_VERSION,
  parseFormat,
  formatPrintf,
  scanAll,
  explainDirective,
  argumentSlots,
  parseScanFormat,
});
