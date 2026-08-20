/**
 * The handle between two boxes: drag it, and the boundary moves.
 *
 * It knows nothing about what it separates. It reports where the gesture has
 * put the boundary, in pixels along one axis, and the shell decides what that
 * means for the grid - which is the same division of labour every other widget
 * here follows, and the reason this can sit between any two boxes.
 *
 * A separator that the keyboard can reach is a `separator` with a tab stop, so
 * the arrow keys move the boundary a step at a time and Enter gives the
 * layout back to the stylesheet. A pointer does the same with a drag and a
 * double-click.
 */

export type SplitterAxis = 'x' | 'y';

export interface SplitterOptions {
  /** `x` moves the boundary sideways, `y` moves it up and down. */
  axis: SplitterAxis;
  /** What the handle is called, for the tooltip and for a screen reader. */
  label: string;
  /** The size of the box being resized, in pixels, as it is drawn now. */
  size: () => number;
  /** Where the gesture has put that size. The caller clamps and applies it. */
  resize: (size: number) => void;
  /** Double-click, or Enter: hand the size back to the stylesheet. */
  reset: () => void;
}

/** How far one arrow-key press moves a boundary. */
const KEY_STEP = 24;

export class Splitter {
  readonly element: HTMLDivElement;
  /** The pointer that owns the drag, or `null` when nothing is dragging. */
  private pointer: number | null = null;
  /** Where that pointer went down, and how big the box was then. */
  private origin = 0;
  private start = 0;

  constructor(private readonly options: SplitterOptions) {
    this.element = document.createElement('div');
    this.element.className = `plivet__splitter plivet__splitter--${options.axis}`;
    this.element.setAttribute('role', 'separator');
    // A separator's orientation is the line it draws, not the way it travels:
    // the handle between two columns is a vertical one.
    this.element.setAttribute(
      'aria-orientation',
      options.axis === 'x' ? 'vertical' : 'horizontal'
    );
    this.element.setAttribute('aria-label', options.label);
    this.element.title = options.label;
    this.element.tabIndex = 0;

    this.element.addEventListener('pointerdown', this.down);
    this.element.addEventListener('pointermove', this.move);
    this.element.addEventListener('pointerup', this.up);
    this.element.addEventListener('pointercancel', this.up);
    this.element.addEventListener('keydown', this.key);
    this.element.addEventListener('dblclick', this.reset);
  }

  destroy(): void {
    this.element.remove();
  }

  /**
   * The pointer coordinate this handle cares about. The other one is the
   * distance the hand has wandered off the handle, which is not a resize.
   */
  private along(event: PointerEvent): number {
    return this.options.axis === 'x' ? event.clientX : event.clientY;
  }

  private down = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    // Capturing means the drag follows the pointer off the handle and over the
    // editor without the boxes underneath ever seeing it, so no listener has
    // to be hung on the document and taken off again.
    this.pointer = event.pointerId ?? 0;
    if (typeof this.element.setPointerCapture === 'function') {
      this.element.setPointerCapture(this.pointer);
    }
    this.origin = this.along(event);
    this.start = this.options.size();
    this.element.classList.add('plivet__splitter--active');
    event.preventDefault();
  };

  private move = (event: PointerEvent): void => {
    if (this.pointer === null || (event.pointerId ?? 0) !== this.pointer) {
      return;
    }
    // Measured from where the drag began rather than from the last move, so a
    // boundary held against its limit does not drift away from the pointer.
    this.options.resize(this.start + this.along(event) - this.origin);
    event.preventDefault();
  };

  private up = (event: PointerEvent): void => {
    if (this.pointer === null || (event.pointerId ?? 0) !== this.pointer) {
      return;
    }
    if (typeof this.element.releasePointerCapture === 'function') {
      this.element.releasePointerCapture(this.pointer);
    }
    this.pointer = null;
    this.element.classList.remove('plivet__splitter--active');
  };

  private key = (event: KeyboardEvent): void => {
    const step = this.stepFor(event.key);
    if (step === 0) {
      if (event.key === 'Enter') {
        this.options.reset();
        event.preventDefault();
      }
      return;
    }
    this.options.resize(this.options.size() + step);
    event.preventDefault();
  };

  private stepFor(key: string): number {
    const grow = this.options.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    const shrink = this.options.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    if (key === grow) {
      return KEY_STEP;
    }
    return key === shrink ? -KEY_STEP : 0;
  }

  private reset = (): void => {
    this.options.reset();
  };
}
