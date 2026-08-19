import * as React from 'react';
import Row from 'react-bootstrap/lib/Row';
import Col from 'react-bootstrap/lib/Col';
import Menu from './menus/Menu';
import Editor from './Editor';
import Console from './Console';
import FileForm from './FileForm';

interface Props {}

interface State {}

export default class EditorSide extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
  }
  render() {
    return (
      <Row>
        <Col lg={12} md={12} sm={12} xs={12}>
          <Menu />
        </Col>
        <Col lg={12} md={12} sm={12} xs={12}>
          <Editor />
        </Col>
        <Col lg={12} md={12} sm={12} xs={12}>
          <Console />
        </Col>
        <Col lg={12} md={12} sm={12} xs={12}>
          <FileForm />
        </Col>
      </Row>
    );
  }
}
