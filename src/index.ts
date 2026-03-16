import {
  Plugin,
  showMessage,
  confirm,
  Menu,
  getFrontend,
  Setting,
} from "siyuan";
import "@/index.scss";

import {
  createDocWithMd,
  exportMdContent,
  exportMdContentWithoutFrontmatterAndTitle,
  getBlockAttrs,
  getBlockByID,
  getIDsByHPath,
  getPathByID,
  removeDoc,
  setBlockAttrs,
  sql,
  updateBlock,
} from "@/api";
import {
  API_BASE_URL,
  DEFAULT_LAST_SYNC_TIME,
  DEFAULT_TEMPLATE_TEXT,
  SETTINGS_STORAGE_FILE,
  STORAGE_NAME,
  SYNC_STATE_NAME,
} from "./constants";
import { createDinoxNote, fetchNotesFromApi, updateDinoxNote } from "./dinox-api";
import {
  extractAllTagsFromMarkdown,
  extractFrontmatterScalar,
  mergeFrontmatter,
  parseFrontmatterRecord,
  splitFrontmatter,
} from "./markdown";
import { SettingUtils } from "./libs/setting-utils";
import type {
  DailyNoteChangeSet,
  DinoPluginSettings,
  LocalDocInfo,
  Note,
  SyncState,
} from "./types/plugin";
import {
  categorizeType,
  firstZettelBoxName,
  formatDate,
  getErrorMessage,
  normalizeDinoxDateTime,
  parseDate,
  resolveBaseHPath,
  sanitizeFilename,
  sanitizeFolderSegment,
} from "./utils";

const DEFAULT_SETTINGS: DinoPluginSettings = {
  token: "",
  isAutoSync: false,
  notebookId: "",
  basePath: "Dinox Sync",
  typeFolders: {
    enabled: true,
    note: "note",
    material: "material",
  },
  zettelBoxFolders: {
    enabled: false,
  },
  template: DEFAULT_TEMPLATE_TEXT,
  filenameFormat: "noteId",
  filenameTemplate: "{{title}} ({{createDate}})",
  fileLayout: "nested",
  ignoreSyncKey: "ignore_sync",
  preserveKeys: "",
  syncAllHotkey: "",
  syncCurrentHotkey: "",
  createNoteHotkey: "",
  dailyNotes: {
    enabled: false,
    notebookId: "",
    basePath: "Daily Notes/Dinox",
    heading: "## Dinox Notes",
    insertTo: "bottom",
    createIfMissing: true,
    includePreview: false,
  },
};

const DEFAULT_SYNC_STATE: SyncState = {
  lastSyncTime: DEFAULT_LAST_SYNC_TIME,
  notePathById: {},
};

export default class DinoxSiyuanPlugin extends Plugin {
  private static readonly SYNC_MESSAGE_ID = "dinox-sync-status";
  private readonly editorTitleIconEventBindThis =
    this.editorTitleIconEvent.bind(this);
  private settings!: DinoPluginSettings;
  private settingUtils!: SettingUtils;
  private isMobile = false;
  private isSyncing = false;
  private autoSyncTimer: number | null = null;
  private readonly keydownHandler = this.handleWindowKeydown.bind(this);

  async onload() {
    try {
      if (!this.setting) {
        this.setting = new Setting({});
      }

      await this.loadSettings();
      this.buildSettingsPanel();

      this.isMobile =
        getFrontend() === "mobile" || getFrontend() === "browser-mobile";

      this.eventBus.on(
        "click-editortitleicon",
        this.editorTitleIconEventBindThis
      );
      window.addEventListener("keydown", this.keydownHandler);

      this.addIcons(`<symbol id="iconDinoxSync" viewBox="0 0 28 28">
  <path d="M10 4h8a8 8 0 0 1 0 16h-8v-16zM12 6v12h6a6 6 0 0 0 0-12h-6z"/>
</symbol>`);

      const topBarElement = this.addTopBar({
        icon: "iconDinoxSync",
        title: "Dinox 同步",
        position: "right",
        callback: () => {
          if (this.isMobile) {
            this.openTopBarMenu();
            return;
          }
          let rect = topBarElement.getBoundingClientRect();
          if (rect.width === 0) {
            rect = document.querySelector("#barMore")?.getBoundingClientRect?.() as
              | DOMRect
              | undefined;
          }
          if (rect?.width) {
            this.openTopBarMenu(rect);
          } else {
            this.openTopBarMenu();
          }
        },
      });

      try {
        this.registerCommands();
      } catch (error) {
        console.error("Dinox command registration failed:", error);
        showMessage(`命令注册失败：${getErrorMessage(error)}`, 5000, "error");
      }
      this.refreshAutoSyncSchedule();
    } catch (error) {
      console.error("Dinox plugin onload failed:", error);
      showMessage(`插件初始化失败：${getErrorMessage(error)}`, 7000, "error");
    }
  }

  private isMacPlatform(): boolean {
    return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  }

  private getPlatformDefaultHotkeys(): {
    syncAllHotkey: string;
    syncCurrentHotkey: string;
    createNoteHotkey: string;
  } {
    if (this.isMacPlatform()) {
      return {
        syncAllHotkey: "⌘+⇧+D",
        syncCurrentHotkey: "⌘+⇧+S",
        createNoteHotkey: "⌘+⇧+N",
      };
    }
    return {
      syncAllHotkey: "Ctrl+Shift+D",
      syncCurrentHotkey: "Ctrl+Shift+S",
      createNoteHotkey: "Ctrl+Shift+N",
    };
  }

  private showSyncMessage(
    text: string,
    timeout: number,
    type: "info" | "error" = "info"
  ) {
    showMessage(text, timeout, type, DinoxSiyuanPlugin.SYNC_MESSAGE_ID);
  }

  private migrateHotkey(value: string, fallback: string): string {
    const raw = (value || "").trim();
    if (!raw) {
      return fallback;
    }
    if (this.isMacPlatform()) {
      return raw
        .replace(/\bCtrl\b/gi, "⌘")
        .replace(/\bCmd\b/gi, "⌘")
        .replace(/\bMod\b/gi, "⌘")
        .replace(/\bShift\b/gi, "⇧")
        .replace(/\bAlt\b/gi, "⌥");
    }
    return raw
      .replace(/⌘/g, "Ctrl")
      .replace(/⇧/g, "Shift")
      .replace(/⌥/g, "Alt")
      .replace(/\bMod\b/gi, "Ctrl")
      .replace(/\bCmd\b/gi, "Ctrl");
  }

  onLayoutReady() {
    this.settingUtils?.load();
  }

  onunload() {
    this.stopAutoSync();
    this.eventBus.off(
      "click-editortitleicon",
      this.editorTitleIconEventBindThis
    );
    window.removeEventListener("keydown", this.keydownHandler);
  }

