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
  /** The construct and all of its facts, read as one continuous explanation. */
  description: string;
  values: StatementCardRow[];
}

const sentenceCase = (text: string): string =>
  text === '' ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const finishSentence = (text: string): string =>
  /[.!?]$/.test(text) ? text : `${text}.`;

const code = (text: string): string => `\`${text}\``;

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
 * Reads a structured tooltip record as a short paragraph for the canvas.
 *
 * The tooltip keeps its rows because it answers one precise hover. Here the
 * reader is following a whole statement, so borders between the clause, its
 * result and the meaning C gives that result only break one explanation into
 * unrelated-looking pieces.
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

  if (clauseFacts.length === 1 && condition !== undefined) {
    const result =
      typeof evaluated === 'undefined'
        ? ''
        : `, ${strings.statementWhich} ${evaluated.label} ${code(evaluated.value)}`;
    sentences.push(
      finishSentence(
        `${title} ${strings.statementWith} ${condition.label} ${code(condition.value)}${result}`
      )
    );
  } else if (clauseFacts.length !== 0) {
    sentences.push(
      finishSentence(
        `${title} ${strings.statementWith} ${list(
          clauseFacts.map((fact) => `${fact.label} ${code(fact.value)}`)
        )}`
      )
    );
    if (typeof evaluated !== 'undefined') {
      sentences.push(
        finishSentence(
          `${strings.statementControllingExpression} ${evaluated.label} ${code(evaluated.value)}`
        )
      );
    }
  } else {
    sentences.push(finishSentence(title));
  }

  for (const fact of facts) {
    if (consumed.has(fact)) {
      continue;
    }
    const narrativeLabel =
      fact.label === strings.factNonzero
        ? strings.statementReadsNonzero
        : fact.label === strings.factZero
          ? strings.statementReadsZero
          : sentenceCase(fact.label);
    sentences.push(
      finishSentence(
        fact.value === ''
          ? narrativeLabel
          : `${narrativeLabel} ${code(fact.value)}`
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
