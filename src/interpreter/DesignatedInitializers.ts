import { UniArray } from 'unicoen.ts/dist/node/UniArray';
import { CodeRange } from 'unicoen.ts/dist/node_helper/CodeRange';
import { mask } from './scan';

interface Designator {
  start: number;
  end: number;
  index: number;
  braceDepth: number;
}

/** A member designator, `.name =`, and the member it names. */
interface MemberDesignator {
  start: number;
  end: number;
  member: string;
}

/**
 * Makes C99 designators acceptable to the C++14-derived parser while
 * retaining what they designate for the runtime: an array designator's index,
 * `[2] =`, and a member designator's name, `.y =`. Replacing either with
 * spaces keeps every line and column stable, so parsed items still match the
 * source. A designator list (`.a.b =`, `.a[1] =`) is left as it is.
 */
export class DesignatedInitializers {
  private source = '';
  private rewritten = '';
  private lineStarts: number[] = [0];
  private designators: Designator[] = [];
  private members: MemberDesignator[] = [];

  rewrite(code: string): string {
    this.source = code;
    this.lineStarts = [0];
    this.designators = [];
    this.members = [];
    for (let i = 0; i < code.length; i += 1) {
      if (code[i] === '\n') {
        this.lineStarts.push(i + 1);
      }
    }

    const masked = mask(code);
    const chars = code.split('');
    // `.name =`, not `.name ==`: where an initializer item names its member.
    // Sticky, so it is tried where the `.` is and nowhere after it.
    const memberDesignator = /\.\s*([A-Za-z_]\w*)\s*=(?!=)/y;
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
      if (masked[i] === '.' && this.startsInitializerItem(masked, i)) {
        memberDesignator.lastIndex = i;
        const member = memberDesignator.exec(masked);
        if (member !== null) {
          const end = i + member[0].length;
          this.members.push({ start: i, end, member: member[1] });
          for (let at = i; at < end; at += 1) {
            if (chars[at] !== '\n') {
              chars[at] = ' ';
            }
          }
          i = end;
          continue;
        }
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

  /** Whether one declaration contains at least one member designator. */
  hasMembersIn(declarationRange: CodeRange | null): boolean {
    if (declarationRange === null || typeof declarationRange === 'undefined') {
      return false;
    }
    const start = this.offsetOf(
      declarationRange.begin.y,
      declarationRange.begin.x
    );
    const end = this.offsetOf(declarationRange.end.y, declarationRange.end.x);
    return this.members.some(
      (item) => start <= item.start && item.end <= end + 1
    );
  }

  /**
   * The member an initializer item is designated for - the `y` of
   * `.y = 2` - or null for an item that follows on from the one before it.
   */
  memberOf(item: { codeRange: CodeRange | null } | null): string | null {
    if (item === null || item.codeRange === null) {
      return null;
    }
    const itemStart = this.offsetOf(
      item.codeRange.begin.y,
      item.codeRange.begin.x
    );
    let found: string | null = null;
    for (const designator of this.members) {
      if (designator.end > itemStart) {
        break;
      }
      // Only blanks - and the parentheses of an item the parser unwrapped -
      // may stand between a designator and the item it designates.
      if (
        this.rewritten
          .slice(designator.end, itemStart)
          .replace(/[\s(]/g, '') === ''
      ) {
        found = designator.member;
      }
    }
    return found;
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
