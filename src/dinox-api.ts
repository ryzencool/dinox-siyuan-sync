import axios from "axios";
import { API_BASE_URL, API_BASE_URL_AI } from "./constants";
import type { DayNote } from "./types/plugin";

interface DinoxEnvelope<T> {
  code: string;
  msg?: string;
  data?: T;
}

async function postJson<T>(args: {
  url: string;
  token: string;
  body: unknown;
}): Promise<DinoxEnvelope<T>> {
  const response = await axios.post(args.url, args.body, {
    headers: {
      Authorization: args.token,
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = response.data as DinoxEnvelope<T>;
  if (!data || typeof data.code !== "string") {
    throw new Error("Dinox API 返回格式无效");
  }
  if (data.code !== "000000") {
    throw new Error(data.msg || `Dinox API 错误: ${data.code}`);
  }
  return data;
}

export async function fetchNotesFromApi(args: {
  token: string;
  template: string;
  lastSyncTime: string;
}): Promise<DayNote[]> {
  const data = await postJson<DayNote[]>({
    url: `${API_BASE_URL}/openapi/v5/notes`,
    token: args.token,
    body: {
      template: args.template,
      noteId: 0,
      lastSyncTime: args.lastSyncTime,
    },
  });
  return Array.isArray(data.data) ? data.data : [];
}

export async function createDinoxNote(args: {
  token: string;
  content: string;
  title: string;
  tags: string[];
}): Promise<string> {
  const data = await postJson<{ noteId: string }>({
    url: `${API_BASE_URL_AI}/api/openapi/createNote`,
    token: args.token,
    body: {
      content: args.content,
      title: args.title,
      tags: args.tags,
    },
  });
  const noteId = data.data?.noteId?.trim();
  if (!noteId) {
    throw new Error("Dinox API 未返回 noteId");
  }
  return noteId;
}

export async function updateDinoxNote(args: {
  token: string;
  noteId: string;
  contentMd: string;
  title: string;
  tags: string[];
}): Promise<void> {
  await postJson({
    url: `${API_BASE_URL_AI}/api/openapi/updateNote`,
    token: args.token,
    body: {
      noteId: args.noteId,
      contentMd: args.contentMd,
      title: args.title,
      tags: args.tags,
    },
  });
}
