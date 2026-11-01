# Quick Commands Lite for Tabby

`minyoad/tabby-quick-cmds` 思路的轻量重构版：**在终端底部常驻一条命令输入条（WindTerm 风格）**，
输入即发、边输入边搜收藏命令，命令很多时也不卡。

## 交互一览（1.3.0）

- 选定一个分组后，组内所有命令以名称按钮常驻显示；多于一屏时在按钮区滚动。
- 每个按钮只显示命令名称，不重复显示分组和正文。完整命令在鼠标悬停或键盘选中时出现，保留换行和缩进。
- 分组只显示在选择器中，选择会被记住。点击终端或按 Esc 不会收走已选分组的按钮；切走终端、收起输入条时正常隐藏。
- 终端底部点击名称沿用设置中的行为：发送到终端，或仅填入后修改。
- 命令管理器只用于管理：左键、右键以及搜索框 Enter 均打开编辑，不发送命令。
- 右键收藏命令直接打开该条命令的独立编辑页，只显示名称、分组、命令及保存/取消，不显示其他命令或搜索栏。
- 自动回车改为总设置里的全局开关，默认关闭，统一控制收藏、历史和输入框；旧命令的 `appendCR` 不再参与发送。
- 详情浮层只显示完整命令正文，不再重复显示标题。
- 输入框支持多行：Enter 发送，Shift+Enter 换行。发送失败保留内容；正在发送时避免重复提交。
- 输入文字不会自动选择第一条收藏。用 ↑↓ 明确选择收藏后，Enter 才发送所选项，Tab 将其填入编辑。
- 命令管理器同样只常显名称，悬停显示正文和操作入口；键盘聚焦也可查看。
- 输入框宽度自动适应窗口；字体大小和输入栏高度仍可在设置中调整。
- 从当前分组点 ＋ 保存命令时，新命令会默认使用该分组。

## 快捷键

| 默认键 | 作用 |
| --- | --- |
| `Alt+Q` | 聚焦底部命令输入条 |
| `Alt+Shift+Q` | 打开命令管理器 |

两个都能在 **设置 → 快捷键** 里改（插件注册了自己的 `HotkeyProvider`）。
工具栏上还有两个按钮：切换输入条、打开管理器。

> 输入框获得焦点时 Tabby 不会派发全局快捷键（这是 Tabby 的既有行为），按 `Esc` 回到终端即可。

## 配置项

全局自动回车写在 `config.yaml` 的 `qc.autoReturn`，输入条配置在 `qc.dock` 下，也可以在插件设置页里改：

```yaml
qc:
  cmds: [...]        # 收藏命令，兼容旧版数据
  groups: []
  autoReturn: false      # 全局发送后自动回车，默认关闭
  dock:
    enabled: true        # 是否显示底部输入条
    maxSuggestions: 10   # 最多同时给出多少条建议
    historySize: 30      # 历史保留多少条
    history: []          # 最近发送过的命令（自动维护）
    saveHistory: true    # 是否记录历史
    showHistory: true    # 是否在建议列表里显示历史
    terminator: cr       # 执行时发送的回车符：cr（推荐）/ lf / crlf
  ai:                  # 「AI 找命令」的接口设置；也可只在设置页里改
    baseURL: http://127.0.0.1:31415/v1
    apiKey: ''           # 建议在设置页填好并保存（会写进这里），不要提交到仓库
    model: auto
    protocol: chat       # chat / responses / messages
    excludedGroups: []   # 不参与 AI 检索的分组
    candidateLimit: 50   # 最多发送给 AI 的候选命令条数
hotkeys:
  qc: [Alt-Q]
  qc-manager: [Alt-Shift-Q]
```

## 相比旧版（tabby-windy-quick-commands / tabby-quick-cmds）

保留：Alt+Q、工具栏按钮、名称/内容/分组、搜索、增删改复制、当前终端执行、多行命令、
`\xHH` 控制字符、`\s毫秒` 延时行、直接读取旧 `qc.cmds`。

