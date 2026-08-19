import * as React from 'react';
import Button from 'react-bootstrap/lib/Button';
import Glyphicon from 'react-bootstrap/lib/Glyphicon';
import { stringFor } from '../../../strings';
import { signal, event } from '../../emitter';

interface Props {
  signal: event;
  command: string;
  icon: string;
  onClick?: () => void;
  enable: boolean;
  iconClass?: string;
}

interface State {}

export default class CtrlButton extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
  }
  render() {
    return (
      <Button
        title={stringFor(`${this.props.signal}${this.props.command}`)}
        onClick={() => {
          if (typeof this.props.onClick !== 'undefined') {
            this.props.onClick();
          }
          signal(this.props.signal, this.props.command);
        }}
        className="btn-outline-dark"
        disabled={!this.props.enable}
      >
        <Glyphicon glyph={this.props.icon} className={this.props.iconClass} />
      </Button>
    );
  }
}
