export const STORAGE_NAME = "dinox_sync";
export const SETTINGS_STORAGE_FILE = `${STORAGE_NAME}.json`;
export const SYNC_STATE_NAME = "dinox_sync_state.json";

// Pull + push both target the AI host now (paginated keyset sync API).
// API_BASE_URL is retained only for display/back-compat references.
export const API_BASE_URL = "https://dinoai.chatgo.pro";
export const API_BASE_URL_AI = "https://aisdk.chatgo.pro";
export const DEFAULT_LAST_SYNC_TIME = "1900-01-01 00:00:00";

// Incremental pull is paginated so memory stays bounded (mobile/browser).
export const SYNC_PAGE_SIZE = 50;
export const SYNC_REQUEST_TIMEOUT_MS = 60000;

export const DEFAULT_TEMPLATE_TEXT = `---
title: {{title}}
noteId: {{noteId}}
type: {{type}}
tags:
{{#tags}}
    - {{.}}
{{/tags}}
zettelBoxes:
{{#zettelBoxes}}
    - {{.}}
{{/zettelBoxes}}
audioUrl: {{audioUrl}}
createTime: {{createTime}}
updateTime: {{updateTime}}
---

{{content}}
`;
