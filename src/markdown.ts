export interface FrontmatterSplitResult {
  frontmatter: string | null;
  body: string;
}

export function splitFrontmatter(markdown: string): FrontmatterSplitResult {
  const raw = markdown ?? "";
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: null, body: raw };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: null, body: raw };
  }
  return {
    frontmatter: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n").trim(),
  };
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function extractFrontmatterScalar(
  frontmatter: string | null,
  key: string
): string | null {
  if (!frontmatter) {
    return null;
  }
  const pattern = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "mi");
  const match = frontmatter.match(pattern);
  if (!match) {
    return null;
  }
  const value = stripQuotes(match[1] || "");
  return value || null;
}

export function parseFrontmatterRecord(
  frontmatter: string | null
): Record<string, string | boolean | string[]> {
  const result: Record<string, string | boolean | string[]> = {};
  if (!frontmatter) {
    return result;
  }

  const lines = frontmatter.split(/\r?\n/);
  let currentListKey = "";
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentListKey) {
      const current = result[currentListKey];
      const nextValue = stripQuotes(listMatch[1] || "");
      if (Array.isArray(current) && nextValue) {
        current.push(nextValue);
      }
      continue;
    }
    currentListKey = "";
    const kvMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$/);
    if (!kvMatch) {
      continue;
    }
    const [, key, rawValue] = kvMatch;
    if (!rawValue) {
      result[key] = [];
      currentListKey = key;
      continue;
    }
    const value = stripQuotes(rawValue);
    if (value === "true") {
      result[key] = true;
    } else if (value === "false") {
      result[key] = false;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      result[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => stripQuotes(item))
        .map((item) => item.trim())
        .filter(Boolean);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function renderFrontmatterValue(value: string | boolean | string[]): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [""];
    }
    return ["", ...value.map((item) => `  - ${item}`)];
  }
  if (typeof value === "boolean") {
    return [value ? "true" : "false"];
  }
  return [String(value)];
}

export function mergeFrontmatter(
  markdown: string,
  preserved: Record<string, string | boolean | string[]>
): string {
  if (Object.keys(preserved).length === 0) {
    return markdown;
  }

  const split = splitFrontmatter(markdown);
  const merged = {
    ...parseFrontmatterRecord(split.frontmatter),
    ...preserved,
  };

  const lines = Object.entries(merged).flatMap(([key, value]) =>
    renderFrontmatterValue(value).map((rendered, index) =>
      index === 0 ? `${key}: ${rendered}`.trimEnd() : rendered
    )
  );

  return `---\n${lines.join("\n")}\n---\n\n${split.body}`.trim();
}

export function extractAllTagsFromMarkdown(markdown: string): string[] {
  const split = splitFrontmatter(markdown);
  const tags = new Set<string>();

  const frontmatter = parseFrontmatterRecord(split.frontmatter);
  const frontmatterTags = frontmatter.tags;
  if (Array.isArray(frontmatterTags)) {
    frontmatterTags.forEach((tag) => {
      const normalized = String(tag).trim().replace(/^#/, "");
      if (normalized) {
        tags.add(normalized);
      }
    });
  }

  const body = split.body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`]*`/g, " ");
  const regex = /(?:^|[\s\n])#([^\s#[\]]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const normalized = (match[1] || "")
      .trim()
      .replace(/[),.;:!?，。；：！？]+$/g, "")
      .replace(/^#/, "");
    if (normalized.length > 1) {
      tags.add(normalized);
    }
  }
  return Array.from(tags);
}
