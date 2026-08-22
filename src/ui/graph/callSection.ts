import { CallExpansionModel } from '../../core';
import strings from '../../strings';

/**
 * How a call's own expansion is headed: `Call twice(n)`, or `Call printf(…)`
 * where the callee is a library function or reached through a pointer.
 *
 * The signature is what makes the tree below it readable as a call rather than
 * as one more operator: the arguments under the root fill these parameters,
 * left to right. Neither resolves without running the program for a pointer
 * call or a library function, so the heading then says the callee alone rather
 * than inventing names for what it cannot see.
 */
export const callHeading = (call: CallExpansionModel): string => {
  const name = call.callee.replace(/\(\)$/, '');
  const signature =
    call.parameters.length === 0
      ? call.callee
      : `${name}(${call.parameters.join(', ')})`;
  return `${strings.graphCallHeading} ${signature}`;
};