自动回车统一使用 `qc.autoReturn`，不再使用每条命令的 `appendCR`。关闭时去除末尾换行，
支持括号粘贴的终端会以粘贴方式接收多行文本；含 `\s` 延时步骤的命令需先开启全局自动回车。

移除：每条命令的全局快捷键、document 全局 keydown 扫描、SSH Profile 绑定、
使用次数排序、参数弹窗（`${参数}` 会被原样发送）。

改进：

1. **多行命令整段发送**。`for/while ... done`、反斜杠续行、heredoc 不会再被拆成多条命令；
   含 `\s` 延时行的命令仍走逐行模式。
2. **回车符固定为 `\r`**（等同手动按回车），不再根据窗口标题猜——Windows 的 cmd / PowerShell
   以前可能"点了没反应"。
3. 续行行首缩进会被去掉（行首 TAB 会被 shell 当补全键）。
4. 多关键词搜索 + 相关度排序；输入框里的 DOM 操作不触发 Angular 变更检测。
5. 搜索/切分组/启停输入条都即时生效；历史记录合并落盘。

## 目录结构

```
tabby-quick-cmds-lite/
├─ dist/
│  ├─ index.js     Angular 接线：数据层、执行层、管理器、设置页、快捷键、工具栏
│  ├─ dock.js      底部输入条（纯 DOM，不参与 Angular 变更检测）
│  ├─ logic.js     纯逻辑：发送计划、搜索匹配（纯函数，可单测）
│  ├─ ai.js        AI 找命令：设置读取、候选语料、API 调用、结果面板
│  └─ preview.js   悬停 / 键盘聚焦时的完整命令预览浮层
└─ ai-settings.json  AI 设置兜底（机器本地文件；密钥首选存 config.yaml 的 qc.ai）
```

## 安装（Windows）

1. 先在 Tabby 里禁用/删除原 `tabby-quick-cmds` / `tabby-windy-quick-commands`，避免 Alt+Q 冲突。
2. 把整个 `tabby-quick-cmds-lite` 文件夹复制到
   `%APPDATA%\tabby\plugins\node_modules\`
3. 重启 Tabby。
4. 终端下方应出现输入条；没有的话按 `Alt+Q`，或到「设置 → Quick Commands Lite」里打开开关。

> 本插件不在 npm 上，**不要**用 Tabby 的插件管理器安装它（会 404）。
> 手动放进 `plugins\node_modules` 后如果哪天被插件管理器清掉，重新从仓库复制一份即可。
> 已安装时更新只需覆盖 `dist/` 与文档；`ai-settings.json` 是机器本地设置，留着不动。

## 开发

dist 里是手写的纯 JavaScript（CommonJS），没有构建步骤，改完直接部署：

```powershell
node --check dist/index.js     # 其余 dist/*.js 同理，过一遍语法
```

然后把整个文件夹复制到 `%APPDATA%\tabby\plugins\node_modules\`，改完必须**重启 Tabby**
（或重新加载窗口）才会生效。源码托管在 `github.com/xyblue135/tabby-ai-search`，
回滚就检出对应提交重新复制。

## 常见问题

- **输入条没出现**：确认当前标签是终端（SSH/local/serial 都行）；检查「设置 → Quick Commands Lite」
  里的开关，以及 `config.yaml` 里没有把 `tabby-quick-cmds-lite` 写进 `pluginBlacklist`。
- **终端行数没跟着变**：Tabby 的 xterm 前端用 ResizeObserver 自动重排；如果是老版本前端，
  拖动一下窗口边缘即可。
- **命令发出去了但没执行**：默认不自动回车，可在终端手动按回车，或在总设置中开启「发送后自动回车（全局）」。开启后仍无效时，再检查回车符（个别设备只认 LF）。
- **升级 Tabby 后失效**：Tabby 大版本可能改动内部 API，重新对照
  `resources/builtin-plugins/tabby-core` 里的类型定义检查即可。
