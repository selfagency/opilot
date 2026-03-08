/**
 * Type definitions for saxophone
 */
declare module 'saxophone' {
  import { EventEmitter } from 'events';

  export interface SaxophoneTag {
    name: string;
    attrs?: string;
    isSelfClosing?: boolean;
  }

  export interface SaxophoneText {
    contents: string;
  }

  export interface SaxophoneCData {
    contents: string;
  }

  export interface SaxophoneComment {
    contents: string;
  }

  export default class Saxophone extends EventEmitter {
    parse(xml: string): void;
    write(chunk: string): void;
    end(): void;
    on(event: 'tagopen', listener: (tag: SaxophoneTag) => void): this;
    on(event: 'tagclose', listener: (tag: SaxophoneTag) => void): this;
    on(event: 'text', listener: (text: SaxophoneText) => void): this;
    on(event: 'cdata', listener: (cdata: SaxophoneCData) => void): this;
    on(event: 'comment', listener: (comment: SaxophoneComment) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'finish', listener: () => void): this;
  }
}
