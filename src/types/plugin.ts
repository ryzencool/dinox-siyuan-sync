export interface ZettelBoxRef {
  id?: string;
  name?: string;
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

export interface DayNote {
  date: string;
  notes: Note[];
}

export interface TypeFoldersSettings {
  enabled: boolean;
  note: string;
  material: string;
}

export interface ZettelBoxFoldersSettings {
  enabled: boolean;
}

export interface DailyNotesSettings {
  enabled: boolean;
  notebookId: string;
  basePath: string;
  heading: string;
  insertTo: "top" | "bottom";
  createIfMissing: boolean;
  includePreview: boolean;
}

export interface DinoPluginSettings {
  token: string;
  isAutoSync: boolean;
  notebookId: string;
  basePath: string;
  typeFolders: TypeFoldersSettings;
  zettelBoxFolders: ZettelBoxFoldersSettings;
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
