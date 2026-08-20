import * as React from 'react';
import { Layer, Arrow } from 'react-konva';
import StackRect from './StackRect';
import { ArrowGeometry, Geometry, StackGeometry } from '../../core';
import hexToRgba from '../Color';

interface Props {
  geometry: Geometry;
  onToggleFold: (group: string) => void;
}

interface State {}

export default class CanvasContent extends React.Component<Props, State> {
  makeStacks(stacks: StackGeometry[]) {
    return stacks.map((stack) => (
      <StackRect
        key={stack.key}
        stack={stack}
        onToggleFold={this.props.onToggleFold}
      />
    ));
  }

  makeArrows(arrows: ArrowGeometry[]) {
    return arrows.map((arrow) => {
      const { from, mid, to, key, color } = arrow;
      const rgbaColor = hexToRgba(color);
      return (
        <Arrow
          key={key}
          points={[from.x, from.y, mid.x, mid.y, to.x, to.y]}
          tension={0.25} // 0だと折れ線
          stroke={rgbaColor}
          fill={rgbaColor} // △(pointer)部分
          pointerLength={10}
          pointerWidth={10}
          opacity={1.0}
        />
      );
    });
  }

  render() {
    const { stacks, arrows } = this.props.geometry;
    return (
      <React.Fragment>
        <Layer>{this.makeStacks(stacks)}</Layer>
        <Layer>{this.makeArrows(arrows)}</Layer>
      </React.Fragment>
    );
  }
}
