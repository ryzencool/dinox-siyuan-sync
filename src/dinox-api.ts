import axios, { AxiosError } from "axios";
import { API_BASE_URL_AI, SYNC_REQUEST_TIMEOUT_MS } from "./constants";
import type { Note, NotesSyncPage, ZettelBoxNode, ZettelBoxRef } from "./types/plugin";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function truncate(text: string, limit: number): string {
  const raw = text ?? "";
  return raw.length <= limit ? raw : raw.slice(0, limit);
}

/** A non-2xx HTTP response from the Dinox API. */
export class DinoxHttpError extends Error {
  readonly status: number;
  readonly bodyPreview: string;
  constructor(status: number, bodyPreview: string) {
    super(`Dinox API HTTP ${status}\n${bodyPreview}`);
    this.name = "DinoxHttpError";
    this.status = status;
    this.bodyPreview = bodyPreview;
  }
}

/** A 200 response whose envelope reported a non-success code. */
export class DinoxLogicError extends Error {
  readonly code: string;
  readonly apiMessage: string;
  constructor(code: string, apiMessage: string) {
    super(`Dinox API error ${code}: ${apiMessage}`);
    this.name = "DinoxLogicError";
    this.code = code;
    this.apiMessage = apiMessage;
  }
}

/** A response that did not match the expected envelope shape. */
export class DinoxInvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DinoxInvalidResponseError";
  }
}

interface DinoxEnvelope<T> {
  code: string;
  msg?: string;
  data?: T;
}

async function requestRaw(args: {
  url: string;
  method: "GET" | "POST";
  token: string;
  body?: unknown;
  timeoutMs?: number;
}): Promise<{ status: number; data: unknown; text: string }> {
  try {
    const response = await axios.request({
      url: args.url,
      method: args.method,
      headers: {
        Authorization: args.token,
        ...(args.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      data: args.body,
      timeout: args.timeoutMs ?? SYNC_REQUEST_TIMEOUT_MS,
      // Let us map the status ourselves instead of axios throwing on 4xx/5xx.
      validateStatus: () => true,
      // Force a raw string body across adapters (browser XHR vs node http),
      // then parse manually so we can also read the text on error responses.
      responseType: "text",
      transformResponse: [(raw) => raw],
    });

    const text = typeof response.data === "string" ? response.data : "";
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    return { status: response.status, data: parsed, text };
  } catch (error) {
    const axiosErr = error as AxiosError;
    if (axiosErr?.code === "ECONNABORTED") {
      throw new Error(`Dinox 请求超时（${args.timeoutMs ?? SYNC_REQUEST_TIMEOUT_MS}ms）`);
    }
    throw error;
  }
}

function parseEnvelope<T>(value: unknown): DinoxEnvelope<T> {
  if (!isJsonRecord(value)) {
    throw new DinoxInvalidResponseError("Dinox API 返回格式无效：不是对象");
  }
  if (typeof value.code !== "string") {
    throw new DinoxInvalidResponseError("Dinox API 返回格式无效：缺少 code");
  }
  return {
    code: value.code,
    msg: typeof value.msg === "string" ? value.msg : undefined,
    data: value.data as T,
  };
}

function assertSuccess(envelope: DinoxEnvelope<unknown>): void {
  if (envelope.code !== "000000") {
    throw new DinoxLogicError(envelope.code, envelope.msg || "未知的 API 错误");
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item : String(item ?? "")))
    .filter((item) => item.length > 0);
}

function mapZettelBoxes(value: unknown): Array<string | ZettelBoxRef> {
  if (!Array.isArray(value)) {
    return [];
  }
  const boxes: Array<string | ZettelBoxRef> = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      boxes.push(entry);
    } else if (isJsonRecord(entry)) {
      boxes.push({
        id: typeof entry.id === "string" ? entry.id : undefined,
        name: typeof entry.name === "string" ? entry.name : undefined,
        path: typeof entry.path === "string" ? entry.path : undefined,
      });
    }
  }
  return boxes;
}

function mapNote(raw: unknown): Note | null {
  if (!isJsonRecord(raw)) {
    return null;
  }
  const noteId = asString(raw.noteId);
  if (!noteId) {
    return null;
  }
  return {
    noteId,
    title: asString(raw.title),
    content: asString(raw.contentMd),
    type: asString(raw.type) || undefined,
    tags: asStringArray(raw.tags),
    zettelBoxes: mapZettelBoxes(raw.zettelBoxes),
    audioUrl: asString(raw.audioUrl),
    isAudio: raw.isAudio === true,
    isDel: raw.isDel === true,
    createTime: asString(raw.createdAt),
    updateTime: asString(raw.updatedAt),
  };
}

