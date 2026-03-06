# WriterRefactorTool

`WriterRefactorTool` 是一个面向中文写作的 VS Code 插件。  
它把“角色别名改名”做成类似代码重构的体验：命中一个已注册别名后，可在工作区内统一替换该别名。

## 主要功能

- 角色分组 + 别名管理（两层结构）
- 右键注册新角色（首个别名）
- 右键把选中文本注册为已有角色的别名
- 对已注册别名执行重命名（跨工作区 `.txt` / `.md`）
- 高亮增强：
  - 亮色：当前命中的别名
  - 暗色：同角色下的其他别名
- 可配置匹配模式与排除规则（Markdown 代码块/行内代码/自定义正则）

## 使用方式

1. 在 `txt` 或 `md` 文件中选中一个名字。
2. 右键执行 `Writer Refactor: 注册选中文本`（会新建一个角色分类）。
3. 如果要添加同角色别名，选中新文本后右键执行 `Writer Refactor: 将选中文本注册为别名`，再选择角色。
4. 将光标放在某个已注册别名上，执行 `Writer Refactor: 重命名当前对象`。
5. 输入新名字后确认，插件会在工作区文本文件中替换该别名。

## 命令列表

- `Writer Refactor: 注册角色`
- `Writer Refactor: 注册别名`
- `Writer Refactor: 取消注册别名`
- `Writer Refactor: 取消注册角色`
- `Writer Refactor: 重命名当前对象`
- `Writer Refactor: 打开注册表 JSON`
- `Writer Refactor: 打开角色管理面板`

## 可视化角色管理面板

你可以通过命令面板执行 `Writer Refactor: 打开角色管理面板`，直接在可视化界面维护 `角色 -> 别名` 关系：

- 查看角色及其别名层级
- 新增/删除角色
- 新增/重命名/删除别名
- 直接编辑角色名（仅用于分类展示）
- 顶部 `刷新` 按钮可手动重载最新数据

说明：
- 面板内修改为自动保存到 registry。
- 别名仍保持全局唯一，冲突会阻止保存并提示错误。
- 面板编辑不会自动替换工作区文本；文本替换仍由 `重命名当前对象` 完成。

## 配置项

- `writerRefactor.matchMode`
  - `substring`（默认）或 `wholeWord`
- `writerRefactor.registryPath`
  - 注册表路径（相对扩展私有存储目录），默认：`registry.json`
  - 每个 workspace 会使用独立子目录，因此不会共用同一个 JSON
- `writerRefactor.excludeRules`
  - `excludeFencedCode`：排除 Markdown 围栏代码块
  - `excludeInlineCode`：排除 Markdown 行内代码
  - `customRegex`：自定义排除正则
- `writerRefactor.highlightColors`
  - 支持普通颜色（如 `#ffd54f`、`rgba(255,213,79,.35)`）
  - 也支持主题色令牌：`theme:<token>`，如 `theme:editor.wordHighlightBackground`

示例：

```json
{
  "writerRefactor.highlightColors": {
    "strong": {
      "color": "#1f1300",
      "backgroundColor": "rgba(255, 213, 79, 0.65)",
      "borderColor": "#ff9800",
      "overviewRulerColor": "#ffb300"
    },
    "weak": {
      "color": "theme:editor.foreground",
      "backgroundColor": "rgba(255, 213, 79, 0.25)",
      "borderColor": "rgba(255, 152, 0, 0.55)",
      "overviewRulerColor": "rgba(255, 213, 79, 0.35)"
    }
  }
}
```

## 注册表结构

插件使用 `version: 1` 结构：

```json
{
  "version": 1,
  "characters": [
    {
      "id": "character-...",
      "name": "张三",
      "aliases": [
        {
          "text": "张三"
        },
        {
          "text": "小张"
        }
      ]
    }
  ]
}
```

说明：
- 角色名 `name` 仅用于分类展示，不参与重命名替换逻辑。
- 重命名只作用于当前命中的别名文本。

## 开发

```bash
npm install
npm run watch
```

按 `F5` 启动 Extension Development Host。

## License

MIT
