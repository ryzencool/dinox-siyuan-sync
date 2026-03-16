# Dinox SiYuan 同步插件

本插件用于在思源笔记和 Dinox 之间同步笔记内容。

## 最新优化：使用 Block Attributes 存储元数据

### 优化内容

插件已从使用 YAML front matter 改为使用思源笔记的 block attributes 来存储元数据，主要改进包括：

1. **更简洁的文档内容**：正文中只包含实际内容，不再有 YAML 头部
2. **结构化元数据存储**：title、noteId、tags 等信息存储在 block attributes 中
3. **更符合思源笔记设计理念**：利用思源原生的 attributes 系统
4. **移除模板功能**：简化逻辑，直接使用笔记原始内容，无需模板渲染

### 自动存储的 Block Attributes

同步时会自动设置以下 attributes：

- `custom-dinox-note-id`：Dinox 笔记 ID
- `custom-dinox-title`：笔记标题
- `custom-dinox-create-time`：创建时间
- `custom-dinox-type`：笔记类型（note/audio）
- `custom-dinox-tags`：标签（逗号分隔）
- `custom-dinox-zettel-boxes`：知识库分组（逗号分隔）

### 向后兼容

- 新创建的笔记将使用 block attributes 存储元数据
- 手动创建到 Dinox 功能会自动设置相应 attributes
- 同步功能会从 attributes 中读取 noteId

## 功能特性

- 🔄 **双向同步**：从 Dinox 同步笔记到思源，也可以将思源笔记同步回 Dinox
- 📝 **灵活的文件名格式**：支持按笔记 ID、标题或创建时间命名文件
- 📁 **可配置的文件布局**：支持按日期分组的嵌套结构或平铺结构
- ⏰ **自动同步**：可选择启用每 30 分钟的自动同步
- 🎛️ **右键菜单集成**：在块图标菜单中提供快捷同步选项

## 安装和配置

### 1. 获取 Dinox Token
- 在 Dinox 应用中获取您的 API Token

### 2. 配置插件设置
打开思源笔记的插件设置，配置以下选项：

- **Dinox Token**：从 Dinox 应用获取的 API Token
- **NotebookID**：目标笔记本的 ID
- **模板**：用于格式化同步笔记的模板
- **文件名格式**：选择如何命名同步的文件
- **文件布局**：选择文件的组织方式
- **自动同步**：是否启用自动同步

## 使用方法

### 手动同步
1. 点击顶部工具栏的 Dinox 图标
2. 选择"同步笔记"
3. 或使用快捷键 `⌘+⇧+D`（macOS）/ `Ctrl+Shift+D`（Windows/Linux）

### 右键菜单同步
1. 右键点击任意块的图标
2. 选择"同步到 Dinox"（如果笔记已有 noteId）或"创建到 Dinox"（创建新笔记）

### 重置同步状态
如果遇到同步问题，可以重置同步状态：
1. 点击顶部工具栏的 Dinox 图标
2. 选择"重置同步状态"
3. 或使用快捷键 `⌘+⇧+R`（macOS）/ `Ctrl+Shift+R`（Windows/Linux）

## 模板格式

插件使用 Mustache 模板语法来格式化笔记内容。默认模板包含以下变量：

- `{{title}}`：笔记标题
- `{{noteId}}`：笔记 ID
- `{{type}}`：笔记类型
- `{{tags}}`：标签数组
- `{{zettelBoxes}}`：卡片盒数组
- `{{audioUrl}}`：音频 URL
- `{{createTime}}`：创建时间
- `{{updateTime}}`：更新时间
- `{{content}}`：笔记内容

## 注意事项

- 首次同步会同步所有笔记，后续同步只会同步变更的笔记
- 删除的笔记在同步时也会从思源中删除
- 确保您的 Dinox Token 有足够的权限进行读写操作
- 建议在重要同步前备份您的数据

## 故障排除

- 如果同步失败，请检查网络连接和 Token 是否有效
- 如果遇到文件名冲突，插件会自动清理文件名中的特殊字符
- 查看浏览器控制台的日志信息以获取详细的错误信息

## 开发者信息

基于思源笔记插件开发框架构建，参考了 Obsidian Dinox 同步插件的功能设计。
