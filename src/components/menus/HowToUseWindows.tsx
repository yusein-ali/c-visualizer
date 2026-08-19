import * as React from 'react';
import Button from 'react-bootstrap/lib/Button';
import Modal from 'react-bootstrap/lib/Modal';

import strings from '../../strings';
interface Props {
  handleHideModal: any;
}

interface State {
  isShow: boolean;
}

export default class HowToUseWindows extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { isShow: false };
  }
  renderModalHeader() {
    return (
      <Modal.Header closeButton>
        <Modal.Title>{strings.howToUse}</Modal.Title>
      </Modal.Header>
    );
  }
  renderModalBody() {
    const howToText: string[] = strings.howToText;
    return (
      <Modal.Body>
        {howToText.map((m: string, i: number) => (
          <p key={i}>{m.trim()}</p>
        ))}
      </Modal.Body>
    );
  }
  renderModalFooter() {
    return (
      <Modal.Footer>
        <Button onClick={this.props.handleHideModal}>{strings.close}</Button>
      </Modal.Footer>
    );
  }
  render() {
    return (
      <div>
        <Modal
          className="modal-container"
          show={true}
          aria-labelledby="ModalHeader"
          onHide={this.props.handleHideModal}
          animation={true}
          tabIndex={-1}
          role="dialog"
        >
          {this.renderModalHeader()}
          {this.renderModalBody()}
          {this.renderModalFooter()}
        </Modal>
      </div>
    );
  }
}
