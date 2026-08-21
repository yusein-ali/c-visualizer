import { FrameModel } from '../../core';
import strings from '../../strings';

export interface CallStackRow {
  name: string;
  where: string;
  arguments: string;
  timesEntered: string;
  current: boolean;
}

/**
 * The active calls in the order a debugger reads them: the current call first.
 * Kept as plain rows so the JointJS renderer and its tests agree on the text
 * without either one reaching back into an interpreter object.
 */
export function callStackRows(frames: FrameModel[]): CallStackRow[] {
  return frames
    .slice()
    .reverse()
    .map((frame, index) => ({
      name: `${frame.name}()`,
      where:
        frame.calledFrom === null
          ? `${strings.onLine} ${frame.line}`
          : `${strings.viewCalledFrom} ${frame.calledFrom}`,
      arguments: frame.arguments
        .map((argument) =>
          argument.name === ''
            ? argument.value
            : `${argument.name} = ${argument.value}`
        )
        .join(', '),
      timesEntered:
        1 < frame.timesEntered
          ? `${strings.factTimesEntered}: ${frame.timesEntered}`
          : '',
      current: index === 0,
    }));
}
