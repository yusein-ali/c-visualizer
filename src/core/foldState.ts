import { foldPathOf } from './model';

/**
 * Which aggregates the user has opened, and which frames and segments they
 * have put away.
 *
 * Fold state used to live on the cells themselves, which meant it was rebuilt
 * from scratch every time the interpreter stepped - opening an array and
 * stepping once closed it again - and that a click on the canvas had to reach
 * back into the model and then ask the application to redraw. It belongs to
 * the view: it is a property of what this user is looking at, not of what the
 * program is doing, and it stays on the main thread while the model arrives
 * from the Worker.
 *
 * Nothing here holds an opinion of its own about how something should start.
 * Every one of the three asks its caller for the answer to give where the user
 * has not given one - a group is closed until opened, a segment holding
 * nothing is put away, a frame that is not the one running is closed - and
 * keeps only the answers the user did give. That is what lets the map settle
 * differently as the program moves while a reader's own clicks survive it.
 *
 * Groups are identified by the path of keys that reaches them, so a row is
 * hidden when any group on its path is folded. A segment and a frame are each
 * named by one key: collapsing a segment hides its whole table, and collapsing
 * a frame hides the run of rows belonging to that call.
 */
export class FoldState {
  private readonly folded = new Map<string, boolean>();
  private readonly collapsed = new Map<string, boolean>();
  private readonly frames = new Map<string, boolean>();

  /**
   * Whether an aggregate is drawn as its own row alone.
   *
   * An array or a struct starts closed. A frame is a handful of objects and a
   * `struct` is a handful of members, so a map that opens everything opens
   * with the shape of the data rather than the shape of the frame - and the
   * one object the reader is stepping past is somewhere down the list. What
   * they open stays open, which is the only part of this the model is not
   * entitled to an opinion about.
   */
  public isFolded(group: string): boolean {
    return this.folded.get(group) ?? true;
  }

  public toggle(group: string): void {
    this.folded.set(group, !this.isFolded(group));
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

  /**
   * Whether a call's frame is drawn as its heading alone. `whenUntouched` is
   * the answer for a frame nobody has clicked, and the caller is the one that
   * knows which frame is running: the others are closed, so that entering a
   * function puts the stack behind it away and leaves the objects the reader
   * is actually stepping through.
   */
  public isFrameFolded(frame: string, whenUntouched = false): boolean {
    const chosen = this.frames.get(frame);
    return typeof chosen === 'undefined' ? whenUntouched : chosen;
  }

  /** Flips a frame, given how it is drawn at the moment. */
  public toggleFrame(frame: string, foldedNow = false): void {
    this.frames.set(frame, !this.isFrameFolded(frame, foldedNow));
  }

  /** Whether a row in `group` is hidden by a fold at or above it. */
  public hides(group: string | undefined): boolean {
    if (group === undefined) {
      return false;
    }
    return foldPathOf(group).some((ancestor) => this.isFolded(ancestor));
  }

  public clear(): void {
    this.folded.clear();
    this.collapsed.clear();
    this.frames.clear();
  }
}
