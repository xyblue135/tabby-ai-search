# tabby-ai-cmds

A lightweight, **AI-ready** quick command manager for [Tabby](https://tabby.sh).

Manage your frequently-used terminal commands as a searchable palette: group them,
search by name / group / content, and send any command to the **current terminal** with one
click. Built to stay smooth even with thousands of commands.

> **AI modules are planned but not included yet.** The plugin ships today as a standalone
> lightweight command manager; AI features (natural-language command generation, smart
> suggestions, etc.) will be added in later versions under this same name.

## Features
- `Alt + Q` command palette + toolbar button
- Command name / text / group, with search (100 ms debounce)
- Add / edit / delete / copy, click-to-run on the current terminal
- Multi-line commands, `appendCR`, `\xHH` control chars, `\s<ms>` delay lines
- Lightweight rendering: prebuilt search index, capped DOM (load more on demand)
- Reads your existing `qc.cmds` data directly

## Install (Windows)
See [INSTALL-Windows.txt](INSTALL-Windows.txt) (Chinese guide). Short version:
1. If you have `tabby-quick-cmds` or `tabby-quick-cmds-lite` installed, disable it first (avoid `Alt+Q` conflict).
2. Copy the whole `tabby-ai-cmds` folder into `%APPDATA%\tabby\plugins\node_modules\`.
3. Restart Tabby, then press `Alt + Q`.

## Download
Grab the latest release zip from [Releases](https://github.com/xyblue135/tabby-ai-cmds/releases).
It contains the ready-to-use `tabby-ai-cmds` folder - just extract it into
`%APPDATA%\tabby\plugins\node_modules%`. No build step needed.

## Build from source
```bash
npm install          # installs TypeScript (peer deps are provided by Tabby at runtime)
npm run build        # compiles src/*.ts -> dist/index.js via tsc
```
`src/shims.d.ts` supplies ambient types for Tabby / Angular, so a standalone `tsc` build works
without the full Tabby dev environment.

## Repository layout
```
src/            TypeScript source (index.ts, shims.d.ts)
dist/index.js   Prebuilt plugin (the file Tabby actually loads)
package.json    Plugin manifest
tsconfig.json   Build config (tsc -> dist)
```

## License
MIT.
