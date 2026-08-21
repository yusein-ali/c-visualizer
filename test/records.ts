import { HoverFact, HoverRecord } from '../src/ui/editor';

/**
 * A hover record as one block of text: the headline, then a line per fact.
 *
 * The tooltip sets a record as a table and the canvas reads the same records
 * for its own purposes, so there is no one rendering to assert against. This
 * is the tests' own reading of a record, kept in one place so that a change to
 * what is said is one change here and not one per assertion.
 */
export const factLines = (facts: HoverFact[]): string =>
  facts
    .map((fact) =>
      fact.value === '' ? fact.label : `${fact.label}: ${fact.value}`
    )
    .join('\n');

export const linesOf = (record: HoverRecord | null): string =>
  record === null
    ? ''
    : [record.title, factLines(record.facts)]
        .filter((part) => part !== '')
        .join('\n');
