// src/thinkingParser.ts

type ThinkingState =
  | 'lookingForOpening'
  | 'thinkingStartedEatingWhitespace'
  | 'thinking'
  | 'thinkingDoneEatingWhitespace'
  | 'thinkingDone';

export class ThinkingParser {
  private state: ThinkingState = 'lookingForOpening';
  private acc = '';
  readonly openingTag: string;
  readonly closingTag: string;

  constructor(openingTag = '<think>', closingTag = '</think>') {
    this.openingTag = openingTag;
    this.closingTag = closingTag;
  }

  /**
   * Feed a chunk of streamed content. Returns [thinkingContent, regularContent].
   * May buffer internally if the chunk ends mid-tag.
   */
  addContent(content: string): [string, string] {
    this.acc += content;
    let thinkingOut = '';
    let contentOut = '';
    let keepLooping = true;

    while (keepLooping) {
      const [t, c, more] = this.eat();
      thinkingOut += t;
      contentOut += c;
      keepLooping = more;
    }

    return [thinkingOut, contentOut];
  }

  private eat(): [string, string, boolean] {
    switch (this.state) {
      case 'lookingForOpening': {
        const trimmed = this.acc.trimStart();
        if (trimmed.startsWith(this.openingTag)) {
          const after = trimmed.slice(this.openingTag.length).trimStart();
          this.acc = after;
          this.state = after === '' ? 'thinkingStartedEatingWhitespace' : 'thinking';
          return ['', '', true];
        } else if (this.openingTag.startsWith(trimmed) && trimmed !== '') {
          // partial opening tag — keep buffering
          return ['', '', false];
        } else if (trimmed === '') {
          // only whitespace so far — keep buffering
          return ['', '', false];
        } else {
          // no think tag — pass everything through as content
          this.state = 'thinkingDone';
          const out = this.acc;
          this.acc = '';
          return ['', out, false];
        }
      }

      case 'thinkingStartedEatingWhitespace': {
        const trimmed = this.acc.trimStart();
        this.acc = '';
        if (trimmed === '') return ['', '', false];
        this.state = 'thinking';
        this.acc = trimmed;
        return ['', '', true];
      }

      case 'thinking': {
        const idx = this.acc.indexOf(this.closingTag);
        if (idx !== -1) {
          const thinking = this.acc.slice(0, idx);
          const afterRaw = this.acc.slice(idx + this.closingTag.length);
          const after = afterRaw.trimStart();
          this.acc = ''; // clear — after is returned directly, not re-emitted
          // Only enter whitespace-eating state when there was trailing whitespace
          // on the same chunk as </think>. If afterRaw was empty, go straight to
          // thinkingDone so the next chunk's leading space is preserved.
          if (afterRaw === '') {
            this.state = 'thinkingDone';
          } else {
            this.state = after === '' ? 'thinkingDoneEatingWhitespace' : 'thinkingDone';
          }
          return [thinking, after, false];
        }
        // Buffer everything — don't emit until we find the closing tag.
        // (Partial closing tag at end stays buffered in acc as-is.)
        return ['', '', false];
      }

      case 'thinkingDoneEatingWhitespace': {
        const trimmed = this.acc.trimStart();
        this.acc = '';
        if (trimmed !== '') this.state = 'thinkingDone';
        return ['', trimmed, false];
      }

      case 'thinkingDone': {
        const out = this.acc;
        this.acc = '';
        return ['', out, false];
      }
    }
  }
}
