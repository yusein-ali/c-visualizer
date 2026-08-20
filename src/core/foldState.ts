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
 *
 * A memory segment collapses the same way and for the same reason - a reader
 * watching the stack does not need the text segment underneath it - but it is
 * held apart from the folds: a segment is named by its own key rather than by
 * a path, and collapsing one hides its whole table rather than a run of rows
 * inside it. A segment is also the one thing here with an opinion of its own
 * about how it should start - one holding nothing is put away until it holds
 * something, and the code and the constants are put away whatever they hold
 * (`startsCollapsed`) - so what is kept is the user's answer where they have
 * given one, and nothing where they have not.
 */
export class FoldState {
  private readonly folded = new Set<string>();
  private readonly collapsed = new Map<string, boolean>();

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

  /**
   * Whether a segment is drawn as its title bar alone. `whenUntouched` is the
   * answer for a segment nobody has clicked yet - the caller knows whether it
   * is empty, and this does not.
   */
  public isCollapsed(segment: string, whenUntouched = false): boolean {
    const chosen = this.collapsed.get(segment);
    return typeof chosen === 'undefined' ? whenUntouched : chosen;
  }

  /**
   * Flips a segment, given how it is drawn at the moment. The answer is kept
   * as the user's own, so a heap they opened while it was empty stays open
   * when the first allocation lands in it.
   */
  public toggleSegment(segment: string, collapsedNow = false): void {
    this.collapsed.set(segment, !this.isCollapsed(segment, collapsedNow));
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
    this.collapsed.clear();
  }
}
