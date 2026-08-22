import { StepModel, VariableModel, formatAddress } from '../../core';
import strings from '../../strings';
import { memoryRegionName } from './geometry';

/** One row in the compact debugger-style view of the current scope. */
export interface VariableTableRow {
  key: string;
  name: string;
  value: string;
  segment: string;
  address: string;
}

/**
 * File-scope objects and objects in the executing frame are visible in the
 * current C context. Caller locals remain alive in memory, but are not names
 * the callee can use, so the variable table deliberately leaves them to the
 * memory map and call stack.
 */
export function variableTableRows(model: StepModel): VariableTableRow[] {
  return model.variables
    .filter((variable: VariableModel) =>
      /^(Static|Heap):/.test(variable.name)
        ? false
        : variable.frame === 'GLOBAL'
          ? true
          : variable.active
    )
    .map((variable: VariableModel) => ({
      key: variable.key,
      name: variable.name,
      value: variable.value,
      segment: memoryRegionName(variable.region),
      address: formatAddress(variable.address),
    }));
}

/** The source context printed immediately above the table's columns. */
export function variableContextLabel(model: StepModel): string {
  const file = model.context.file ?? strings.variableNoContext;
  const fn =
    model.context.function === null
      ? strings.variableNoContext
      : `${model.context.function}()`;
  return `${strings.variableContextFile}: ${file}  ·  ${strings.variableContextFunction}: ${fn}`;
}
