import { isWithinFold } from './model';

/**
 * Which aggregates the user has collapsed.
 *
 * Fold state used to live on the cells themselves, which meant it was rebuilt
 * from scratch every time the interpreter stepped - opening an array and
 * stepping once closed it again - and that a click on the canvas had to reach
 * back into the model and then ask the application to redraw. It belongs to
 * the view: it is a property of what this user is looking at, not of what the
 * program is doing, and in Phase 6 it stays on the main thread while the model
 * arrives from the Worker.
 *
 * Groups are identified by the path of keys that reaches them, so a row is
 * hidden when any group on its path is folded.
 */
export class FoldState {
  private readonly folded = new Set<string>();

  public isFolded(group: string): boolean {
    return this.folded.has(group);
  }

  public toggle(group: string): void {
    if (this.folded.has(group)) {
      this.folded.delete(group);
    } else {
      this.folded.add(group);
    }
  }

  /** Whether a row in `group` is hidden by a fold at or above it. */
  public hides(group: string | undefined): boolean {
    if (group === undefined) {
      return false;
    }
    for (const folded of this.folded) {
      if (isWithinFold(group, folded)) {
        return true;
      }
    }
    return false;
  }

  public clear(): void {
    this.folded.clear();
  }
}
