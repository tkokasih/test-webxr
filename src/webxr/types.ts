export interface NoteRecord {
  uuid: string;
  text: string;
}

export type ARStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'ended'
  | 'unsupported'
  | 'persistent-unsupported'
  | 'limit'
  | 'error';

export interface StartAROpts {
  initialText?: string;
  onStatus?: (status: ARStatus, detail?: string) => void;
}

export interface ARHandle {
  end: () => void;
  setPendingText: (text: string) => void;
}
