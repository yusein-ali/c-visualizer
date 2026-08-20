/**
 * What went wrong while the program was running, as data rather than as a line
 * of console text.
 *
 * The engine already detects most of these and prints them - which teaches
 * very little, because the console is where the program's own output is and a
 * message there says nothing about which line is to blame. As a diagnostic it
 * lands on the statement, in the same linter the teaching rules use, at the
 * step it happened on.
 *
 * Plain data: this is produced in the Worker and shown on the page.
 */
export interface RuntimeDiagnostic {
  /** Which check spoke: `division-by-zero`, `null-dereference`, … */
  rule: string;
  severity: 'warning' | 'error';
  message: string;
  /**
   * Where, in the interpreter's own coordinates: one-based lines, zero-based
   * columns, and an end column that names the last character rather than the
   * one after it - the same convention `codeRange` uses everywhere else.
   */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  /**
   * Whether the program was stopped here. C has nothing defined to continue
   * with after a division by zero; reading an object that was never written
   * is worth saying and not worth stopping for.
   */
  fatal: boolean;
}
