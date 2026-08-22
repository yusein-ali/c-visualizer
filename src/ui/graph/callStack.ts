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
    .map((frame, index) => {
      const argumentsText = frame.arguments
        .map((argument) =>
          argument.name === ''
            ? argument.value
            : `${argument.name} = ${argument.value}`
        )
        .join(', ');
      return {
        name: `${frame.name}(${argumentsText})`,
        where:
          frame.calledFrom === null
            ? `${strings.onLine} ${frame.line}`
            : typeof frame.calledFromFile === 'undefined'
              ? `${strings.viewCalledFrom} ${frame.calledFrom}`
              : `${strings.viewCalledFromFile} ${frame.calledFromFile} ${strings.viewLine} ${frame.calledFrom}`,
        arguments: argumentsText,
        timesEntered:
          1 < frame.timesEntered
            ? `${strings.factTimesEntered}: ${frame.timesEntered}`
            : '',
        current: index === 0,
      };
    });
}
