export interface ZettelBoxRef {
  id?: string;
  name?: string;
  /** Full hierarchical path, "/"-separated from root to leaf. */
  path?: string;
  // Legacy shapes kept for backward compatibility with older payloads.
  zettelBoxName?: string;
  zettelBox?: {
    name?: string;
  };
}

export interface Note {
  title: string;
  createTime: string;
  updateTime?: string;
  content: string;
  noteId: string;
  type?: string;
  tags?: string[];
  isDel: boolean;
  isAudio?: boolean;
  audioUrl?: string;
  zettelBoxes?: Array<string | ZettelBoxRef>;
}

/** A single page of incrementally-synced notes returned by the sync endpoint. */
export interface NotesSyncPage {
  notes: Note[];
  nextCursor: string | null;
  hasMore: boolean;
  serverTime?: string;
}

/** A card box as returned by the zettelboxes endpoint, used to build the tree. */
export interface ZettelBoxNode {
  id: string;
  name: string;
  parentId: string | null;
  path: string | null;
  priority: number;
}

export interface TypeFoldersSettings {
  enabled: boolean;
  note: string;
  material: string;
}

export interface ZettelBoxFoldersSettings {
  enabled: boolean;
}

export interface SyncScopeSettings {
  /** When true, only notes in the selected boxes (and their sub-boxes) sync. */
  enabled: boolean;
  selectedBoxIds: string[];
}

export interface DailyNotesSettings {
  enabled: boolean;
  notebookId: string;
  basePath: string;
  heading: string;
  insertTo: "top" | "bottom";
  createIfMissing: boolean;
  includePreview: boolean;
  /** ref = SiYuan block reference ((id)); embed = block embed query. */
  linkStyle: "ref" | "embed";
}

export interface DinoPluginSettings {
  token: string;
  isAutoSync: boolean;
  notebookId: string;
  basePath: string;
  typeFolders: TypeFoldersSettings;
  zettelBoxFolders: ZettelBoxFoldersSettings;
  syncScope: SyncScopeSettings;
  template: string;
  filenameFormat: "noteId" | "title" | "time" | "titleDate" | "template";
  filenameTemplate: string;
  fileLayout: "flat" | "nested";
  ignoreSyncKey: string;
  preserveKeys: string;
  syncAllHotkey: string;
  syncCurrentHotkey: string;
  createNoteHotkey: string;
  dailyNotes: DailyNotesSettings;
}

export interface SyncState {
  lastSyncTime: string;
  notePathById: Record<string, string>;
}

export interface LocalDocInfo {
  id: string;
  path: string;
  hPath: string;
  title: string;
  attrs: Record<string, string>;
}

export interface DailyNoteEntryPayload {
  noteId: string;
  docId?: string;
  title?: string;
  preview?: string;
}

export interface DailyNoteChangeSet {
  added: DailyNoteEntryPayload[];
  removed: DailyNoteEntryPayload[];
}
