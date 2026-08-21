import {
  ConstructStateModel,
  FoldState,
  Geometry,
  MemoryGeometry,
  MemoryRegion,
  MemorySegmentModel,
  StepModel,
  ViewOptions,
  layout,
  layoutMemory,
  rangeCovers,
  rangeSpan,
  startsShown,
} from '../../core';
import strings, { stringFor } from '../../strings';

const segmentNames: Record<MemoryRegion, string> = {
  registers: strings.memoryRegisters,
  text: strings.memoryText,
  readOnly: strings.memoryReadOnly,
  data: strings.memoryData,
  bss: strings.memoryBss,
  heap: strings.memoryHeap,
  stack: strings.memoryStack,
};

/**
 * The regions in the order the map reads them: the left-hand column from the
 * top, then the right-hand one. A list of them belongs on this side of the
 * core, beside the names, because it is only ever needed by something showing
 * them to a reader - the layout takes its own order from the model.
 */
export const MEMORY_REGIONS: MemoryRegion[] = [
  'registers',
  'stack',
  'heap',
  'bss',
  'data',
  'readOnly',
  'text',
];

/** What the reader calls a region. */
export function memoryRegionName(region: MemoryRegion): string {
  return segmentNames[region];
}

/**
 * The innermost construct the step is inside.
 *
 * The smallest range covering the marker wins, the same rule the tooltip uses
 * to choose between a loop and the `if` inside it. A record is only ever here
 * for the step being shown, so a stopped session has none.
 */
function innermostConstruct(model: StepModel): ConstructStateModel | null {
  const { codeRange } = model;
  if (codeRange === null) {
    return null;
  }
  let found: ConstructStateModel | null = null;
  for (const state of model.constructStates) {
    if (
      rangeCovers(state.range, codeRange.begin.y, codeRange.begin.x) &&
      (found === null || rangeSpan(state.range) < rangeSpan(found.range))
    ) {
      found = state;
    }
  }
  return found;
}

/**
 * What the statement section says when there is no expansion to draw.
 *
 * The section's heading is always on the canvas, so it always has to have
 * something under it. This is the construct the step is inside and what it is
 * doing - read from the same records the tooltip reads, so that the canvas and
 * the hover never give a reader two accounts of one step.
 */
export function statementSummary(model: StepModel): string {
  const state = innermostConstruct(model);
  if (state === null) {
    return strings.statementNotRunning;
  }
  const name = stringFor(
    `construct${state.kind.charAt(0).toUpperCase()}${state.kind.slice(1)}`
  );
  const facts = state.facts.map((fact) =>
    fact.value === ''
      ? stringFor(fact.label)
      : `${stringFor(fact.label)}: ${fact.value}`
  );
  return facts.length === 0 ? name : `${name} — ${facts.join(', ')}`;
}

/**
 * Presents the process memory through the renderer-neutral Phase 5 layouts.
 * Keeping these adapters pure makes the JointJS surface testable without SVG.
 *
 * The core carries no display text - a segment is called `bss` there - so the
 * one thing this adds is the name a reader sees on the node.
 *
 * A region that is not shown is dropped before the layout runs rather than
 * hidden after it, so the map closes up over it: the segments below take its
 * place, the columns are sized by what is left, and the arrows into it go with
 * its rows. A region holding nothing at this step is one of those until the
 * reader asks for it, unless it is one of the bands `startsShown` keeps on the
 * map whatever they hold. That is what `ViewOptions` is told here - it knows
 * what the reader chose, and this knows what is in the segment.
 */
export function memoryGeometry(
  model: StepModel,
  folds: FoldState,
  view: ViewOptions = new ViewOptions()
): MemoryGeometry {
  const memory: MemorySegmentModel[] = model.memory
    .filter((segment) =>
      view.isRegionShown(
        segment.key,
        startsShown(segment.key, segment.rows.length > 0)
      )
    )
    .map((segment) => ({
      ...segment,
      name: segmentNames[segment.key],
    }));
  return layoutMemory({ ...model, memory }, folds);
}

/**
 * The call-frame tables. A step that carries memory segments is drawn as a
 * memory map instead, so this is what is left for a model that has stacks and
 * no segments - the empty model the graph starts on, and any caller that
 * builds a step by hand.
 */
export function graphGeometry(model: StepModel, folds: FoldState): Geometry {
  return layout(model, folds);
}
