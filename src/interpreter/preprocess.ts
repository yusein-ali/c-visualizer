/**
 * A small C preprocessor for PLIVET.
 *
 * unicoen.ts has no preprocessor. `CPP14Interpreter.preProcess` scans the text
 * for define directives, takes the second token as a key and the rest of the
 * line as a value, and runs `text.split(key).join(value)` over the whole
 * source. That has three consequences, all of them measured in
 * `baseline/scripts/probe-preprocessor.js`:
 *
 *   - a directive with fewer than three tokens - a valueless flag, or the word
 *     written in a comment with nothing after it - makes the scan loop forever
 *     and freezes the page;
 *   - substitution is a substring replace, so a macro name is replaced inside
 *     string literals and inside longer identifiers (`SIZEx` becomes `4x`,
 *     after which nothing in the file parses);
 *   - conditional directives are ignored, so both arms of an #ifdef/#else run.
 *
 * This module replaces that pass. It works line by line so that line numbers
 * are preserved exactly - the editor's highlight and breakpoints are matched by
 * line, so every directive and every excluded line has to leave a blank line
 * behind rather than disappear.
 *
 * Supported: object-like and function-like macros with argument substitution
 * and recursive expansion, #undef, #ifdef / #ifndef / #if / #elif / #else /
 * #endif with a constant-expression evaluator, defined(), backslash line
 * continuation, and __LINE__. Expansion skips string literals, character
 * literals and comments.
 *
 * Not supported, and left as plain text: stringification (#x), token pasting
 * (a##b), __VA_ARGS__, and #include - the engine provides printf, malloc, sqrt
 * and friends regardless of which headers are named.
 */

interface Macro {
  params: string[] | null;
  body: string;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;

interface ConditionalFrame {
  active: boolean;
  taken: boolean;
  parentActive: boolean;
}

class Preprocessor {
  private macros = new Map<string, Macro>();
  private conditionals: ConditionalFrame[] = [];
  private inBlockComment = false;

