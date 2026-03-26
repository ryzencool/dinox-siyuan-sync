
# Dinox Sync 

[English](./README.md)


## 插件说明

同步Dinox 笔记到 思源

## 最新版本更新

### v1.0.8（相较于 v1.0.4）

- 支持双向同步：可以把当前思源文档直接同步到 Dinox。
- 支持“创建当前文档到 Dinox”和“发送选中文本到 Dinox”。
- 元数据优先保存到思源块属性，正文更干净。
- 支持自定义同步根目录、按类型/卡片盒分目录和文件名模板。
- 支持按日期写入每日汇总文档。

完整变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 使用方法

1. 创建一个空的Notebook，复制该 notebook 的 ID
2. 在插件的设置页面中填写上述的 notebook ID，以及 Dinox 的 API Key
3. 点击同步按钮即可
4. 如需把当前文档回写到 Dinox，可在顶部 Dinox 菜单中选择“同步当前文档到 Dinox”或“创建当前文档到 Dinox”
5. 如需快速发送片段内容，可先选中文本，再选择“发送选中文本到 Dinox”

