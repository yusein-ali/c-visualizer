import { StepModel } from '../../core';
import strings from '../../strings';
import { StatementExplanation } from '../records';
import { statementSummary } from './geometry';

export interface StatementCardRow {
  label: string;
  value: string;
  labelCode: boolean;
  valueCode: boolean;
}

export interface StatementCardModel {
  title: string;
  context: string;
  /** The construct and all of its facts, kept inside one explanation cell. */
  description: string;
  /** Facts that can be shown as styled label/value rows instead of prose. */
  descriptionRows?: StatementCardRow[];
  values: StatementCardRow[];
}

const sentenceCase = (text: string): string =>
  text === '' ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const finishSentence = (text: string): string =>
  /[.!?]$/.test(text) ? text : `${text}.`;

/** Tooltip records mark code with backticks; the canvas has no Markdown pass. */
const plainText = (text: string): string => text.replace(/`/g, '');

const sentenceLabel = (label: string): string =>
  label === strings.factNonzero
    ? strings.statementReadsNonzero
    : label === strings.factZero
      ? strings.statementReadsZero
      : sentenceCase(plainText(label));

/** The source location is part of the statement identity, not just a line. */
const statementLocation = (model: StepModel, line: number | null): string => {
  const file = model.context.file ?? strings.variableNoContext;
  const functionName =
    model.context.function === null
      ? strings.variableNoContext
      : `${model.context.function}()`;
  const lineText = line === null ? strings.variableNoContext : String(line);
  return `${strings.statementContextFile}: ${file} · ${strings.statementContextLine}: ${lineText} · ${strings.statementContextFunction}: ${functionName}`;
};

/** Remove the old line-only prefix when an explanation adds a side note. */
const explanationNote = (
  explanationContext: string | undefined,
  line: number | null
): string => {
  if (explanationContext === undefined || line === null) {
    return explanationContext ?? '';
  }
  const prefix = `${strings.statementOnLine} ${line}`;
  if (explanationContext === prefix) {
    return '';
  }
  return explanationContext.startsWith(`${prefix} · `)
    ? explanationContext.slice(`${prefix} · `.length)
    : explanationContext;
};

const factLine = (
  fact: NonNullable<StatementExplanation['statement']>['facts'][number]
): string =>
  fact.value === ''
    ? finishSentence(sentenceLabel(fact.label))
    : `${sentenceLabel(fact.label)}: ${plainText(fact.value)}`;

const factRows = (
  facts: NonNullable<StatementExplanation['statement']>['facts']
): StatementCardRow[] | undefined =>
  facts.length === 0
    ? undefined
    : facts.map((fact) => ({
        // Empty values are narrative notes. `cardRow` renders those as a
        // full-width note, so they can share the same row layout as the
        // label/value facts instead of forcing the whole explanation into one
        // multiline cell.
        label: sentenceLabel(fact.label),
        value: plainText(fact.value),
        labelCode: false,
        valueCode: true,
      }));

/** A list that reads as prose rather than as columns in a data table. */
const list = (parts: string[]): string => {
  if (parts.length < 2) {
    return parts[0] ?? '';
  }
  if (parts.length === 2) {
    return `${parts[0]} ${strings.statementAnd} ${parts[1]}`;
  }
  return `${parts.slice(0, -1).join(', ')}, ${strings.statementAnd} ${parts[parts.length - 1]}`;
};

/**
 * Reads a structured tooltip record inside one cell on the canvas.
 *
 * Every part of a control-flow statement, function call, assignment and
 * declaration stays on the separate line the tooltip gives it, even though
 * those lines share one outer cell.
 */
const descriptionOf = (
  title: string,
  facts: NonNullable<StatementExplanation['statement']>['facts']
): string => {
  const clauses = new Set([
    strings.clauseCondition,
    strings.clauseInitialization,
    strings.clauseIteration,
    strings.clauseExpression,
    strings.clauseTarget,
    strings.clauseAssignedValue,
    strings.clauseTargetType,
    strings.clauseWhenTrue,
    strings.clauseWhenFalse,
    strings.clauseArgument,
  ]);
  const clauseFacts = facts.filter(
    (fact) => fact.value !== '' && clauses.has(fact.label)
  );
  const condition = clauseFacts.find(
    (fact) => fact.label === strings.clauseCondition
  );
  const evaluated = facts.find(
    (fact) => fact.label === strings.factConditionValue
  );
  const consumed = new Set([...clauseFacts, evaluated].filter(Boolean));
  const sentences: string[] = [];
  const functionCall = sentenceCase(strings.constructCall);
  const assignment = sentenceCase(strings.constructAssignment);
  // The constructs made of named clauses. A `for` reads as its three parts on
  // three lines rather than as one sentence listing them, and a `while` is the
  // same construct with two of the parts left out - so the loops are read the
  // same way whichever of them the reader is standing on.
  const multilineConstructs = new Set([
    sentenceCase(strings.constructIf),
    sentenceCase(strings.constructFor),
    sentenceCase(strings.constructWhile),
    sentenceCase(strings.constructDoWhile),
    sentenceCase(strings.constructSwitch),
  ]);

  if (
    multilineConstructs.has(title) ||
    title === functionCall ||
    title.startsWith(`${functionCall} —`) ||
    title === assignment ||
    clauseFacts.length === 0
  ) {
    return facts.map(factLine).join('\n');
  }

  if (clauseFacts.length === 1 && condition !== undefined) {
    const result =
      typeof evaluated === 'undefined'
        ? ''
        : `, ${strings.statementWhich} ${evaluated.label} ${plainText(evaluated.value)}`;
    sentences.push(
      finishSentence(
        `${plainText(title)} ${strings.statementWith} ${condition.label} ${plainText(condition.value)}${result}`
      )
    );
  } else if (clauseFacts.length !== 0) {
    sentences.push(
      finishSentence(
        `${title} ${strings.statementWith} ${list(
          clauseFacts.map(
            (fact) => `${plainText(fact.label)} ${plainText(fact.value)}`
          )
        )}`
      )
    );
    if (typeof evaluated !== 'undefined') {
      sentences.push(
        finishSentence(
          `${strings.statementControllingExpression} ${evaluated.label} ${plainText(evaluated.value)}`
        )
      );
    }
  }

  for (const fact of facts) {
    if (consumed.has(fact)) {
      continue;
    }
    const narrativeLabel = sentenceLabel(fact.label);
    sentences.push(
      finishSentence(
        fact.value === ''
          ? narrativeLabel
          : `${narrativeLabel} ${plainText(fact.value)}`
      )
    );
  }
  return sentences.join(' ');
};

/**
 * Turns the tooltip's records into the teaching card drawn on the canvas.
 * This stays renderer-neutral so the wording and grouping can be tested
 * without constructing a JointJS paper.
 */
export function statementCard(
  model: StepModel,
  explanation: StatementExplanation,
  includeValues: boolean
): StatementCardModel {
  const line =
    model.expression?.range.begin.y ?? model.codeRange?.begin.y ?? null;
  if (explanation.statement === null) {
    return {
      title:
        line === null ? strings.statementNoActive : strings.statementCurrent,
      context:
        line === null
          ? strings.statementStartHint
          : statementLocation(model, line),
      description:
        line === null
          ? ''
          : finishSentence(sentenceCase(statementSummary(model))),
      values: [],
    };
  }

  const title = sentenceCase(explanation.statement.title);
  const location = statementLocation(model, line);
  const note = explanationNote(explanation.context, line);
  return {
    title,
    context: note === '' ? location : `${location} · ${note}`,
    description: descriptionOf(title, explanation.statement.facts),
    descriptionRows: factRows(explanation.statement.facts),
    values: includeValues
      ? explanation.parts.map((part) => ({
          label: part.title,
          value: part.facts[0]?.value ?? strings.none,
          labelCode: true,
          valueCode: true,
        }))
      : [],
  };
}