  public run(code: string): string {
    const lines = code.split('\n');
    const out: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!this.inBlockComment && this.isDirective(line)) {
        let directive = line;
        // A directive continued with a trailing backslash swallows the lines
        // that follow it; each one still has to leave a blank line behind.
        while (/\\\s*$/.test(directive) && i + 1 < lines.length) {
          directive = directive.replace(/\\\s*$/, ' ') + lines[i + 1];
          i += 1;
          out.push('');
        }
        this.handleDirective(directive);
        out.push('');
        continue;
      }
      if (!this.isActive()) {
        out.push('');
        continue;
      }
      out.push(this.expandLine(line, i + 1));
    }
    return out.join('\n');
  }

  private isDirective(line: string): boolean {
    return /^\s*#/.test(line);
  }

  private isActive(): boolean {
    for (const frame of this.conditionals) {
      if (!frame.active) {
        return false;
      }
    }
    return true;
  }

  private handleDirective(line: string) {
    const text = line.replace(/^\s*#\s*/, '').trim();
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*([\s\S]*)$/.exec(text);
    const keyword = match === null ? '' : match[1];
    const rest = match === null ? '' : match[2];
    switch (keyword) {
      case 'define':
        if (this.isActive()) {
          this.defineMacro(rest);
        }
        return;
      case 'undef':
        if (this.isActive()) {
          this.macros.delete(rest.split(/\s/)[0]);
        }
        return;
      case 'ifdef':
        this.pushConditional(this.macros.has(rest.split(/\s/)[0]));
        return;
      case 'ifndef':
        this.pushConditional(!this.macros.has(rest.split(/\s/)[0]));
        return;
      case 'if':
        this.pushConditional(this.evaluate(rest) !== 0);
        return;
      case 'elif': {
        const frame = this.conditionals[this.conditionals.length - 1];
        if (typeof frame === 'undefined') {
          return;
        }
        const value = !frame.taken && this.evaluate(rest) !== 0;
        frame.active = frame.parentActive && value;
        frame.taken = frame.taken || value;
        return;
      }
      case 'else': {
        const frame = this.conditionals[this.conditionals.length - 1];
        if (typeof frame === 'undefined') {
          return;
        }
        frame.active = frame.parentActive && !frame.taken;
        frame.taken = true;
        return;
      }
      case 'endif':
        this.conditionals.pop();
        return;
      default:
        // #include, #pragma, #error, #line: dropped, like every other
        // directive. The blank line keeps the numbering.
        return;
    }
  }

  private pushConditional(value: boolean) {
    const parentActive = this.isActive();
    this.conditionals.push({
      parentActive,
      active: parentActive && value,
      taken: value,
    });
  }

  private defineMacro(rest: string) {
    const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
    if (nameMatch === null) {
      return;
    }
    const name = nameMatch[1];
    let pos = name.length;
    // Function-like only when the parenthesis touches the name, as in C.
    if (rest[pos] === '(') {
      const close = rest.indexOf(')', pos);
      if (close === -1) {
        return;
      }
      const inner = rest.slice(pos + 1, close).trim();
      const params =
        inner === '' ? [] : inner.split(',').map((param) => param.trim());
      this.macros.set(name, { params, body: rest.slice(close + 1).trim() });
      return;
    }
    this.macros.set(name, { params: null, body: rest.slice(pos).trim() });
  }

  /** Copies a line through, expanding macros outside literals and comments. */
  private expandLine(line: string, lineNumber: number): string {
    let out = '';
    let i = 0;
    while (i < line.length) {
      if (this.inBlockComment) {
        const end = line.indexOf('*/', i);
        if (end === -1) {
          out += line.slice(i);
          i = line.length;
        } else {
          out += line.slice(i, end + 2);
          i = end + 2;
          this.inBlockComment = false;
        }
        continue;
      }
      const pair = line.substr(i, 2);
      if (pair === '/*') {
        this.inBlockComment = true;
        out += pair;
        i += 2;
        continue;
      }
      if (pair === '//') {
        out += line.slice(i);
        break;
      }
      const char = line[i];
      if (char === '"' || char === "'") {
        const end = skipLiteral(line, i);
        out += line.slice(i, end);
        i = end;
        continue;
      }
      if (IDENT_START.test(char)) {
        let end = i + 1;
        while (end < line.length && IDENT_CHAR.test(line[end])) {
          end += 1;
        }
        const name = line.slice(i, end);
        const expansion = this.expandIdentifier(
          name,
          line,
          end,
          lineNumber,
          new Set<string>()
        );
        if (expansion === null) {
          out += name;
          i = end;
        } else {
          out += expansion.text;
          i = expansion.next;
        }
        continue;
      }
      out += char;
      i += 1;
    }
    return out;
  }

  /**
   * Expands one identifier. `active` carries the macros already being expanded
   * so that a macro naming itself stops instead of recursing forever.
   */
  private expandIdentifier(
    name: string,
    line: string,
    after: number,
    lineNumber: number,
    active: Set<string>
  ): { text: string; next: number } | null {
    if (name === '__LINE__') {
      return { text: String(lineNumber), next: after };
    }
    const macro = this.macros.get(name);
    if (typeof macro === 'undefined' || active.has(name)) {
      return null;
    }
    const nested = new Set(active);
    nested.add(name);
    if (macro.params === null) {
      return {
        text: this.expandFragment(macro.body, lineNumber, nested),
        next: after,
      };
    }
    let open = after;
    while (open < line.length && /\s/.test(line[open])) {
      open += 1;
    }
    if (line[open] !== '(') {
      // A function-like macro without a call is just an identifier.
      return null;
    }
    const args = readArguments(line, open);
    if (args === null || args.values.length !== macro.params.length) {
      return null;
    }
    const expandedArgs = args.values.map((value) =>
      this.expandFragment(value, lineNumber, active)
    );
    const substituted = substituteParams(
      macro.body,
      macro.params,
      expandedArgs
    );
    return {
      text: this.expandFragment(substituted, lineNumber, nested),
      next: args.next,
    };
  }

  /** Expansion of a macro body or argument, with the comment state preserved. */
  private expandFragment(
    text: string,
    lineNumber: number,
    active: Set<string>
  ): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
      const char = text[i];
      if (char === '"' || char === "'") {
        const end = skipLiteral(text, i);
        out += text.slice(i, end);
        i = end;
        continue;
      }
      if (IDENT_START.test(char)) {
        let end = i + 1;
        while (end < text.length && IDENT_CHAR.test(text[end])) {
          end += 1;
        }
        const name = text.slice(i, end);
        const expansion = this.expandIdentifier(
          name,
          text,
          end,
          lineNumber,
          active
        );
        if (expansion === null) {
          out += name;
          i = end;
        } else {
          out += expansion.text;
          i = expansion.next;
        }
        continue;
      }
      out += char;
      i += 1;
    }
    return out;
  }

  /** Evaluates an #if / #elif expression. Unknown identifiers are 0, as in C. */
  private evaluate(expression: string): number {
    const resolved = expression.replace(
      /defined\s*(?:\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)|([A-Za-z_][A-Za-z0-9_]*))/g,
      (_all, parenthesised, bare) =>
        this.macros.has(parenthesised || bare) ? '1' : '0'
    );
    const expanded = this.expandFragment(resolved, 0, new Set<string>());
    try {
      return evaluateConstantExpression(expanded);
    } catch (e) {
      return 0;
    }
  }
}

/** Index just past the string or character literal starting at `start`. */
function skipLiteral(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) {
      return i + 1;
    }
    i += 1;
  }
  return text.length;
}

