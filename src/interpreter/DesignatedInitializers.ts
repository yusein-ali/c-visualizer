import { UniArray } from 'unicoen.ts/dist/node/UniArray';
import { CodeRange } from 'unicoen.ts/dist/node_helper/CodeRange';
import { mask } from './scan';

interface Designator {
  start: number;
  end: number;
  index: number;
  braceDepth: number;
}

/**
 * Makes C99 array designators acceptable to the C++14-derived parser while
 * retaining their indices for the runtime. Replacing `[2] =` with spaces keeps
 * every line and column stable, so parsed items still match the source.
 */
export class DesignatedInitializers {
  private source = '';
  private rewritten = '';
  private lineStarts: number[] = [0];
  private designators: Designator[] = [];

  rewrite(code: string): string {
    this.source = code;
    this.lineStarts = [0];
    this.designators = [];
    for (let i = 0; i < code.length; i += 1) {
      if (code[i] === '\n') {
        this.lineStarts.push(i + 1);
      }
    }

    const masked = mask(code);
    const chars = code.split('');
    let braceDepth = 0;
    let i = 0;
    while (i < masked.length) {
      if (masked[i] === '{') {
        braceDepth += 1;
        i += 1;
        continue;
      }
      if (masked[i] === '}') {
        braceDepth -= 1;
        i += 1;
        continue;
      }
      if (masked[i] !== '[') {
        i += 1;
        continue;
      }
      const match = /^\[\s*(\d+)\s*\]\s*=/.exec(masked.slice(i));
      if (match === null || !this.startsInitializerItem(masked, i)) {
        i += 1;
        continue;
      }
      const end = i + match[0].length;
      this.designators.push({
        start: i,
        end,
        index: Number(match[1]),
        braceDepth,
      });
      for (let at = i; at < end; at += 1) {
        if (chars[at] !== '\n') {
          chars[at] = ' ';
        }
      }
      i = end;
    }
    this.rewritten = chars.join('');
    return this.rewritten;
  }

  /** Whether one declaration contains at least one indexed designator. */
  hasIn(declarationRange: CodeRange): boolean {
    const start = this.offsetOf(
      declarationRange.begin.y,
      declarationRange.begin.x
    );
    const end = this.offsetOf(declarationRange.end.y, declarationRange.end.x);
    return this.designators.some(
      (item) => start <= item.start && item.end <= end + 1
    );
  }

  /** Applies C's designated/positional ordering to one parsed initializer. */
  order(
    declarationRange: CodeRange,
    initializer: UniArray,
    values: any[],
    length: number,
    emptyValue: any = []
  ): any[] {
    const declarationStart = this.offsetOf(
      declarationRange.begin.y,
      declarationRange.begin.x
    );
    const declarationEnd = this.offsetOf(
      declarationRange.end.y,
      declarationRange.end.x
    );
    const within = this.designators.filter(
      (item) => declarationStart <= item.start && item.end <= declarationEnd + 1
    );
    const outerDepth = within.reduce(
      (depth, item) => Math.min(depth, item.braceDepth),
      Number.POSITIVE_INFINITY
    );
    const outer = within.filter((item) => item.braceDepth === outerDepth);
    const designatedByItem = initializer.items.map((item) => {
      if (item.codeRange === null) {
        return null;
      }
      const itemStart = this.offsetOf(
        item.codeRange.begin.y,
        item.codeRange.begin.x
      );
      const found = outer
        .filter(
          (designator) =>
            designator.end <= itemStart &&
            this.rewritten.slice(designator.end, itemStart).trim() === ''
        )
        .pop();
      return typeof found === 'undefined' ? null : found.index;
    });

    const ordered: any[] = [];
    let next = 0;
    for (let item = 0; item < values.length; item += 1) {
      const designated = designatedByItem[item];
      const index = designated === null ? next : designated;
      if (0 <= index && index < length) {
        ordered[index] = values[item];
      }
      next = index + 1;
    }
    for (let index = 0; index < length; index += 1) {
      if (typeof ordered[index] === 'undefined') {
        ordered[index] = emptyValue;
      }
    }
    return ordered;
  }

  private startsInitializerItem(masked: string, at: number): boolean {
    let cursor = at - 1;
    while (cursor >= 0 && /\s/.test(masked[cursor])) {
      cursor -= 1;
    }
    return cursor >= 0 && (masked[cursor] === '{' || masked[cursor] === ',');
  }

  private offsetOf(line: number, column: number): number {
    const start = this.lineStarts[Math.max(0, line - 1)];
    return typeof start === 'undefined' ? this.source.length : start + column;
  }
}
