import {
    Plugin,
    showMessage,
    confirm,
    Menu,
    getFrontend,
    IModel,
    ICard,
    ICardData
} from "siyuan";
import "@/index.scss";



import {SettingUtils} from "./libs/setting-utils";
import axios from "axios";
import {createDocWithMd, getIDsByHPath, getPathByID, removeDoc} from "@/api";

const STORAGE_NAME = "dinox_sync";

const TEMPLATE = `---
标题：{{title}}
笔记 ID: {{noteId}}
笔记类型：{{type}}
tags:
{{#tags}}
    - #{{.}}#
{{/tags}}
网页链接：
录音: [下载]({{audioUrl}})
创建时间：{{createTime}}
更新时间：{{updateTime}}
---

{{content}}
`;

function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}


interface Note {
    title: string;
    createTime: string;
    content: string;
    noteId: string;
    tags: string[];
    isDel: boolean
}


interface DayNote {
    date: string;
    notes: Note[];
}

export default class PluginSample extends Plugin {

    customTab: () => IModel;
    private isMobile: boolean;
    private settingUtils: SettingUtils;

    async onload() {
        this.data[STORAGE_NAME] = {template: TEMPLATE, lastSyncTime: "1900-01-01 00:00:00", token: "", notebookId: ""};

        console.log("loading plugin-sample", this.i18n);

        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";
        // 图标的制作参见帮助文档
        this.addIcons(`<symbol id="iconD" viewBox="0 0 28 28">
  <path d="M10 4h8a8 8 0 0 1 0 16h-8v-16zM12 6v12h6a6 6 0 0 0 0-12h-6z"/>
</symbol>`);

        const topBarElement = this.addTopBar({
            icon: "iconD",
            title: this.i18n.addTopBarIcon,
            position: "right",
            callback: () => {
                if (this.isMobile) {
                    this.addMenu();
                } else {
                    let rect = topBarElement.getBoundingClientRect();
                    // 如果被隐藏，则使用更多按钮
                    if (rect.width === 0) {
                        rect = document.querySelector("#barMore").getBoundingClientRect();
                    }
                    if (rect.width === 0) {
                        rect = document.querySelector("#barPlugins").getBoundingClientRect();
                    }
                    this.addMenu(rect);
                }
            }
        });

        const statusIconTemp = document.createElement("template");
        statusIconTemp.innerHTML = `<div class="toolbar__item ariaLabel" aria-label="Remove plugin-sample Data">
    <svg>
        <use xlink:href="#iconTrashcan"></use>
    </svg>
</div>`;
        statusIconTemp.content.firstElementChild.addEventListener("click", () => {
            confirm("⚠️", this.i18n.confirmRemove.replace("${name}", this.name), () => {
                this.removeData(STORAGE_NAME).then(() => {
                    this.data[STORAGE_NAME] = {readonlyText: "Readonly"};
                    showMessage(`[${this.name}]: ${this.i18n.removedData}`);
                });
            });
        });
        this.addStatusBar({
            element: statusIconTemp.content.firstElementChild as HTMLElement,
        });

        this.addCommand({
            langKey: "showDialog",
            hotkey: "ctrl+d",
            callback: () => {
                this.fetchData();
            },
            fileTreeCallback: (file: any) => {
                console.log(file, "fileTreeCallback");
            },
            editorCallback: (protyle: any) => {
                console.log(protyle, "editorCallback");
            },
            dockCallback: (element: HTMLElement) => {
                console.log(element, "dockCallback");
            },
        });

        this.settingUtils = new SettingUtils({
            plugin: this, name: STORAGE_NAME
        });
        this.settingUtils.addItem({
            key: "notebookId",
            value: "",
            type: "textinput",
            title: "NotebookID",
            description: "你想要同步的笔记本编号",
            action: {
                // Called when focus is lost and content changes
                callback: async () => {
                    // Return data and save it in real time
                    const value = await this.settingUtils.takeAndSave("notebookId");
                    const d = this.data[STORAGE_NAME]
                    this.data[STORAGE_NAME] = {
                        ...d,
                        notebookId: value
                    }
                }
            }
        });

        this.settingUtils.addItem({
            key: "token",
            value: "",
            type: "textinput",
            title: "Dinox Token",
            description: "输入 Dinox Token",
            action: {
                callback: async () => {
                    // Return data and save it in real time
                    const value = await this.settingUtils.takeAndSave("token");
                    const d = this.data[STORAGE_NAME]
                    this.data[STORAGE_NAME] = {
                        ...d,
                        token: value
                    }

                }
            }
        });
        this.settingUtils.addItem({
            key: "template",
            value: TEMPLATE,
            type: "textarea",
            title: "模板",
            description: "输入你想要的笔记模板",
            placeholder: TEMPLATE,
            // Called when focus is lost and content changes
            action: {
                callback: async () => {
                    // Read data in real time
                    const value = await this.settingUtils.takeAndSave("template");
                    const d = this.data[STORAGE_NAME]
                    this.data[STORAGE_NAME] = {
                        ...d,
                        template: value
                    }
                }
            }
        });


        try {
            this.settingUtils.load();
        } catch (error) {
            console.error("Error loading settings storage, probably empty config json:", error);
        }

    }

