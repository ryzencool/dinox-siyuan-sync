import { DEFAULT_LAST_SYNC_TIME } from "./constants";
import type { DinoPluginSettings, Note } from "./types/plugin";

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const localMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
  );
  if (localMatch) {
    const date = new Date(
      Number(localMatch[1]),
      Number(localMatch[2]) - 1,
      Number(localMatch[3]),
      Number(localMatch[4]),
      Number(localMatch[5]),
      Number(localMatch[6])
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeDinoxDateTime(value: unknown): string {
  const parsed = parseDate(value);
  return parsed ? formatDate(parsed) : DEFAULT_LAST_SYNC_TIME;
}

export function sanitizeFilename(name: string): string {
  if (!name) return "Untitled";
  let sanitized = name.replace(/[\\/:*?"<>|#^[\]]/g, "-");
  sanitized = sanitized.replace(/[\s-]+/g, "-");
  sanitized = sanitized.trim().replace(/^-+|-+$/g, "");
  sanitized = sanitized.substring(0, 100);
  if (!sanitized || sanitized === "." || sanitized === "..") {
    return "Untitled";
  }
  return sanitized;
}

export function sanitizeFolderSegment(value: string): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }
  let sanitized = raw.replace(/[\\/]/g, "-");
  sanitized = sanitized.replace(/[\u0000-\u001F<>:"|?*]/g, "-");
  sanitized = sanitized.replace(/\s+/g, " ");
  sanitized = sanitized.replace(/-+/g, "-");
  sanitized = sanitized.replace(/^[ .-]+|[ .-]+$/g, "");
  sanitized = sanitized.slice(0, 80).trim();
  if (!sanitized || sanitized === "." || sanitized === "..") {
    return null;
  }
  return sanitized;
}

export function sanitizeRelativePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => sanitizeFolderSegment(segment) || "")
    .filter(Boolean)
    .join("/");
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function firstZettelBoxName(note: Note): string | null {
  if (!Array.isArray(note.zettelBoxes)) {
    return null;
  }
  for (const entry of note.zettelBoxes) {
    if (typeof entry === "string") {
      const val = sanitizeFolderSegment(entry);
      if (val) return val;
      continue;
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const rawName =
      entry.name || entry.zettelBoxName || entry.zettelBox?.name || "";
    const val = sanitizeFolderSegment(rawName);
    if (val) return val;
  }
  return null;
}

export function categorizeType(type: unknown): "note" | "material" {
  const normalized = typeof type === "string" ? type.trim().toLowerCase() : "";
  if (normalized === "crawl" || normalized === "material") {
    return "material";
  }
  return "note";
}

export function resolveBaseHPath(settings: DinoPluginSettings): string {
  const cleaned = sanitizeRelativePath(settings.basePath || "");
  return cleaned ? `/${cleaned}` : "";
}