  private registerCommands() {
    this.addCommand({
      langKey: "dinoxSyncAll",
      langText: "同步 Dinox 到思源",
      hotkey: "",
      callback: async () => {
        await this.syncNotes();
      },
    });

    this.addCommand({
      langKey: "dinoxSyncCurrent",
      langText: "同步当前文档到 Dinox",
      hotkey: "",
      callback: async () => {
        const docId = await this.getCurrentDocId();
        if (!docId) {
          showMessage("未找到当前文档", 3000, "error");
          return;
        }
        await this.smartSyncDocToDinox(docId);
      },
    });

    this.addCommand({
      langKey: "dinoxCreateCurrent",
      langText: "创建当前文档到 Dinox",
      hotkey: "",
      callback: async () => {
        const docId = await this.getCurrentDocId();
        if (!docId) {
          showMessage("未找到当前文档", 3000, "error");
          return;
        }
        await this.createCurrentDocToDinox(docId);
      },
    });

    this.addCommand({
      langKey: "dinoxSendSelection",
      langText: "发送选中文本到 Dinox",
      hotkey: "",
      callback: async () => {
        await this.sendSelectedTextToDinox();
      },
    });
  }

  private async loadSettings() {
    const loaded = (await this.loadData(SETTINGS_STORAGE_FILE)) || {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      typeFolders: {
        ...DEFAULT_SETTINGS.typeFolders,
        ...(loaded.typeFolders || {}),
      },
      zettelBoxFolders: {
        ...DEFAULT_SETTINGS.zettelBoxFolders,
        ...(loaded.zettelBoxFolders || {}),
      },
      dailyNotes: {
        ...DEFAULT_SETTINGS.dailyNotes,
        ...(loaded.dailyNotes || {}),
      },
    };
    const defaults = this.getPlatformDefaultHotkeys();
    this.settings.syncAllHotkey = this.migrateHotkey(
      this.settings.syncAllHotkey,
      defaults.syncAllHotkey
    );
    this.settings.syncCurrentHotkey = this.migrateHotkey(
      this.settings.syncCurrentHotkey,
      defaults.syncCurrentHotkey
    );
    this.settings.createNoteHotkey = this.migrateHotkey(
      this.settings.createNoteHotkey,
      defaults.createNoteHotkey
    );
  }

  private async saveSettings() {
    await this.saveData(SETTINGS_STORAGE_FILE, this.settings);
  }

  private parseConfiguredHotkey(value: string): {
    key: string;
    mod: boolean;
    alt: boolean;
    shift: boolean;
  } | null {
    const raw = (value || "")
      .trim()
      .replace(/⌘/g, "Mod")
      .replace(/⇧/g, "Shift")
      .replace(/⌥/g, "Alt")
      .replace(/⌃/g, "Ctrl");
    if (!raw) {
      return null;
    }

    const parts = raw
      .split("+")
      .map((item) => item.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      return null;
    }

    let key = "";
    let mod = false;
    let alt = false;
    let shift = false;

    for (const part of parts) {
      const normalized = part.toLowerCase();
      if (
        normalized === "ctrl" ||
        normalized === "control" ||
        normalized === "cmd" ||
        normalized === "command" ||
        normalized === "mod"
      ) {
        mod = true;
        continue;
      }
      if (normalized === "alt" || normalized === "option") {
        alt = true;
        continue;
      }
      if (normalized === "shift") {
        shift = true;
        continue;
      }
      key = part.length === 1 ? part.toUpperCase() : part;
    }

    if (!key) {
      return null;
    }

    return { key, mod, alt, shift };
  }

  private matchesConfiguredHotkey(event: KeyboardEvent, hotkey: string): boolean {
    const parsed = this.parseConfiguredHotkey(hotkey);
    if (!parsed) {
      return false;
    }

    const eventKey = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    const eventMod = this.isMacPlatform()
      ? event.metaKey || event.ctrlKey
      : event.ctrlKey || event.metaKey;

    return (
      eventKey === parsed.key &&
      eventMod === parsed.mod &&
      event.altKey === parsed.alt &&
      event.shiftKey === parsed.shift
    );
  }

  private async handleWindowKeydown(event: KeyboardEvent) {
    if (event.repeat) {
      return;
    }

    if (this.matchesConfiguredHotkey(event, this.settings.syncAllHotkey)) {
      event.preventDefault();
      event.stopPropagation();
      await this.syncNotes();
      return;
    }

    if (this.matchesConfiguredHotkey(event, this.settings.syncCurrentHotkey)) {
      event.preventDefault();
      event.stopPropagation();
      const docId = await this.getCurrentDocId();
      if (docId) {
        await this.smartSyncDocToDinox(docId);
      }
      return;
    }

    if (this.matchesConfiguredHotkey(event, this.settings.createNoteHotkey)) {
      event.preventDefault();
      event.stopPropagation();
      const docId = await this.getCurrentDocId();
      if (docId) {
        await this.createCurrentDocToDinox(docId);
      }
    }
  }

  private async loadSyncState(): Promise<SyncState> {
    const loaded = (await this.loadData(SYNC_STATE_NAME)) || {};
    return {
      ...DEFAULT_SYNC_STATE,
      ...loaded,
      notePathById: {
        ...DEFAULT_SYNC_STATE.notePathById,
        ...(loaded.notePathById || {}),
      },
    };
  }

  private async saveSyncState(state: SyncState) {
    await this.saveData(SYNC_STATE_NAME, state);
  }

  private refreshAutoSyncSchedule() {
    this.stopAutoSync();
    if (!this.settings.isAutoSync) {
      return;
    }
    this.autoSyncTimer = window.setInterval(async () => {
      if (!this.isSyncing) {
        await this.syncNotes();
      }
    }, 30 * 60 * 1000);
  }

