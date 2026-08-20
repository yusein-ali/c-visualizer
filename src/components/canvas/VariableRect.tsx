import React from 'react';
import { Group } from 'react-konva';
import { CellGeometry } from '../../core';
import TextWithRect from './TextWithRect';

interface Props {
  row: CellGeometry[];
  onToggleFold: (group: string) => void;
}

interface State {}

export default class VariableRect extends React.Component<Props, State> {
  render() {
    const list = this.props.row.map((cell: CellGeometry) => {
      const { key, x, y, text, width, colors, foldTarget } = cell;
      const canToggleFold = typeof foldTarget !== 'undefined';
      return (
        <TextWithRect
          key={key}
          x={x}
          y={y}
          text={text}
          width={width}
          align={canToggleFold ? 'center' : undefined}
          onClick={
            typeof foldTarget === 'undefined'
              ? undefined
              : () => this.props.onToggleFold(foldTarget)
          }
          colors={colors}
        />
      );
    });
    return <Group>{list}</Group>;
  }
}
