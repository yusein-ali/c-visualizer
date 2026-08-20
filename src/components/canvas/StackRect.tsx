import * as React from 'react';
import VariableRect from './VariableRect';
import { Group } from 'react-konva';
import { StackGeometry } from '../../core';
import TextWithRect from './TextWithRect';

interface Props {
  stack: StackGeometry;
  onToggleFold: (group: string) => void;
}

interface State {}

export default class StackRect extends React.Component<Props, State> {
  renderHeader() {
    const { stack } = this.props;
    return (
      <TextWithRect
        x={stack.x}
        y={stack.y}
        text={stack.name}
        width={stack.width}
        fontStyle="bold"
        align="center"
      />
    );
  }

  renderBody() {
    return this.props.stack.rows.map((row) => (
      <VariableRect
        key={row.reduce((sum, cell) => sum.concat(cell.key), '')}
        row={row}
        onToggleFold={this.props.onToggleFold}
      />
    ));
  }

  render() {
    return (
      <Group>
        {this.renderHeader()}
        {this.renderBody()}
      </Group>
    );
  }
}