  private stopAutoSync() {
    if (this.autoSyncTimer !== null) {
      window.clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }

  private buildSettingsPanel() {
    this.settingUtils = new SettingUtils({
      plugin: this,
      name: STORAGE_NAME,
    });

    this.settingUtils.addItem({
      key: "notebookId",
      value: this.settings.notebookId,
      type: "textinput",
      title: "笔记本 ID",
      description: "同步目标笔记本 ID",
      action: {
        callback: async () => {
          this.settings.notebookId = String(
            await this.settingUtils.takeAndSave("notebookId")
          ).trim();
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "basePath",
      value: this.settings.basePath,
      type: "textinput",
      title: "根目录",
      description: "在目标笔记本下创建的 Dinox 根目录",
      action: {
        callback: async () => {
          this.settings.basePath = String(
            await this.settingUtils.takeAndSave("basePath")
          ).trim();
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "token",
      value: this.settings.token,
      type: "textinput",
      title: "Dinox Token",
      description: "Dinox API 授权 Token",
      action: {
        callback: async () => {
          this.settings.token = String(
            await this.settingUtils.takeAndSave("token")
          ).trim();
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "filenameFormat",
      value: this.settings.filenameFormat,
      type: "select",
      title: "文件名格式",
      description: "控制新同步文档的命名方式",
      options: {
        noteId: "noteId",
        title: "标题",
        time: "创建时间",
        titleDate: "标题 + 日期",
        template: "模板",
      },
      action: {
        callback: async () => {
          this.settings.filenameFormat = (await this.settingUtils.takeAndSave(
            "filenameFormat"
          )) as DinoPluginSettings["filenameFormat"];
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "filenameTemplate",
      value: this.settings.filenameTemplate,
      type: "textinput",
      title: "文件名模板",
      description: "可用变量：{{title}} {{createDate}} {{createTime}} {{noteId}}",
      action: {
        callback: async () => {
          this.settings.filenameTemplate = String(
            await this.settingUtils.takeAndSave("filenameTemplate")
          ).trim();
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "fileLayout",
      value: this.settings.fileLayout,
      type: "select",
      title: "目录布局",
      description: "是否按日期创建目录",
      options: {
        nested: "按日期分层",
        flat: "平铺",
      },
      action: {
        callback: async () => {
          this.settings.fileLayout = (await this.settingUtils.takeAndSave(
            "fileLayout"
          )) as DinoPluginSettings["fileLayout"];
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "typeFoldersEnabled",
      value: this.settings.typeFolders.enabled,
      type: "checkbox",
      title: "按类型分目录",
      description: "将 note / crawl 分别写入不同目录",
      action: {
        callback: async () => {
          this.settings.typeFolders.enabled = Boolean(
            await this.settingUtils.takeAndSave("typeFoldersEnabled")
          );
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "typeFolderNote",
      value: this.settings.typeFolders.note,
      type: "textinput",
      title: "普通笔记目录",
      description: "type=note 时使用",
      action: {
        callback: async () => {
          this.settings.typeFolders.note =
            sanitizeFolderSegment(
              String(await this.settingUtils.takeAndSave("typeFolderNote"))
            ) || DEFAULT_SETTINGS.typeFolders.note;
          this.settingUtils.set("typeFolderNote", this.settings.typeFolders.note);
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "typeFolderMaterial",
      value: this.settings.typeFolders.material,
      type: "textinput",
      title: "资料目录",
      description: "type=crawl/material 时使用",
      action: {
        callback: async () => {
          this.settings.typeFolders.material =
            sanitizeFolderSegment(
              String(await this.settingUtils.takeAndSave("typeFolderMaterial"))
            ) || DEFAULT_SETTINGS.typeFolders.material;
          this.settingUtils.set(
            "typeFolderMaterial",
            this.settings.typeFolders.material
          );
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "zettelBoxFoldersEnabled",
      value: this.settings.zettelBoxFolders.enabled,
      type: "checkbox",
      title: "按卡片盒分目录",
      description: "存在 zettelBoxes 时使用首个卡片盒名作为目录",
      action: {
        callback: async () => {
          this.settings.zettelBoxFolders.enabled = Boolean(
            await this.settingUtils.takeAndSave("zettelBoxFoldersEnabled")
          );
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "ignoreSyncKey",
      value: this.settings.ignoreSyncKey,
      type: "textinput",
      title: "忽略同步键",
      description: "文档 frontmatter 或属性中存在该键且为 true 时跳过同步",
      action: {
        callback: async () => {
          const raw = String(
            await this.settingUtils.takeAndSave("ignoreSyncKey")
          ).trim();
          this.settings.ignoreSyncKey = raw || DEFAULT_SETTINGS.ignoreSyncKey;
          this.settingUtils.set("ignoreSyncKey", this.settings.ignoreSyncKey);
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "preserveKeys",
      value: this.settings.preserveKeys,
      type: "textarea",
      title: "保留 frontmatter 键",
      description: "逗号或换行分隔，更新本地文档时覆盖回去",
      action: {
        callback: async () => {
          this.settings.preserveKeys = String(
            await this.settingUtils.takeAndSave("preserveKeys")
          );
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "template",
      value: this.settings.template,
      type: "textarea",
      title: "Dinox 拉取模板",
      description: `请求 ${API_BASE_URL}/openapi/v5/notes 时使用`,
      action: {
        callback: async () => {
          this.settings.template = String(
            await this.settingUtils.takeAndSave("template")
          );
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "syncAllHotkey",
      value: this.settings.syncAllHotkey,
      type: "custom",
      title: "全量同步快捷键",
      description: "保存后立即生效",
      createElement: (currentVal: string) =>
        this.createHotkeyInput(currentVal, async (value) => {
          this.settings.syncAllHotkey = value;
          await this.saveSettings();
          showMessage("快捷键已保存", 3000, "info");
        }),
      getEleVal: (ele: HTMLElement) => (ele as any).value,
      setEleVal: (ele: HTMLElement, val: string) => {
        (ele as any).value = val;
      },
    });

    this.settingUtils.addItem({
      key: "syncCurrentHotkey",
      value: this.settings.syncCurrentHotkey,
      type: "custom",
      title: "当前文档同步快捷键",
      description: "保存后立即生效",
      createElement: (currentVal: string) =>
        this.createHotkeyInput(currentVal, async (value) => {
          this.settings.syncCurrentHotkey = value;
          await this.saveSettings();
          showMessage("快捷键已保存", 3000, "info");
        }),
      getEleVal: (ele: HTMLElement) => (ele as any).value,
      setEleVal: (ele: HTMLElement, val: string) => {
        (ele as any).value = val;
      },
    });

    this.settingUtils.addItem({
      key: "createNoteHotkey",
      value: this.settings.createNoteHotkey,
      type: "custom",
      title: "创建到 Dinox 快捷键",
      description: "保存后立即生效",
      createElement: (currentVal: string) =>
        this.createHotkeyInput(currentVal, async (value) => {
          this.settings.createNoteHotkey = value;
          await this.saveSettings();
          showMessage("快捷键已保存", 3000, "info");
        }),
      getEleVal: (ele: HTMLElement) => (ele as any).value,
      setEleVal: (ele: HTMLElement, val: string) => {
        (ele as any).value = val;
      },
    });

    this.settingUtils.addItem({
      key: "isAutoSync",
      value: this.settings.isAutoSync,
      type: "checkbox",
      title: "自动同步",
      description: "每 30 分钟自动执行一次 Dinox -> 思源 增量同步",
      action: {
        callback: async () => {
          this.settings.isAutoSync = Boolean(
            await this.settingUtils.takeAndSave("isAutoSync")
          );
          await this.saveSettings();
          this.refreshAutoSyncSchedule();
        },
      },
    });

    this.settingUtils.addItem({
      key: "dailyNotesEnabled",
      value: this.settings.dailyNotes.enabled,
      type: "checkbox",
      title: "启用每日汇总",
      description: "把同步的 Dinox 笔记同步到对应日期的每日汇总文档",
      action: {
        callback: async () => {
          this.settings.dailyNotes.enabled = Boolean(
            await this.settingUtils.takeAndSave("dailyNotesEnabled")
          );
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "dailyNotesNotebookId",
      value: this.settings.dailyNotes.notebookId,
      type: "textinput",
      title: "每日汇总笔记本 ID",
      description: "为空时复用主同步笔记本",
      action: {
        callback: async () => {
          this.settings.dailyNotes.notebookId = String(
            await this.settingUtils.takeAndSave("dailyNotesNotebookId")
          ).trim();
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "dailyNotesBasePath",
      value: this.settings.dailyNotes.basePath,
      type: "textinput",
      title: "每日汇总目录",
      description: "例如 Daily Notes/Dinox",
      action: {
        callback: async () => {
          this.settings.dailyNotes.basePath = String(
            await this.settingUtils.takeAndSave("dailyNotesBasePath")
          ).trim();
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "dailyNotesHeading",
      value: this.settings.dailyNotes.heading,
      type: "textinput",
      title: "每日汇总标题",
      description: "受管区域上方显示的标题",
      action: {
        callback: async () => {
          this.settings.dailyNotes.heading =
            String(
              await this.settingUtils.takeAndSave("dailyNotesHeading")
            ).trim() || DEFAULT_SETTINGS.dailyNotes.heading;
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "dailyNotesInsertTo",
      value: this.settings.dailyNotes.insertTo,
      type: "select",
      title: "新增位置",
      description: "新增条目插入到受管区域顶部或底部",
      options: {
        top: "顶部",
        bottom: "底部",
      },
      action: {
        callback: async () => {
          this.settings.dailyNotes.insertTo = (await this.settingUtils.takeAndSave(
            "dailyNotesInsertTo"
          )) as "top" | "bottom";
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "dailyNotesCreateIfMissing",
      value: this.settings.dailyNotes.createIfMissing,
      type: "checkbox",
      title: "不存在时自动创建每日汇总",
      description: "关闭后仅更新已存在的每日汇总文档",
      action: {
        callback: async () => {
          this.settings.dailyNotes.createIfMissing = Boolean(
            await this.settingUtils.takeAndSave("dailyNotesCreateIfMissing")
          );
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "dailyNotesIncludePreview",
      value: this.settings.dailyNotes.includePreview,
      type: "checkbox",
      title: "包含内容预览",
      description: "在每日汇总中附带简短预览",
      action: {
        callback: async () => {
          this.settings.dailyNotes.includePreview = Boolean(
            await this.settingUtils.takeAndSave("dailyNotesIncludePreview")
          );
          await this.saveSettings();
        },
      },
    });

    this.settingUtils.addItem({
      key: "syncStatus",
      value: "",
      type: "hint",
      title: "同步状态",
      description: "显示最近一次增量同步时间",
      createElement: () => {
        const element = document.createElement("div");
        element.className = "b3-label fn__flex-center";
        element.innerHTML = "<div>正在加载同步状态...</div>";
        void this.updateSyncStatusElement(element);
        return element;
      },
    });

    this.settingUtils.addItem({
      key: "resetSyncState",
      value: "",
      type: "button",
      title: "重置同步状态",
      description: "下次同步将从起始时间重新拉取",
      button: {
        label: "重置",
        callback: async () => {
          await this.resetSyncStateWithConfirm();
        },
      },
    });

    this.settingUtils.load();
  }

  private createHotkeyInput(
    currentValue: string,
    onchange: (value: string) => void | Promise<void>
  ): HTMLElement {
    const container = document.createElement("div");
    container.className = "fn__flex fn__flex-center";
    container.style.gap = "8px";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "b3-text-field fn__flex-center";
    input.style.width = "180px";
    input.placeholder = this.isMacPlatform()
      ? "点击后按下快捷键，如 ⌘+⇧+S"
      : "点击后按下快捷键，如 Ctrl+Shift+S";
    input.readOnly = true;
    const rawCurrentValue = currentValue || "";
    input.value = rawCurrentValue;

    const clearButton = document.createElement("button");
    clearButton.className = "b3-button b3-button--outline";
    clearButton.textContent = "清空";
    clearButton.onclick = async (event) => {
      event.preventDefault();
      input.dataset.rawValue = "";
      input.value = "";
      await onchange("");
    };

    input.addEventListener("keydown", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
        return;
      }
      if (event.key === "Escape") {
        input.value = "";
        await onchange("");
        return;
      }
      const parts: string[] = [];
      const isMac = this.isMacPlatform();
      if (event.metaKey || event.ctrlKey) {
        parts.push(isMac ? "⌘" : "Ctrl");
      }
      if (event.altKey) {
        parts.push(isMac ? "⌥" : "Alt");
      }
      if (event.shiftKey) {
        parts.push(isMac ? "⇧" : "Shift");
      }
      let key = event.key;
      if (key === " ") key = "Space";
      if (key.length === 1) key = key.toUpperCase();
      parts.push(key);
      const storedValue = parts.join("+");
      input.dataset.rawValue = storedValue;
      input.value = storedValue;
      await onchange(storedValue);
    });

    (container as HTMLDivElement & { value: string }).value = rawCurrentValue;
    Object.defineProperty(container, "value", {
      get: () => input.dataset.rawValue || "",
      set: (value: string) => {
        input.dataset.rawValue = value || "";
        input.value = value || "";
      },
    });
    input.dataset.rawValue = rawCurrentValue;

    container.appendChild(input);
    container.appendChild(clearButton);
    return container;
  }

  private async updateSyncStatusElement(element: HTMLElement) {
    try {
      const state = await this.loadSyncState();
      const lastSyncTime =
        state.lastSyncTime === DEFAULT_LAST_SYNC_TIME
          ? "尚未同步"
          : state.lastSyncTime;
      element.innerHTML = `
        <div style="text-align:left;width:100%;">
          <div>最近同步时间：<strong>${lastSyncTime}</strong></div>
          <div style="margin-top:4px;color:var(--b3-theme-on-surface-light);font-size:12px;">
            ${
              state.lastSyncTime === DEFAULT_LAST_SYNC_TIME
                ? "下次同步将进行全量拉取"
                : "下次同步将基于最近成功时间做增量拉取"
            }
          </div>
        </div>
      `;
    } catch (error) {
      element.innerHTML = `<div style="color:var(--b3-theme-error);">读取同步状态失败：${getErrorMessage(
        error
      )}</div>`;
    }
  }

  private refreshSyncStatus() {
    const element = this.settingUtils?.getElement("syncStatus");
    if (element) {
      void this.updateSyncStatusElement(element);
    }
  }

  private async resetSyncStateWithConfirm() {
    confirm(
      "⚠️",
      "确认重置同步状态吗？重置后下次会从起始时间重新拉取 Dinox 数据。",
      async () => {
        await this.saveSyncState(DEFAULT_SYNC_STATE);
        this.refreshSyncStatus();
        showMessage("同步状态已重置", 3000, "info");
      }
    );
  }

  private async editorTitleIconEvent({ detail }: { detail: any }) {
    const menu: Menu | undefined = detail?.menu;
    if (!menu) {
      return;
    }

    const docId =
      detail?.data?.id ||
      detail?.protyle?.block?.rootID ||
      (await this.getCurrentDocId());

    menu.addItem({
      icon: "iconCloudSync",
      label: "智能同步到 Dinox",
      click: async () => {
        if (!docId) {
          showMessage("未找到当前文档", 3000, "error");
          return;
        }
        await this.smartSyncDocToDinox(docId);
      },
    });

    menu.addItem({
      icon: "iconPlus",
      label: "创建到 Dinox",
      click: async () => {
        if (!docId) {
          showMessage("未找到当前文档", 3000, "error");
          return;
        }
        await this.createCurrentDocToDinox(docId);
      },
    });

    const selectedText = this.getSelectedText();
    if (selectedText) {
      menu.addItem({
        icon: "iconUpload",
        label: "发送选中文本到 Dinox",
        click: async () => {
          await this.sendSelectedTextToDinox(selectedText);
        },
      });
    }
  }

  private openTopBarMenu(rect?: DOMRect) {
    const menu = new Menu("topBarDinoxSync");

    menu.addItem({
      icon: "iconRefresh",
      label: "同步 Dinox 到思源",
      accelerator: this.settings.syncAllHotkey,
      click: async () => {
        await this.syncNotes();
      },
    });

    menu.addItem({
      icon: "iconCloudSync",
      label: "同步当前文档到 Dinox",
      accelerator: this.settings.syncCurrentHotkey,
      click: async () => {
        const docId = await this.getCurrentDocId();
        if (!docId) {
          showMessage("未找到当前文档", 3000, "error");
          return;
        }
        await this.smartSyncDocToDinox(docId);
      },
    });

    menu.addItem({
      icon: "iconPlus",
      label: "创建当前文档到 Dinox",
      accelerator: this.settings.createNoteHotkey,
      click: async () => {
        const docId = await this.getCurrentDocId();
        if (!docId) {
          showMessage("未找到当前文档", 3000, "error");
          return;
        }
        await this.createCurrentDocToDinox(docId);
      },
    });

    if (this.getSelectedText()) {
      menu.addItem({
        icon: "iconUpload",
        label: "发送选中文本到 Dinox",
        click: async () => {
          await this.sendSelectedTextToDinox();
        },
      });
    }

    menu.addItem({
      icon: "iconTrashcan",
      label: "重置同步状态",
      click: async () => {
        await this.resetSyncStateWithConfirm();
      },
    });

    if (this.isMobile || !rect) {
      menu.fullscreen();
      return;
    }

    menu.open({
      x: rect.right,
      y: rect.bottom,
      isLeft: true,
    });
  }

  private async getCurrentDocId(): Promise<string | null> {
    const protyles = document.querySelectorAll(".protyle:not(.fn__none)");
    const current = protyles[protyles.length - 1];
    const root = current?.querySelector?.("[data-node-id]");
    const id = root?.getAttribute?.("data-node-id");
    if (id) {
      return id;
    }
    const matched = location.hash.match(/#(\d{14}-[a-z0-9]{7})/);
    return matched?.[1] || null;
  }

  private getSelectedText(): string {
    const text = window.getSelection?.()?.toString?.() || "";
    return text.trim();
  }

  private async sendSelectedTextToDinox(selectedText?: string) {
    if (!this.settings.token.trim()) {
      showMessage("请先配置 Dinox Token", 3000, "error");
      return;
    }

    const content = (selectedText || this.getSelectedText()).trim();
    if (!content) {
      showMessage("当前没有选中文本", 3000, "error");
      return;
    }

    try {
      showMessage("正在发送选中文本到 Dinox...", 3000, "info");
      const title =
        content.split(/\r?\n/, 1)[0].trim().slice(0, 50) || "New Note from SiYuan";
      const noteId = await createDinoxNote({
        token: this.settings.token,
        title,
        tags: [],
        content,
      });
      showMessage(`发送成功：${noteId.substring(0, 8)}...`, 4000, "info");
    } catch (error) {
      console.error("sendSelectedTextToDinox failed:", error);
      showMessage(`发送失败：${getErrorMessage(error)}`, 6000, "error");
    }
  }

  private async syncNotes() {
    if (this.isSyncing) {
      showMessage("同步已在执行中", 3000, "info");
      return;
    }
    if (!this.settings.token.trim()) {
      showMessage("请先配置 Dinox Token", 3000, "error");
      return;
    }
    if (!this.settings.notebookId.trim()) {
      showMessage("请先配置思源笔记本 ID", 3000, "error");
      return;
    }

    this.isSyncing = true;
    const state = await this.loadSyncState();
    const syncStartTime = new Date();
    let processed = 0;
    let deleted = 0;
    const dailyNoteChanges = new Map<string, DailyNoteChangeSet>();

    this.showSyncMessage("开始同步 Dinox -> 思源...", 3000, "info");

    try {
      const lastSyncTime = normalizeDinoxDateTime(state.lastSyncTime);
      const dayNotes = await fetchNotesFromApi({
        token: this.settings.token,
        template: this.settings.template,
        lastSyncTime,
      });

      const localIndex = await this.buildLocalDocIndex(this.settings.notebookId);

      for (const dayData of [...dayNotes].reverse()) {
        for (const noteData of [...dayData.notes].reverse()) {
          const result = await this.processSingleNote(
            noteData,
            dayData.date,
            localIndex,
            state
          );
          if (result.status === "processed") {
            processed++;
            if (this.settings.dailyNotes.enabled) {
              const changeSet =
                dailyNoteChanges.get(dayData.date) || { added: [], removed: [] };
              changeSet.added.push({
                noteId: noteData.noteId,
                docId: result.docId,
                title: result.title,
                preview: result.preview,
              });
              dailyNoteChanges.set(dayData.date, changeSet);
            }
          }
          if (result.status === "deleted") {
            deleted++;
            if (this.settings.dailyNotes.enabled) {
              const changeSet =
                dailyNoteChanges.get(dayData.date) || { added: [], removed: [] };
              changeSet.removed.push({
                noteId: noteData.noteId,
                docId: result.docId,
                title: result.title,
              });
              dailyNoteChanges.set(dayData.date, changeSet);
            }
          }
        }
      }

      if (this.settings.dailyNotes.enabled) {
        await this.applyDailyNoteChanges(dailyNoteChanges);
      }

      state.lastSyncTime = formatDate(syncStartTime);
      await this.saveSyncState(state);
      this.refreshSyncStatus();
      this.showSyncMessage(
        `同步完成，更新 ${processed} 条，删除 ${deleted} 条`,
        5000,
        "info"
      );
    } catch (error) {
      console.error("Dinox sync failed:", error);
      this.showSyncMessage(`同步失败：${getErrorMessage(error)}`, 8000, "error");
    } finally {
      this.isSyncing = false;
    }
  }

  private async buildLocalDocIndex(
    notebookId: string
  ): Promise<Record<string, LocalDocInfo>> {
    const escapedNotebook = notebookId.replace(/'/g, "''");
    const rows = await sql(
      `select id, hpath, content from blocks where box='${escapedNotebook}' and type='d'`
    );

    const infos = await Promise.all(
      rows.map(async (row: { id: string; hpath: string; content: string }) => {
        const [attrs, path] = await Promise.all([
          getBlockAttrs(row.id),
          getPathByID(row.id),
        ]);
        const info: LocalDocInfo = {
          id: row.id,
          path,
          hPath: row.hpath || "",
          title: row.content || "",
          attrs: attrs || {},
        };
        return info;
      })
    );

    const index: Record<string, LocalDocInfo> = {};
    infos.forEach((info) => {
      const noteId = info.attrs["custom-dinox-note-id"];
      if (noteId) {
        index[noteId] = info;
      }
    });
    return index;
  }

  private getPreserveKeys(): string[] {
    return (this.settings.preserveKeys || "")
      .split(/[,\n\r]+/)
      .map((item) => item.trim())
      .filter(
        (item) =>
          item &&
          item !== "noteId" &&
          item !== "source_app_id" &&
          item !== "title"
      );
  }

  private stringifyAttrValue(value: unknown): string {
    if (value === undefined) {
      return "";
    }
    return JSON.stringify(value);
  }

  private parseAttrJson<T>(value?: string): T | null {
    if (!value?.trim()) {
      return null;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private parseAttrStringArray(value?: string): string[] {
    const parsed = this.parseAttrJson<unknown>(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => String(item || "").trim().replace(/^#/, ""))
      .filter(Boolean);
  }

  private getStoredTagsFromAttrs(attrs: Record<string, string>): string[] {
    const tags = new Set<string>();
    this.parseAttrStringArray(attrs["custom-dinox-tags"]).forEach((tag) => {
      tags.add(tag);
    });

    const frontmatter = this.parseAttrJson<Record<string, unknown>>(
      attrs["custom-dinox-frontmatter"]
    );
    const frontmatterTags = frontmatter?.tags;
    if (Array.isArray(frontmatterTags)) {
      frontmatterTags
        .map((item) => String(item || "").trim().replace(/^#/, ""))
        .filter(Boolean)
        .forEach((tag) => tags.add(tag));
    }
    return Array.from(tags);
  }

  private getNoteContentParts(noteData: Note): {
    frontmatter: string | null;
    body: string;
    content: string;
  } {
    const split = splitFrontmatter(noteData.content || "");
    const content = this.withAudioFallback(split.body, noteData.audioUrl);
    return {
      frontmatter: split.frontmatter,
      body: split.body,
      content,
    };
  }

  private buildDinoxAttrs(
    noteData: Note,
    date: string,
    frontmatter: string | null
  ): Record<string, string> {
    const parsedFrontmatter = parseFrontmatterRecord(frontmatter);
    const attrs: Record<string, string> = {
      "custom-dinox-note-id": (noteData.noteId || "").trim(),
      "custom-dinox-type": this.getNoteType(noteData),
      "custom-dinox-date": date,
      "custom-dinox-title": noteData.title || "",
      "custom-dinox-is-audio": noteData.isAudio ? "true" : "false",
      "custom-dinox-create-time": noteData.createTime || "",
      "custom-dinox-update-time": noteData.updateTime || "",
      "custom-dinox-audio-url": noteData.audioUrl || "",
      "custom-dinox-tags": this.stringifyAttrValue(noteData.tags || []),
      "custom-dinox-zettel-boxes": this.stringifyAttrValue(noteData.zettelBoxes || []),
    };

    if (frontmatter) {
      attrs["custom-dinox-frontmatter"] = this.stringifyAttrValue(parsedFrontmatter);
    }

    return attrs;
  }

  private async readExistingDocContext(docId: string): Promise<{
    ignore: boolean;
    preserved: Record<string, string | boolean | string[]>;
  }> {
    const [attrs, exported] = await Promise.all([
      getBlockAttrs(docId),
      exportMdContent(docId),
    ]);

    const split = splitFrontmatter(exported?.content || "");
    const parsed = parseFrontmatterRecord(split.frontmatter);
    const ignoreKey = this.settings.ignoreSyncKey;
    const attrIgnore =
      attrs?.[ignoreKey] || attrs?.[`custom-${ignoreKey}`] || "";
    const frontmatterIgnore = parsed[ignoreKey];
    const ignore =
      attrIgnore === "true" ||
      attrIgnore === "1" ||
      frontmatterIgnore === true ||
      frontmatterIgnore === "true";

    const preserved: Record<string, string | boolean | string[]> = {};
    for (const key of this.getPreserveKeys()) {
      if (parsed[key] !== undefined) {
        preserved[key] = parsed[key];
      }
    }
    return { ignore, preserved };
  }

  private getNoteType(noteData: Note): string {
    if (noteData.type?.trim()) {
      return noteData.type.trim();
    }
    return (
      extractFrontmatterScalar(splitFrontmatter(noteData.content).frontmatter, "type") ||
      "note"
    );
  }

  private generateFilename(noteData: Note): string {
    const noteId = noteData.noteId.trim();
    const titleFallback = noteData.title?.trim()
      ? sanitizeFilename(noteData.title)
      : noteId;
    const created = parseDate(noteData.createTime);

    switch (this.settings.filenameFormat) {
      case "title":
        return titleFallback;
      case "time":
        return created ? sanitizeFilename(formatDate(created)) : noteId;
      case "titleDate":
        if (!created) return titleFallback;
        return sanitizeFilename(
          `${titleFallback} (${formatDate(created).slice(0, 10)})`
        );
      case "template": {
        const createDate = created ? formatDate(created).slice(0, 10) : "";
        const createTime = created
          ? formatDate(created).slice(11).replace(/:/g, "")
          : "";
        const template =
          this.settings.filenameTemplate || DEFAULT_SETTINGS.filenameTemplate;
        return sanitizeFilename(
          template
            .replace(/\{\{\s*title\s*\}\}/g, noteData.title || noteId)
            .replace(/\{\{\s*createDate\s*\}\}/g, createDate)
            .replace(/\{\{\s*createTime\s*\}\}/g, createTime)
            .replace(/\{\{\s*noteId\s*\}\}/g, noteId)
        );
      }
      case "noteId":
      default:
        return noteId;
    }
  }

  private buildDesiredHPath(noteData: Note, date: string): string {
    const segments: string[] = [];
    const baseHPath = resolveBaseHPath(this.settings);
    if (baseHPath) {
      segments.push(baseHPath.replace(/^\/+/, ""));
    }

    if (this.settings.typeFolders.enabled) {
      const folderName =
        categorizeType(this.getNoteType(noteData)) === "material"
          ? this.settings.typeFolders.material
          : this.settings.typeFolders.note;
      segments.push(
        sanitizeFolderSegment(folderName) ||
          DEFAULT_SETTINGS.typeFolders.note
      );
    }

    if (this.settings.zettelBoxFolders.enabled) {
      const zettel = firstZettelBoxName(noteData);
      if (zettel) {
        segments.push(zettel);
      }
    }

    if (this.settings.fileLayout === "nested") {
      const safeDate = date.replace(/[^0-9-]/g, "");
      if (safeDate) {
        segments.push(safeDate);
      }
    }

    segments.push(this.generateFilename(noteData));
    return `/${segments.filter(Boolean).join("/")}`;
  }

  private withAudioFallback(content: string, audioUrl?: string): string {
    if (!audioUrl || content.includes(audioUrl)) {
      return content;
    }
    return `<audio src="${audioUrl}" controls></audio>\n\n${content}`.trim();
  }

  private buildPreview(content: string): string | undefined {
    const raw = content || "";
    if (!raw) {
      return undefined;
    }
    const split = splitFrontmatter(raw);
    for (const line of split.body.split(/\r?\n/)) {
      const cleaned = line
        .trim()
        .replace(/^#+\s*/, "")
        .replace(/[`*_]/g, "");
      if (!cleaned || cleaned.startsWith(">")) {
        continue;
      }
      return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
    }
    return undefined;
  }

  private getDailyNotesNotebookId(): string {
    return (
      this.settings.dailyNotes.notebookId.trim() || this.settings.notebookId.trim()
    );
  }

  private buildDailyNoteHPath(date: string): string {
    const parsed = parseDate(`${date} 00:00:00`) || parseDate(date) || new Date();
    const year = String(parsed.getFullYear());
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    const base = resolveBaseHPath({
      ...this.settings,
      basePath: this.settings.dailyNotes.basePath,
    } as DinoPluginSettings);
    const segments = [base.replace(/^\/+/, ""), year, month, `${year}-${month}-${day}`]
      .filter(Boolean);
    return `/${segments.join("/")}`;
  }

  private getDailyNoteAttrKey(date: string): string {
    const parsed = parseDate(`${date} 00:00:00`) || parseDate(date) || new Date();
    const year = String(parsed.getFullYear());
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `custom-dailynote-${year}${month}${day}`;
  }

  private renderDailyNoteSection(entries: DailyNoteChangeSet["added"]): string {
    const heading = this.settings.dailyNotes.heading.trim();
    const lines: string[] = [];
    if (heading) {
      lines.push(heading);
    }
    lines.push("<!-- Dinox Daily Notes -->");
    entries.forEach((entry) => {
      const title = (entry.title || "Untitled").replace(/'/g, "\\'");
      const ref = entry.docId ? `((${entry.docId} '${title}'))` : title;
      lines.push(`- ${ref} <!-- dinox-note:${entry.noteId} -->`);
      if (this.settings.dailyNotes.includePreview && entry.preview) {
        lines.push(`  > ${entry.preview}`);
      }
    });
    lines.push("<!-- /Dinox Daily Notes -->");
    return lines.join("\n");
  }

  private parseDailyNoteManagedEntries(content: string): DailyNoteChangeSet["added"] {
    const entries: DailyNoteChangeSet["added"] = [];
    const startMarker = "<!-- Dinox Daily Notes -->";
    const endMarker = "<!-- /Dinox Daily Notes -->";
    const start = content.indexOf(startMarker);
    const end = content.indexOf(endMarker);
    if (start === -1 || end === -1 || end <= start) {
      return entries;
    }
    const section = content
      .slice(start + startMarker.length, end)
      .split(/\r?\n/);
    for (let i = 0; i < section.length; i++) {
      const line = section[i].trim();
      const match = line.match(/dinox-note:([^\s>]+)\s*-->/);
      if (!match) {
        continue;
      }
      const docMatch = line.match(/\(\(([^\s)]+)(?:\s+'([^']*)')?\)\)/);
      const titleMatch = docMatch?.[2];
      let preview: string | undefined;
      const nextLine = section[i + 1]?.trim();
      if (nextLine?.startsWith(">")) {
        preview = nextLine.replace(/^>\s?/, "");
        i++;
      }
      entries.push({
        noteId: match[1],
        docId: docMatch?.[1],
        title: titleMatch,
        preview,
      });
    }
    return entries;
  }

  private upsertDailyNoteContent(
    original: string,
    changeSet: DailyNoteChangeSet
  ): string | null {
    const startMarker = "<!-- Dinox Daily Notes -->";
    const endMarker = "<!-- /Dinox Daily Notes -->";
    const existingEntries = this.parseDailyNoteManagedEntries(original);
    const entries = [...existingEntries];

    const removed = new Set(changeSet.removed.map((item) => item.noteId));
    const filtered = entries.filter((item) => !removed.has(item.noteId));

    changeSet.added.forEach((item) => {
      const existingIndex = filtered.findIndex((entry) => entry.noteId === item.noteId);
      if (existingIndex >= 0) {
        filtered[existingIndex] = {
          ...filtered[existingIndex],
          ...item,
        };
      } else if (this.settings.dailyNotes.insertTo === "top") {
        filtered.unshift(item);
      } else {
        filtered.push(item);
      }
    });

    const rendered = this.renderDailyNoteSection(filtered);
    const start = original.indexOf(startMarker);
    const end = original.indexOf(endMarker);

    let next = original;
    if (start !== -1 && end !== -1 && end > start) {
      next =
        original.slice(0, start).replace(/\s*$/, "\n\n") +
        rendered +
        "\n" +
        original.slice(end + endMarker.length).replace(/^\s*/, "\n");
    } else {
      const prefix = original.trimEnd();
      next = `${prefix}${prefix ? "\n\n" : ""}${rendered}\n`;
    }

    return next === original ? null : next;
  }

  private async applyDailyNoteChanges(changes: Map<string, DailyNoteChangeSet>) {
    const notebookId = this.getDailyNotesNotebookId();
    if (!notebookId) {
      showMessage("已启用每日汇总，但未配置可用笔记本 ID", 4000, "error");
      return;
    }

    let updatedCount = 0;
    for (const [date, changeSet] of changes.entries()) {
      if (changeSet.added.length === 0 && changeSet.removed.length === 0) {
        continue;
      }
      const hPath = this.buildDailyNoteHPath(date);
      const ids = await getIDsByHPath(notebookId, hPath);
      let docId = ids[0];

      if (!docId) {
        if (!this.settings.dailyNotes.createIfMissing) {
          continue;
        }
        docId = await createDocWithMd(notebookId, hPath, "");
        await setBlockAttrs(docId, {
          [this.getDailyNoteAttrKey(date)]: "true",
        });
      }

      const exported = await exportMdContent(docId);
      const updated = this.upsertDailyNoteContent(exported?.content || "", changeSet);
      if (!updated) {
        continue;
      }
      await updateBlock("markdown", updated, docId);
      updatedCount++;
    }

    if (updatedCount > 0) {
      showMessage(`已更新 ${updatedCount} 个每日汇总文档`, 4000, "info");
    }
  }

  private async processSingleNote(
    noteData: Note,
    date: string,
    localIndex: Record<string, LocalDocInfo>,
    state: SyncState
  ): Promise<
    | { status: "processed"; docId: string; title: string; preview?: string }
    | { status: "deleted"; docId?: string; title?: string }
    | { status: "skipped" }
  > {
    const sourceId = (noteData.noteId || "").trim();
    if (!sourceId) {
      return { status: "skipped" };
    }

    let existing = localIndex[sourceId];
    if (!existing && state.notePathById[sourceId]) {
      const ids = await getIDsByHPath(
        this.settings.notebookId,
        state.notePathById[sourceId]
      );
      if (ids.length > 0) {
        const id = ids[0];
        existing = {
          id,
          path: await getPathByID(id),
          hPath: state.notePathById[sourceId],
          title: (await getBlockByID(id))?.content || "",
          attrs: (await getBlockAttrs(id)) || {},
        };
        localIndex[sourceId] = existing;
      }
    }

    if (noteData.isDel) {
      if (!existing) {
        delete state.notePathById[sourceId];
        return { status: "skipped" };
      }
      await removeDoc(this.settings.notebookId, existing.path);
      delete localIndex[sourceId];
      delete state.notePathById[sourceId];
      return { status: "deleted", docId: existing.id, title: existing.title };
    }

    const desiredHPath = this.buildDesiredHPath(noteData, date);
    const noteContent = this.getNoteContentParts(noteData);
    const attrs = this.buildDinoxAttrs(noteData, date, noteContent.frontmatter);
    const rawContent = noteContent.content;

    if (existing) {
      const { ignore, preserved } = await this.readExistingDocContext(existing.id);
      if (ignore) {
        return { status: "skipped" };
      }
      const content = mergeFrontmatter(rawContent, preserved);
      await updateBlock("markdown", content, existing.id);
      await setBlockAttrs(existing.id, { ...existing.attrs, ...attrs });
      state.notePathById[sourceId] = existing.hPath || desiredHPath;
      localIndex[sourceId] = {
        ...existing,
        attrs: { ...existing.attrs, ...attrs },
      };
      return {
        status: "processed",
        docId: existing.id,
        title: noteData.title || existing.title || this.generateFilename(noteData),
        preview: this.buildPreview(content),
      };
    }

    const desiredIds = await getIDsByHPath(this.settings.notebookId, desiredHPath);
    if (desiredIds.length > 0) {
      const docId = desiredIds[0];
      const { ignore, preserved } = await this.readExistingDocContext(docId);
      if (ignore) {
        return { status: "skipped" };
      }
      const content = mergeFrontmatter(rawContent, preserved);
      await updateBlock("markdown", content, docId);
      await setBlockAttrs(docId, attrs);
      const existingPath = await getPathByID(docId);
      localIndex[sourceId] = {
        id: docId,
        path: existingPath,
        hPath: desiredHPath,
        title: noteData.title || "",
        attrs,
      };
      state.notePathById[sourceId] = desiredHPath;
      return {
        status: "processed",
        docId,
        title: noteData.title || this.generateFilename(noteData),
        preview: this.buildPreview(content),
      };
    }

    const docId = await createDocWithMd(
      this.settings.notebookId,
      desiredHPath,
      rawContent
    );
    await setBlockAttrs(docId, attrs);
    localIndex[sourceId] = {
      id: docId,
      path: await getPathByID(docId),
      hPath: desiredHPath,
      title: noteData.title || "",
      attrs,
    };
    state.notePathById[sourceId] = desiredHPath;
    return {
      status: "processed",
      docId,
      title: noteData.title || this.generateFilename(noteData),
      preview: this.buildPreview(rawContent),
    };
  }

  private async getDocPushContext(docId: string): Promise<{
    noteId: string | null;
    title: string;
    tags: string[];
    content: string;
  }> {
    const [attrs, exported, exportedBody, block] = await Promise.all([
      getBlockAttrs(docId),
      exportMdContent(docId),
      exportMdContentWithoutFrontmatterAndTitle(docId),
      getBlockByID(docId),
    ]);

    const markdown = exported?.content || "";
    const split = splitFrontmatter(markdown);
    const frontmatterNoteId =
      extractFrontmatterScalar(split.frontmatter, "noteId") ||
      extractFrontmatterScalar(split.frontmatter, "source_app_id");

    return {
      noteId: attrs?.["custom-dinox-note-id"] || frontmatterNoteId || null,
      title:
        extractFrontmatterScalar(split.frontmatter, "title") ||
        attrs?.["custom-dinox-title"] ||
        block?.content ||
        "Untitled",
      tags: Array.from(
        new Set([
          ...this.getStoredTagsFromAttrs(attrs || {}),
          ...extractAllTagsFromMarkdown(markdown),
        ])
      ),
      content: exportedBody?.content || "",
    };
  }

  private async smartSyncDocToDinox(docId: string) {
    const context = await this.getDocPushContext(docId);
    if (context.noteId) {
      await this.syncCurrentDocToDinox(docId);
      return;
    }
    await this.createCurrentDocToDinox(docId);
  }

  private async syncCurrentDocToDinox(docId: string) {
    if (!this.settings.token.trim()) {
      showMessage("请先配置 Dinox Token", 3000, "error");
      return;
    }

    try {
      const context = await this.getDocPushContext(docId);
      if (!context.noteId) {
        showMessage("当前文档尚未关联 Dinox noteId", 3000, "error");
        return;
      }

      showMessage("正在同步当前文档到 Dinox...", 3000, "info");
      await updateDinoxNote({
        token: this.settings.token,
        noteId: context.noteId,
        title: context.title,
        tags: context.tags,
        contentMd: context.content,
      });
      showMessage(
        `同步成功：${context.noteId.substring(0, 8)}...`,
        3000,
        "info"
      );
    } catch (error) {
      console.error("syncCurrentDocToDinox failed:", error);
      showMessage(`同步失败：${getErrorMessage(error)}`, 6000, "error");
    }
  }

  private async createCurrentDocToDinox(docId: string) {
    if (!this.settings.token.trim()) {
      showMessage("请先配置 Dinox Token", 3000, "error");
      return;
    }

    try {
      const context = await this.getDocPushContext(docId);
      if (context.noteId) {
        showMessage("当前文档已关联 Dinox noteId，请直接同步", 3000, "info");
        return;
      }

      showMessage("正在创建到 Dinox...", 3000, "info");
      const noteId = await createDinoxNote({
        token: this.settings.token,
        title: context.title,
        tags: context.tags,
        content: context.content,
      });

      await setBlockAttrs(docId, {
        "custom-dinox-note-id": noteId,
        "custom-dinox-type": "note",
        "custom-dinox-created-at": new Date().toISOString(),
      });

      showMessage(`创建成功：${noteId.substring(0, 8)}...`, 4000, "info");
    } catch (error) {
      console.error("createCurrentDocToDinox failed:", error);
      showMessage(`创建失败：${getErrorMessage(error)}`, 6000, "error");
    }
  }
}