/** Reads a macro call's arguments, `open` pointing at the opening parenthesis. */
function readArguments(
  text: string,
  open: number
): { values: string[]; next: number } | null {
  const values: string[] = [];
  let depth = 0;
  let current = '';
  let i = open;
  while (i < text.length) {
    const char = text[i];
    if (char === '"' || char === "'") {
      const end = skipLiteral(text, i);
      current += text.slice(i, end);
      i = end;
      continue;
    }
    if (char === '(') {
      depth += 1;
      if (depth === 1) {
        i += 1;
        continue;
      }
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        if (current.trim() !== '' || values.length > 0) {
          values.push(current.trim());
        }
        return { values, next: i + 1 };
      }
    } else if (char === ',' && depth === 1) {
      values.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    current += char;
    i += 1;
  }
  return null;
}

/** Replaces whole-word parameter names in a macro body. */
function substituteParams(
  body: string,
  params: string[],
  args: string[]
): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const char = body[i];
    if (char === '"' || char === "'") {
      const end = skipLiteral(body, i);
      out += body.slice(i, end);
      i = end;
      continue;
    }
    if (IDENT_START.test(char)) {
      let end = i + 1;
      while (end < body.length && IDENT_CHAR.test(body[end])) {
        end += 1;
      }
      const name = body.slice(i, end);
      const index = params.indexOf(name);
      out += index === -1 ? name : args[index];
      i = end;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

type Token = string;

/** Tokenises and evaluates a C constant expression (integers only). */
function evaluateConstantExpression(expression: string): number {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const char = expression[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const match = /^(0[xX][0-9a-fA-F]+|[0-9]+)[uUlL]*/.exec(
        expression.slice(i)
      );
      const literal = match === null ? char : match[1];
      tokens.push(String(Number(literal)));
      i += match === null ? 1 : match[0].length;
      continue;
    }
    if (IDENT_START.test(char)) {
      let end = i + 1;
      while (end < expression.length && IDENT_CHAR.test(expression[end])) {
        end += 1;
      }
      tokens.push('0'); // an identifier that survived expansion is 0 in C
      i = end;
      continue;
    }
    const three = expression.substr(i, 2);
    if (
      ['==', '!=', '<=', '>=', '&&', '||', '<<', '>>'].indexOf(three) !== -1
    ) {
      tokens.push(three);
      i += 2;
      continue;
    }
    tokens.push(char);
    i += 1;
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (token: string) => {
    if (tokens[pos] === token) {
      pos += 1;
      return true;
    }
    return false;
  };
  const parseUnary = (): number => {
    if (eat('!')) {
      return parseUnary() === 0 ? 1 : 0;
    }
    if (eat('-')) {
      return -parseUnary();
    }
    if (eat('+')) {
      return parseUnary();
    }
    if (eat('~')) {
      return ~parseUnary();
    }
    if (eat('(')) {
      const value = parseOr();
      eat(')');
      return value;
    }
    const token = peek();
    pos += 1;
    const value = Number(token);
    return isNaN(value) ? 0 : value;
  };
  const binary = (
    next: () => number,
    operators: string[]
  ): (() => number) => () => {
    let left = next();
    while (operators.indexOf(peek()) !== -1) {
      const operator = peek();
      pos += 1;
      const right = next();
      switch (operator) {
        case '*':
          left = left * right;
          break;
        case '/':
          left = right === 0 ? 0 : Math.trunc(left / right);
          break;
        case '%':
          left = right === 0 ? 0 : left % right;
          break;
        case '+':
          left = left + right;
          break;
        case '-':
          left = left - right;
          break;
        case '<<':
          left = left << right;
          break;
        case '>>':
          left = left >> right;
          break;
        case '<':
          left = left < right ? 1 : 0;
          break;
        case '>':
          left = left > right ? 1 : 0;
          break;
        case '<=':
          left = left <= right ? 1 : 0;
          break;
        case '>=':
          left = left >= right ? 1 : 0;
          break;
        case '==':
          left = left === right ? 1 : 0;
          break;
        case '!=':
          left = left !== right ? 1 : 0;
          break;
        case '&':
          left = left & right;
          break;
        case '^':
          left = left ^ right;
          break;
        case '|':
          left = left | right;
          break;
        case '&&':
          left = left !== 0 && right !== 0 ? 1 : 0;
          break;
        case '||':
          left = left !== 0 || right !== 0 ? 1 : 0;
          break;
        default:
          break;
      }
    }
    return left;
  };
  const parseMul = binary(parseUnary, ['*', '/', '%']);
  const parseAdd = binary(parseMul, ['+', '-']);
  const parseShift = binary(parseAdd, ['<<', '>>']);
  const parseCompare = binary(parseShift, ['<', '>', '<=', '>=']);
  const parseEquality = binary(parseCompare, ['==', '!=']);
  const parseBitAnd = binary(parseEquality, ['&']);
  const parseBitXor = binary(parseBitAnd, ['^']);
  const parseBitOr = binary(parseBitXor, ['|']);
  const parseAnd = binary(parseBitOr, ['&&']);
  const parseOr = binary(parseAnd, ['||']);
  return parseOr();
}

export function preprocess(code: string): string {
  return new Preprocessor().run(code);
}
