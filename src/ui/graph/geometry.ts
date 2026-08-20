import {
  FoldState,
  Geometry,
  StackModel,
  StepModel,
  formatAddress,
  layout,
} from '../../core';
import strings from '../../strings';

const segmentNames = {
  registers: strings.memoryRegisters,
  text: strings.memoryText,
  readOnly: strings.memoryReadOnly,
  data: strings.memoryData,
  bss: strings.memoryBss,
  heap: strings.memoryHeap,
  stack: strings.memoryStack,
};

/**
 * Presents the process memory through the renderer-neutral Phase 5 layout.
 * Keeping this adapter pure makes the JointJS surface testable without SVG.
 */
export function graphGeometry(model: StepModel, folds: FoldState): Geometry {
  if (model.memory.length === 0) {
    return layout(model, folds);
  }
  const stacks: StackModel[] = model.memory.map((segment) => ({
    key: `memory-${segment.key}`,
    name: `${segmentNames[segment.key]} · ${
      segment.key === 'registers' ? 'R0' : formatAddress(segment.startAddress)
    }`,
    rows: segment.rows,
  }));
  return layout({ ...model, stacks }, folds);
}
