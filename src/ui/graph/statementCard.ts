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

const factLine = (
  fact: NonNullable<StatementExplanation['statement']>['facts'][number]
): string =>
  fact.value === ''
    ? finishSentence(sentenceLabel(fact.label))
    : `${sentenceLabel(fact.label)}: ${plainText(fact.value)}`;

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
  const multilineConstructs = new Set([
    sentenceCase(strings.constructIf),
    sentenceCase(strings.constructFor),
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
          : `${strings.statementOnLine} ${line}`,
      description:
        line === null
          ? ''
          : finishSentence(sentenceCase(statementSummary(model))),
      values: [],
    };
  }

  const title = sentenceCase(explanation.statement.title);
  return {
    title,
    context: line === null ? '' : `${strings.statementOnLine} ${line}`,
    description: descriptionOf(title, explanation.statement.facts),
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