/**
 * Fetch one page of incrementally-changed notes via keyset pagination.
 * `since` is an unambiguous ISO-8601 timestamp (the prior sync high-water mark)
 * or null on a first/full sync.
 */
export async function fetchNotesPage(args: {
  token: string;
  since: string | null;
  cursor: string | null;
  limit: number;
  includeDeleted: boolean;
  boxIds: string[] | null;
}): Promise<NotesSyncPage> {
  const { status, data, text } = await requestRaw({
    url: `${API_BASE_URL_AI}/api/openapi/notes/sync`,
    method: "POST",
    token: args.token,
    body: {
      since: args.since,
      cursor: args.cursor,
      limit: args.limit,
      includeDeleted: args.includeDeleted,
      // null => no box filter; array => only these boxes + descendants.
      boxIds: args.boxIds,
    },
  });

  if (status !== 200) {
    throw new DinoxHttpError(status, truncate(text, 200));
  }

  const envelope = parseEnvelope<unknown>(data);
  assertSuccess(envelope);

  const payload = envelope.data;
  if (!isJsonRecord(payload)) {
    throw new DinoxInvalidResponseError("Dinox API 返回格式无效：缺少 sync 数据");
  }
  if (!Array.isArray(payload.notes)) {
    throw new DinoxInvalidResponseError("Dinox API 返回格式无效：notes 不是数组");
  }

  const notes: Note[] = [];
  for (const item of payload.notes) {
    const note = mapNote(item);
    if (note) {
      notes.push(note);
    }
  }

  return {
    notes,
    nextCursor:
      typeof payload.nextCursor === "string" && payload.nextCursor
        ? payload.nextCursor
        : null,
    hasMore: payload.hasMore === true,
    serverTime:
      typeof payload.serverTime === "string" ? payload.serverTime : undefined,
  };
}

function mapZettelBoxNode(raw: unknown): ZettelBoxNode | null {
  if (!isJsonRecord(raw)) {
    return null;
  }
  const id = asString(raw.id);
  if (!id) {
    return null;
  }
  const priority =
    typeof raw.priority === "number" && Number.isFinite(raw.priority)
      ? raw.priority
      : 0;
  return {
    id,
    name: asString(raw.name) || id,
    parentId: typeof raw.parentId === "string" ? raw.parentId : null,
    path: typeof raw.path === "string" ? raw.path : null,
    priority,
  };
}

/** Fetch the user's full card-box list (for the sync-scope tree). */
export async function fetchZettelBoxes(token: string): Promise<ZettelBoxNode[]> {
  const { status, data, text } = await requestRaw({
    url: `${API_BASE_URL_AI}/api/openapi/zettelboxes`,
    method: "GET",
    token,
  });

  if (status !== 200) {
    throw new DinoxHttpError(status, truncate(text, 200));
  }

  const envelope = parseEnvelope<unknown>(data);
  assertSuccess(envelope);

  if (!Array.isArray(envelope.data)) {
    return [];
  }
  const boxes: ZettelBoxNode[] = [];
  for (const item of envelope.data) {
    const box = mapZettelBoxNode(item);
    if (box) {
      boxes.push(box);
    }
  }
  return boxes;
}

export async function createDinoxNote(args: {
  token: string;
  content: string;
  title: string;
  tags: string[];
}): Promise<string> {
  const { status, data, text } = await requestRaw({
    url: `${API_BASE_URL_AI}/api/openapi/createNote`,
    method: "POST",
    token: args.token,
    body: {
      content: args.content,
      tags: args.tags,
      title: args.title,
    },
  });

  if (status !== 200) {
    throw new DinoxHttpError(status, truncate(text, 200));
  }

  const envelope = parseEnvelope<unknown>(data);
  assertSuccess(envelope);

  const payload = envelope.data;
  if (!isJsonRecord(payload)) {
    throw new DinoxInvalidResponseError("Dinox API 未返回 createNote 数据");
  }
  const noteId = payload.noteId;
  if (typeof noteId !== "string" || !noteId.trim()) {
    throw new DinoxInvalidResponseError("Dinox API 未返回 noteId");
  }
  return noteId.trim();
}

export async function updateDinoxNote(args: {
  token: string;
  noteId: string;
  contentMd: string;
  title: string;
  tags: string[];
}): Promise<void> {
  const { status, data, text } = await requestRaw({
    url: `${API_BASE_URL_AI}/api/openapi/updateNote`,
    method: "POST",
    token: args.token,
    body: {
      noteId: args.noteId,
      contentMd: args.contentMd,
      tags: args.tags,
      title: args.title,
    },
  });

  if (status !== 200) {
    throw new DinoxHttpError(status, truncate(text, 200));
  }

  const envelope = parseEnvelope<unknown>(data);
  assertSuccess(envelope);
}
