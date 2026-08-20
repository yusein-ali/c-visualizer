import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';

/**
 * Every step the session has taken, up to a point.
 *
 * Stepping back is replay, not re-execution: each step's state and output were
 * kept so that going back is a lookup. Kept without limit, which is what this
 * used to be, a loop of a few hundred thousand iterations retains a few
 * hundred thousand `ExecState`s and there is no server to pay for it - the
 * memory is the reader's own, and the tab dies with it.
 *
 * So the window is bounded. The first state is always retained, because
 * `BackAll` returns to the beginning of the program and that has to keep
 * working however long the run; beyond it, the most recent `limit` steps are
 * what can be stepped back through. Anything older is gone, and `has` reports
 * so rather than answering with a hole.
 */
export const HISTORY_LIMIT = 1000;

interface Entry {
  state: ExecState;
  output: string;
}

export class StepHistory {
  private readonly entries = new Map<number, Entry>();
  /** Steps recorded, including the ones since dropped. */
  private recorded = 0;

  constructor(private readonly limit: number = HISTORY_LIMIT) {}

  public push(state: ExecState, output: string): void {
    this.entries.set(this.recorded, { state, output });
    this.recorded += 1;
    this.evict();
  }

  public get length(): number {
    return this.recorded;
  }

  public has(index: number): boolean {
    return this.entries.has(index);
  }

  public stateAt(index: number): ExecState | undefined {
    const entry = this.entries.get(index);
    return entry === undefined ? undefined : entry.state;
  }

  public outputAt(index: number): string {
    const entry = this.entries.get(index);
    return entry === undefined ? '' : entry.output;
  }

  public lastState(): ExecState | undefined {
    return this.stateAt(this.recorded - 1);
  }

  /**
   * The nearest retained step at or after `index`, for a walk that starts in
   * a stretch that has been dropped - stepping forward from the first state of
   * a very long run.
   */
  public nextRetained(index: number): number {
    for (let step = index; step < this.recorded; step += 1) {
      if (this.entries.has(step)) {
        return step;
      }
    }
    return Math.max(this.recorded - 1, 0);
  }

  /** The oldest step that can still be stepped back to, past the first. */
  public oldestRetained(): number {
    for (const step of this.entries.keys()) {
      if (0 < step) {
        return step;
      }
    }
    return 0;
  }

  public clear(): void {
    this.entries.clear();
    this.recorded = 0;
  }

  private evict(): void {
    // A Map iterates in insertion order, so the first key past the retained
    // first state is the oldest one.
    while (this.limit + 1 < this.entries.size) {
      for (const step of this.entries.keys()) {
        if (0 < step) {
          this.entries.delete(step);
          break;
        }
      }
    }
  }
}
