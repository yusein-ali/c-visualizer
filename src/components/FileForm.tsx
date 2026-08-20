import * as React from 'react';
import FormGroup from 'react-bootstrap/lib/FormGroup';
import PanelGroup from 'react-bootstrap/lib/PanelGroup';
import FormControl from 'react-bootstrap/lib/FormControl';
import ListGroupItem from 'react-bootstrap/lib/ListGroupItem';
import Panel from 'react-bootstrap/lib/Panel';

import '../css/fileform.css';
import strings from '../strings';
import { server } from '../core';
import FileItem from './FileItem';
import { slot } from './emitter';
interface Props {}

interface State {
  filelist: Map<string, ArrayBuffer> | null;
}

export default class FileForm extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { filelist: null };
    this.onFileSelected = this.onFileSelected.bind(this);
    this.onFileDelete = this.onFileDelete.bind(this);
    slot('files', (filelist: Map<string, ArrayBuffer>) => {
      this.setState({ filelist });
    });
  }

  async onFileSelected(e: React.FormEvent<FormControl>) {
    const target: HTMLInputElement = e.currentTarget as any;
    const files: FileList | null = target.files;
    if (files === null) {
      return;
    }
    try {
      const filelist = await server.upload(files);
      this.setState({ filelist });
      target.value = '';
    } catch (e) {
      // TypeScript types a caught value as `unknown`: whatever was thrown need
      // not be an Error, and here it comes from the FileReader.
      console.warn(e instanceof Error ? e.message : e);
      alert('Failed to upload files');
    }
  }

  onFileDelete(filename: string) {
    const filelist = server.delete(filename);
    this.setState({ filelist });
  }

  makeFileList() {
    const text = strings.uploadFile;
    const list = [];
    list.push(<ListGroupItem key={'text'}>{text}</ListGroupItem>);
    if (this.state.filelist !== null) {
      for (const [filename, arrayBuffer] of this.state.filelist) {
        list.push(
          <FileItem
            key={filename}
            filename={filename}
            arrayBuffer={arrayBuffer}
            onFileDelete={this.onFileDelete}
          />
        );
      }
    }
    list.push(
      <ListGroupItem key={'submit'}>
        <FormGroup>
          <FormControl
            type="file"
            id="files"
            name="files[]"
            multiple
            onChange={this.onFileSelected}
          />
        </FormGroup>
      </ListGroupItem>
    );
    return list;
  }

  render() {
    const list = this.makeFileList();
    return (
      <PanelGroup id="file-form" accordion={false} className="file-form">
        <Panel eventKey="1">
          <Panel.Heading>
            <Panel.Title toggle>File Upload</Panel.Title>
          </Panel.Heading>
          <Panel.Collapse>{list}</Panel.Collapse>
        </Panel>
      </PanelGroup>
    );
  }
}
