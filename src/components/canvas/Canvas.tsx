import * as React from 'react';
import { Stage } from 'react-konva';
import { slot } from '../emitter';
import CanvasContent from './CanvasContent';
import '../../css/canvas.css';
import { FoldState, StepModel, emptyStepModel, layout } from '../../core';

interface Props {
  width: number;
  height: number;
  scale: number;
}
interface State {
  model: StepModel;
}

/**
 * The visualization's place in the application: it holds the step the
 * interpreter last reported and the folds this reader has opened, and lays the
 * one out under the other.
 *
 * The step arrives already read: `extractModel` runs in the Worker, and
 * placing the cells belongs to `src/core`. What is left here is the Konva
 * stage, and Phase 8 replaces it with a JointJS paper reading the same
 * geometry.
 */
export default class Canvas extends React.Component<Props, State> {
  /**
   * Folds outlive the step: opening an array and stepping once used to close
   * it again, because the state was rebuilt with the cells.
   */
  private readonly folds = new FoldState();

  constructor(props: Props) {
    super(props);
    this.state = { model: emptyStepModel() };
    slot('draw', (model: StepModel) => this.setState({ model }));
  }

  private toggleFold = (group: string) => {
    this.folds.toggle(group);
    this.forceUpdate();
  };

  render() {
    return (
      <div id="display">
        <Stage
          width={0.95 * this.props.width}
          height={0.95 * this.props.height}
          scale={{ x: this.props.scale, y: this.props.scale }}
        >
          <CanvasContent
            geometry={layout(this.state.model, this.folds)}
            onToggleFold={this.toggleFold}
          />
        </Stage>
      </div>
    );
  }
}
