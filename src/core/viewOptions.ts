import { MemoryRegion } from './model';

/**
 * Which memory regions the reader has asked the canvas to draw.
 *
 * This is the second kind of view state, beside `FoldState`, and it is held
 * apart from it because it answers a different question. A fold says how much
 * of something is worth reading right now; these say whether it is on the
 * canvas at all. A collapsed segment still occupies its title bar, keeps its
 * place in the column and can be reopened where it stands - that is the point
 * of it. A region that is switched off is not laid out, so the ones under it
 * move up and the pointers into it are dropped with its rows, and the switch
 * that brings it back is the panel rather than the map.
 *
 * A region nobody has switched is drawn when it holds something and left off
 * when it does not - a program with nothing in its BSS has no box on the
 * canvas worth the room, and a reader who wants to see that band anyway can
 * ask for it - except for the four the map names whatever they hold: the stack
 * and the heap the reader is watching, and the code and the constants beside
 * them. Those arrive collapsed rather than absent, so the map says where a
 * frame or an allocation will land before the program has put one there. That
 * rule is `startsShown`, and it belongs to the caller: this is told the answer
 * rather than working it out. What is kept here is the reader's own answer
 * where they have given one, as `FoldState` keeps theirs, so a region they
 * opened while it was empty is still open when the first object lands in it,
 * and one they closed stays closed as the program fills it.
 */
export class ViewOptions {
  private readonly chosen = new Map<MemoryRegion, boolean>();
  /** Whether the current statement's explanation is drawn. */
  private statement = true;
  /** Whether the active calls beside the statement are drawn. */
  private callStack = true;
  /** Whether the expression tree spanning the two top columns is drawn. */
  private expression = true;
  /** The memory map is one canvas section, around its individual regions. */
  private memory = true;
  /** The write history is the section under the JointJS drawing. */
  private mutations = true;

  /**
   * Whether the memory map draws this region at all. `whenUntouched` is the
   * answer for a region nobody has switched - the caller knows whether it
   * holds anything, and this does not.
   */
  public isRegionShown(region: MemoryRegion, whenUntouched = true): boolean {
    const answer = this.chosen.get(region);
    return typeof answer === 'undefined' ? whenUntouched : answer;
  }

  public showRegion(region: MemoryRegion, shown: boolean): void {
    this.chosen.set(region, shown);
  }

  /** Flips a region, given whether it is on the canvas at the moment. */
  public toggleRegion(region: MemoryRegion, shownNow = true): void {
    this.showRegion(region, !this.isRegionShown(region, shownNow));
  }

  public isStatementShown(): boolean {
    return this.statement;
  }

  public showStatement(shown: boolean): void {
    this.statement = shown;
  }

  public isCallStackShown(): boolean {
    return this.callStack;
  }

  public showCallStack(shown: boolean): void {
    this.callStack = shown;
  }

  public isExpressionShown(): boolean {
    return this.expression;
  }

  public showExpression(shown: boolean): void {
    this.expression = shown;
  }

  public isMemoryShown(): boolean {
    return this.memory;
  }

  public showMemory(shown: boolean): void {
    this.memory = shown;
  }

  public areMutationsShown(): boolean {
    return this.mutations;
  }

  public showMutations(shown: boolean): void {
    this.mutations = shown;
  }

  /** Back to what the canvas decides for itself. */
  public clear(): void {
    this.chosen.clear();
    this.statement = true;
    this.callStack = true;
    this.expression = true;
    this.memory = true;
    this.mutations = true;
  }
}
