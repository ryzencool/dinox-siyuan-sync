export const STORAGE_NAME = "dinox_sync";
export const SETTINGS_STORAGE_FILE = `${STORAGE_NAME}.json`;
export const SYNC_STATE_NAME = "dinox_sync_state.json";

export const API_BASE_URL = "https://dinoai.chatgo.pro";
export const API_BASE_URL_AI = "https://aisdk.chatgo.pro";
export const DEFAULT_LAST_SYNC_TIME = "1900-01-01 00:00:00";

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
{{#audioUrl}}
![录音]({{audioUrl}})
{{/audioUrl}}

{{content}}
`;
