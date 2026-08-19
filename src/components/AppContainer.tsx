import * as React from 'react';
import App from './App';
import { slot } from './emitter';
import { Theme } from './Props';

interface Props {}

interface State {
  theme: Theme;
}

export default class AppContainer extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { theme: 'light' };
    slot('changeTheme', async (theme: Theme) => {
      this.setState({ theme });
    });
  }
  render() {
    return <App theme={this.state.theme} />;
  }
}
