# tabby-ai-cmds

面向 [Tabby](https://tabby.sh) 的轻量、**AI 就绪**命令管理器。

把常用终端命令集中成一个可搜索的命令面板：按名称 / 分组 / 内容搜索，一键发送到**当前终端**执行。
即使存了几千条命令也保持流畅。

> **AI 模块规划中，当前版本尚未包含。** 本插件目前是一个独立的轻量命令管理器；后续版本将在同一名称下加入
> AI 能力（自然语言生成命令、智能建议等）。

## 功能
- `Alt + Q` 命令面板 + 工具栏按钮
- 命令名称 / 文本 / 分组，搜索带 100ms 防抖
- 新增 / 编辑 / 删除 / 复制，点击即在当前终端执行
- 多行命令、`appendCR`、`\xHH` 控制字符、`\s<ms>` 延时行
- 轻量渲染：预建搜索索引、DOM 上限（按需加载更多）
- 直接读取已有的 `qc.cmds` 数据

## 安装（Windows）
见 [INSTALL-Windows.txt](INSTALL-Windows.txt)。简版：
1. 若已安装 `tabby-quick-cmds` 或 `tabby-quick-cmds-lite`，先禁用（避免 `Alt+Q` 冲突）。
2. 把整个 `tabby-ai-cmds` 文件夹复制到 `%APPDATA%\tabby\plugins\node_modules\`。
3. 重启 Tabby，按 `Alt + Q`。

## 下载
从 [Releases](https://github.com/xyblue135/tabby-ai-cmds/releases) 取最新 zip，
内含可直接使用的 `tabby-ai-cmds` 文件夹，解压到 `%APPDATA%\tabby\plugins\node_modules%` 即可，无需构建。

## 从源码构建
```bash
npm install
npm run build
```

## 许可证
MIT。
