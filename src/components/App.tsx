import * as React from 'react';
import Grid from 'react-bootstrap/lib/Grid';
import Row from 'react-bootstrap/lib/Row';
import Col from 'react-bootstrap/lib/Col';
import EditorSide from './EditorSide';
import CanvasSide from './CanvasSide';
import { ThemeProps } from './Props';
import '../css/theme.css';
import Footer from './Footer';
type Props = ThemeProps;

interface State {}

export default class App extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
  }
  render() {
    const { theme } = this.props;
    return (
      <Grid fluid={true}>
        <Row style={{ margin: '5px' }}>
          <Col
            lg={4}
            md={5}
            sm={6}
            xs={12}
            className={theme === 'light' ? 'theme-light' : 'theme-gray'}
          >
            <EditorSide />
          </Col>
          <Col
            lg={8}
            md={7}
            sm={6}
            xs={12}
            className={theme === 'light' ? 'theme-light' : 'theme-gray'}
          >
            <CanvasSide />
          </Col>
        </Row>
        <Footer fromYear={2018} />
      </Grid>
    );
  }
}
