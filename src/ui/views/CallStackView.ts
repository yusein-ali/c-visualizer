import { FrameModel } from '../../core';
import strings from '../../strings';

/**
 * The call stack, as a reader reads one: who called whom, from where, and
 * with what.
 *
 * The memory map already draws the frames as bands of storage, and that is a
 * different question. A frame there is an address and the objects in it; here
 * it is a call - the function, the line the call is written on, the arguments
 * it was passed, and how many times the run has been in it. The innermost
 * frame is at the top, because that is the one the step marker is in and the
 * one a reader is asking about.
 *
 * The arguments are what earns this view its place. C passes by value, and
 * nothing else on the screen says so; a frame that shows `n = 3` beside the
 * call that wrote `twice(i)` is that rule, said once per call.
 */
export class CallStackView {
  readonly root: HTMLElement;

  private readonly body: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'plivet-view plivet-view--stack';

    const title = document.createElement('h3');
    title.className = 'plivet-view__title';
    title.textContent = strings.viewCallStack;

    this.body = document.createElement('div');
    this.body.className = 'plivet-view__body';

    this.root.append(title, this.body);
    parent.appendChild(this.root);
    this.setFrames([]);
  }

  setFrames(frames: FrameModel[]): void {
    if (frames.length === 0) {
      this.body.replaceChildren(empty(strings.viewNothingRunning));
      return;
    }
    // Innermost first: the top of the list is where the program is.
    this.body.replaceChildren(
      ...frames
        .slice()
        .reverse()
        .map((frame, index) => this.frameRow(frame, index === 0))
    );
  }

  destroy(): void {
    this.root.remove();
  }

  private frameRow(frame: FrameModel, innermost: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'plivet-view__row';
    if (innermost) {
      row.classList.add('plivet-view__row--current');
    }

    const name = document.createElement('span');
    name.className = 'plivet-view__name';
    name.textContent = `${frame.name}()`;

    const where = document.createElement('span');
    where.className = 'plivet-view__where';
    where.textContent =
      frame.calledFrom === null
        ? `${strings.onLine} ${frame.line}`
        : `${strings.viewCalledFrom} ${frame.calledFrom}`;

    const args = document.createElement('span');
    args.className = 'plivet-view__args';
    args.textContent =
      frame.arguments.length === 0
        ? ''
        : frame.arguments
            .map((argument) =>
              argument.name === ''
                ? argument.value
                : `${argument.name} = ${argument.value}`
            )
            .join(', ');

    row.append(name, where, args);
    if (1 < frame.timesEntered) {
      const times = document.createElement('span');
      times.className = 'plivet-view__times';
      // A recursive call is the case where the count is the whole story.
      times.textContent = `${strings.factTimesEntered}: ${frame.timesEntered}`;
      row.appendChild(times);
    }
    return row;
  }
}

export const empty = (text: string): HTMLElement => {
  const line = document.createElement('p');
  line.className = 'plivet-view__empty';
  line.textContent = text;
  return line;
};
