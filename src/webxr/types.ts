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
  overlayRoot?: HTMLElement;
  onStatus?: (status: ARStatus, detail?: string) => void;
  onEditRequest?: (uuid: string, currentText: string) => Promise<string | null>;
}

export interface ARHandle {
  end: () => void;
  setPendingText: (text: string) => void;
}