    onLayoutReady() {
        this.settingUtils.load();
    }

    async onunload() {
        console.log(this.i18n.byePlugin);
        showMessage("Goodbye SiYuan Plugin");
        console.log("onunload");
    }

    uninstall() {
        console.log("uninstall");
    }

    async updateCards(options: ICardData) {
        options.cards.sort((a: ICard, b: ICard) => {
            if (a.blockID < b.blockID) {
                return -1;
            }
            if (a.blockID > b.blockID) {
                return 1;
            }
            return 0;
        });
        return options;
    }


    private async fetchData() {


        new Notification("开始同步，请勿重复操作！！！")
        const data = this.data[STORAGE_NAME]


        console.log("data", data)

        const dataJson = await this.loadData("data.json")
        let lastSyncTime = ""
        if (!dataJson) {
            await this.saveData("data.json", JSON.stringify({
                "dinox_last_sync_time": "1900-01-01 00:00:00",
            }))
            lastSyncTime = "1900-01-01 00:00:00"
        } else {
            lastSyncTime = dataJson["dinox_last_sync_time"]
        }
        // 获取上一次同步的时间
        console.log("上次时间:", lastSyncTime)
        const startSyncTime = formatDate(new Date())

        if (data == null) {
            new Notification("设置数据不能为空！")
            return
        }

        if (data.token == null || data.token === "") {
            new Notification("Token 不能为空！")
            return
        }

        if (data.notebookId == null || data.notebookId === "") {
            new Notification("NotebookID 不能为空！")
            return
        }

        if (lastSyncTime == null || lastSyncTime === "") {
            lastSyncTime = "1900-01-01 00:00:00";
        }

        const resp = await axios.post("https://dinoai.chatgo.pro/openapi/v4/notes", {
            template: data.template,
            noteId: 0,
            lastSyncTime: lastSyncTime
        }, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": this.settingUtils.get("token")
            }
        })


        console.log(resp)
        if (resp.status !== 200 || resp.data.code != "000000") {
            new Notification("同步失败！可请联系开发者，微信：zmyconfirm")
            return
        } else {
            new Notification("获取数据成功！开始写入...")
        }

        const dayNotes = await resp.data.data as DayNote[]

        for (const item of dayNotes) {
            for (const note of item.notes) {
                if (note.isDel) {
                    if (lastSyncTime == "1900-01-01 00:00:00") {
                        continue
                    } else {
                        // 删除当前目录下同名的
                        console.log("删除同名")
                        let temp = ""
                        if (note.title != null && note.title !== "") {
                            temp = note.title
                        } else {
                            temp = note.noteId
                        }
                        const ids = await getIDsByHPath(data.notebookId, `/${item.date}/${temp}`)
                        console.log("找到了 IDs", ids)
                        if (ids.length > 0) {
                            const id = ids[0]
                            const path = await getPathByID(id)
                            console.log("找到了 path", path)
                            await removeDoc(data.notebookId, path)
                        }
                    }
                } else {
                    let temp = ""
                    if (note.title != null && note.title !== "") {
                        temp = note.title
                    } else {
                        temp = note.noteId
                    }

                    if (lastSyncTime == "1900-01-01 00:00:00") {
                        await createDocWithMd(data.notebookId, `/${item.date}/${temp}`, note.content)

                    } else {
                        const ids = await getIDsByHPath(data.notebookId, `/${item.date}/${temp}`)

                        if (ids.length > 0) {
                            const id = ids[0]
                            const path = await getPathByID(id)
                            await removeDoc(data.notebookId, path)
                        }

                        await createDocWithMd(data.notebookId, `/${item.date}/${temp}`, note.content)
                    }

                }
            }
        }


        console.log(dayNotes)
        localStorage.setItem("dinox_last_sync_time", startSyncTime)

        await this.saveData("data.json", JSON.stringify({
            "dinox_last_sync_time": startSyncTime
        }))
        new Notification("同步成功，请等待思源进行重新索引")

    }

    private addMenu(rect?: DOMRect) {
        const menu = new Menu("topBarSample", () => {
            console.log(this.i18n.byeMenu);
        });
        menu.addItem({
            icon: "iconInfo",
            label: "同步",
            accelerator: this.commands[0].customHotkey,
            click: () => {
                this.fetchData();
            }
        });

        menu.addItem({
            icon: "iconInfo",
            label: "重置",
            // accelerator: this.commands[0].customHotkey,
            click: async () => {
                await this.saveData("data.json", JSON.stringify({
                    "dinox_last_sync_time": "1900-01-01 00:00:00"
                }));
                new Notification("重置成功！")
            }
        });


        if (this.isMobile) {
            menu.fullscreen();
        } else {
            menu.open({
                x: rect.right,
                y: rect.bottom,
                isLeft: true,
            });
        }
    }
}
