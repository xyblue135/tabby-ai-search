'use strict'

/**
 * Quick Commands Lite —— 底部停靠输入条（WindTerm 风格）。
 *
 * 这是一个纯 DOM 组件，不参与 Angular 变更检测：
 * 它被挂进"当前聚焦的终端 tab"的宿主元素里（该元素是 flex 纵向布局），
 * 因此输入条会真正占位在终端下方，xterm 的 ResizeObserver 会自动重排终端行数。
 *
 * 建议列表的开关规则（刻意不绑在 DOM 焦点上）：
 *   打开：聚焦输入框 / 打字 / Alt+Q / ↑↓ / 换分组 / 执行完仍聚焦
 *   关闭：Esc（输入框为空时）/ 点输入条以外的任何地方 / 收起 / 切走标签
 * 这样即使终端前端把焦点抢走（Tabby 的 emitFocused 会调 frontend.focus()），
 * 列表也不会莫名其妙地闪一下就没。
 */

const logic = require('./logic')
const { CommandPreview } = require('./preview')

const STYLE_ID = 'qcl-dock-styles'

const STYLES = `
.qcl-dock, .qcl-dock * { box-sizing: border-box; }
/*
 * 颜色全部走这几个变量：
 *   优先由 JS 从 Tabby 主题变量（--theme-bg-more / --theme-fg ...）取，保证前景背景天然成对；
 *   主题变量缺失时（第三方主题）再从终端配色算对比色兜底。
 */
.qcl-dock {
    --qcl-bg: #1f1f1f;
    --qcl-fg: #e6e6e6;
    --qcl-fg-dim: #9a9a9a;
    --qcl-field: rgba(255,255,255,.08);
    --qcl-border: rgba(255,255,255,.22);
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    /* 比终端内容层高（终端工具栏 4、搜索面板 5） */
    z-index: 5;
    padding: 5px 6px 6px;
    border-top: 1px solid var(--qcl-border);
    background: var(--qcl-bg);
    color: var(--qcl-fg);
    font-family: inherit;
    font-size: 12px;
    line-height: 1.35;
    user-select: none;
    -webkit-user-select: none;
}
.qcl-dock-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.qcl-dock-input { min-width: 120px !important; }
.qcl-dock-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 24px;
    min-width: 24px;
    padding: 0 7px;
    border-radius: 4px;
    border: 1px solid var(--qcl-border);
    background: transparent;
    color: var(--qcl-fg);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
}
.qcl-dock-btn:hover { background: var(--qcl-field); }
.qcl-dock-select {
    flex: 0 0 auto;
    height: 24px;
    max-width: 148px;
    padding: 0 4px;
    border-radius: 4px;
    border: 1px solid var(--qcl-border);
    background: var(--qcl-field);
    color: var(--qcl-fg);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
}
.qcl-dock-select option { background: var(--qcl-bg); color: var(--qcl-fg); }
.qcl-dock-prompt {
    flex: 0 0 auto;
    color: var(--qcl-fg-dim);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.qcl-dock-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 24px;
    padding: 0 8px;
    border-radius: 4px;
    border: 1px solid var(--qcl-border);
    background: var(--qcl-field);
    color: var(--qcl-fg);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    outline: none;
    user-select: text;
    -webkit-user-select: text;
}
.qcl-dock-input:focus { border-color: var(--qcl-fg-dim); }
.qcl-dock-input::placeholder { color: var(--qcl-fg-dim); opacity: .8; }
.qcl-dock-hint { flex: 0 0 auto; color: var(--qcl-fg-dim); font-size: 11px; white-space: nowrap; }
.qcl-dock-list {
    position: absolute;
    left: 6px;
    right: 6px;
    bottom: 100%;
    margin-bottom: 4px;
    max-height: 42vh;
    overflow-y: auto;
    border-radius: 6px;
    border: 1px solid var(--qcl-border);
    background: var(--qcl-bg);
    color: var(--qcl-fg);
    box-shadow: 0 -8px 24px rgba(0,0,0,.4);
    z-index: 7;
}
.qcl-dock-list[hidden] { display: none; }
.qcl-dock-list { padding: 6px; }
.qcl-dock-row {
    display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;
    min-height: 36px; padding: 8px 12px; text-align: left;
    border: 1px solid transparent; border-radius: 5px;
    background: transparent; color: var(--qcl-fg); font: inherit; cursor: pointer;
}
.qcl-dock-row:hover, .qcl-dock-row.selected, .qcl-dock-row:focus-visible {
    background: var(--qcl-field); border-color: var(--qcl-border); outline: none;
}
.qcl-dock-row-name { flex: 1; min-width: 0; white-space: normal; overflow-wrap: anywhere; font-weight: 500; }
.qcl-dock-pinned .qcl-dock-list {
    position: static; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(170px,100%),1fr));
    gap: 5px; margin: 0 0 8px; padding: 2px; max-height: 166px;
    border: 0; border-radius: 0; box-shadow: none;
}
.qcl-dock-pinned .qcl-dock-row { border-color: var(--qcl-border); }
.qcl-dock-pinned .qcl-dock-list[hidden] { display: none; }
.qcl-dock-pinned .qcl-dock-tip { grid-column: 1 / -1; }
.qcl-dock-bar { gap: 7px; }
.qcl-dock-bar .qcl-dock-btn { height: 32px; }
.qcl-dock-input { resize: none; padding: 6px 9px; line-height: 20px; flex: 1 1 220px; font-size: inherit; }
.qcl-dock-select { max-width: min(250px,45vw); font-size: 12px; }
.qcl-dock-send { background: var(--qcl-field); font-weight: 600; }
.qcl-dock-send:disabled { opacity: .4; cursor: default; }
.qcl-dock-hint { margin-right: 4px; }
@media (max-width: 700px) {
    .qcl-dock-input { order: 2; flex: 1 1 calc(100% - 70px); }
    .qcl-dock-send { order: 3; }
    .qcl-dock-hint, .qcl-dock-prompt { display: none; }
}
.qcl-dock-row-kind {
    flex: 0 0 auto;
    padding: 0 3px;
    border: 1px solid var(--qcl-border);
    border-radius: 3px;
    font-size: 10px;
    color: var(--qcl-fg-dim);
}
.qcl-dock-tip { padding: 6px 9px; color: var(--qcl-fg-dim); font-size: 11px; }
.qcl-dock-tip kbd {
    padding: 0 3px;
    border: 1px solid var(--qcl-border);
    border-radius: 3px;
    font-family: inherit;
    font-size: 10px;
}
.qcl-dock-organize { position: relative; }
.qcl-dock-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    border-radius: 8px;
    background: #d9534f;
    color: #fff;
    font-size: 10px;
    line-height: 15px;
    text-align: center;
    pointer-events: none;
}
`

function createElement (tag, className, text) {
    const element = document.createElement(tag)
    if (className) {
        element.className = className
    }
    if (text != null) {
        element.textContent = text
    }
    return element
}

function injectStyles () {
    if (document.getElementById(STYLE_ID)) {
        return
    }
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLES
    document.head.appendChild(style)
}

/** '#rrggbb' / 'rgb()' / 'rgba()' -> {r,g,b,a}，解析不出来返回 null */
function parseColor (value) {
    const text = String(value == null ? '' : value).trim()
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
    if (hex) {
        let digits = hex[1]
        if (digits.length === 3) {
            digits = digits.split('').map(ch => ch + ch).join('')
        }
        return {
            r: parseInt(digits.slice(0, 2), 16),
            g: parseInt(digits.slice(2, 4), 16),
            b: parseInt(digits.slice(4, 6), 16),
            a: 1,
        }
    }
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(text)
    if (rgb) {
        const parts = rgb[1].split(',').map(part => parseFloat(part))
        if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
            return {
                r: parts[0],
                g: parts[1],
                b: parts[2],
                a: Number.isFinite(parts[3]) ? parts[3] : 1,
            }
        }
    }
    return null
}

function isDarkColor (value) {
    const color = parseColor(value)
    if (!color) {
        return true
    }
    return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255 < 0.5
}

/** 半透明色（vibrancy）压成不透明色，避免终端文字透上来 */
function flattenColor (value, dark) {
    const color = parseColor(value)
    if (!color) {
        return dark ? '#1f1f1f' : '#f2f2f2'
    }
    if (color.a >= 1) {
        return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
    }
    const base = dark ? 0 : 255
    const mix = channel => Math.round(channel * color.a + base * (1 - color.a))
    return `rgb(${mix(color.r)}, ${mix(color.g)}, ${mix(color.b)})`
}

const GROUP_ALL = '*'
const GROUP_UNGROUPED = '-'
/** 刚点过鼠标（用户意图）之后的一段时间内不抢焦点 */
const MOUSE_GRACE_MS = 500

class QuickCmdsDock {
    constructor (api) {
        injectStyles()

        this.api = api
        this.host = null
        this.rows = []
        this.rowElements = []
        this.selected = -1
        this.lastSelection = -1
        this.group = ((api.config.store || {}).qc || {}).dock?.activeGroup || GROUP_ALL
        this.groupSignature = ''
        this.stateSignature = ''
        this.renderedSignature = ''
        this.listVisible = false
        this.refreshTimer = null
        this.metricsApplied = false
        this.paletteApplied = false
        this.surface = null
        this.lastMouseDownTime = 0
        this.blurWarned = false
        this.focusRetriesLeft = 0
        this.openedAt = 0
        this.openReason = ''
        this.attachCount = 0
        this.lastAttachTime = 0
        this.focusRetryTimer = null
        this.focusRestoreTimer = null

        this.commandPreview = new CommandPreview()
        this.sending = false
        this.organizerPending = -1
        this.onDocumentMouseDown = event => this.handleDocumentMouseDown(event)

        this.el = createElement('div', 'qcl-dock')
        this.el.setAttribute('data-qcl-dock', '1')

        this.list = createElement('div', 'qcl-dock-list')
        this.list.hidden = true

        const bar = createElement('div', 'qcl-dock-bar')

        this.managerButton = createElement('button', 'qcl-dock-btn', '命令库')
        this.managerButton.type = 'button'
        this.managerButton.title = '打开命令管理器（Alt+Shift+Q）'

        this.groupSelect = createElement('select', 'qcl-dock-select')
        this.groupSelect.title = '按分组过滤收藏命令'

        const prompt = createElement('span', 'qcl-dock-prompt', '❯')

        this.input = createElement('textarea', 'qcl-dock-input')
        this.input.rows = 1
        this.input.setAttribute('aria-label', '搜索或编辑命令')
        this.input.spellcheck = false
        this.input.autocomplete = 'off'
        this.input.setAttribute('autocapitalize', 'off')
        this.input.placeholder = '输入或搜索命令…'
        this.input.title = 'Enter 发送 · Shift+Enter 换行 · ↑↓ 选择收藏 · Tab 填入'

        this.hint = createElement('span', 'qcl-dock-hint', '')

        this.saveButton = createElement('button', 'qcl-dock-btn', '＋')
        this.saveButton.type = 'button'
        this.saveButton.title = '把输入框里的内容保存为收藏命令（Ctrl+S）'

        this.settingsButton = createElement('button', 'qcl-dock-btn', '⚙')
        this.settingsButton.type = 'button'
        this.settingsButton.title = '打开 Quick Commands Lite 总设置'
        this.collapseButton = createElement('button', 'qcl-dock-btn', '⌄')
        this.collapseButton.type = 'button'
        this.collapseButton.title = '收起输入条（Alt+Q 可再次唤出）'

        this.organizerButton = createElement('button', 'qcl-dock-btn qcl-dock-organize', '整理')
        this.organizerButton.type = 'button'
        this.organizerButton.title = '整理记忆：把输入条里用过的命令收进收藏'
        this.organizerBadge = createElement('span', 'qcl-dock-badge', '')
        this.organizerBadge.hidden = true
        this.organizerButton.appendChild(this.organizerBadge)

        bar.appendChild(this.managerButton)
        bar.appendChild(this.groupSelect)
        bar.appendChild(prompt)
        bar.appendChild(this.input)
        this.sendButton = createElement('button', 'qcl-dock-btn qcl-dock-send', '发送')
        this.sendButton.type = 'button'
        this.sendButton.title = '发送输入框中的内容（Enter）；Shift+Enter 换行'
        bar.appendChild(this.sendButton)
        bar.appendChild(this.hint)
        this.aiButton = createElement('button', 'qcl-dock-btn qcl-dock-secondary', 'AI 找命令')
        this.aiButton.type = 'button'
        this.aiButton.addEventListener('click', () => this.api.openAI())
        bar.appendChild(this.aiButton)
        bar.appendChild(this.organizerButton)
        bar.appendChild(this.saveButton)
        bar.appendChild(this.collapseButton)
        bar.appendChild(this.settingsButton)

        this.el.appendChild(this.list)
        this.el.appendChild(bar)

        this.bindEvents()
        this.rebuildGroups()
        this.refresh(true)
    }

    // ---------------------------------------------------------------- 事件

    bindEvents () {
        // Keep terminal bubble handlers from stealing native select focus.
        for (const name of ['mousedown', 'pointerdown', 'click', 'keydown', 'keyup']) {
            this.el.addEventListener(name, event => event.stopPropagation())
        }
        this.managerButton.addEventListener('click', () => this.api.openManager())
        this.settingsButton.addEventListener('click', () => this.api.openSettings())
        this.collapseButton.addEventListener('click', () => {
            this.hideList('collapse')
            this.api.setEnabled(false)
        })
        this.saveButton.addEventListener('click', () => this.saveInputAsCommand())
        this.organizerButton.addEventListener('click', () => this.api.openOrganizer())
        this.sendButton.addEventListener('click', () => this.runInput())
        this.groupSelect.addEventListener('change', () => this.onGroupChanged())

        this.input.addEventListener('keydown', event => this.onKeyDown(event))
        this.input.addEventListener('keyup', event => event.stopPropagation())

        this.input.addEventListener('focus', () => {
            this.clearRefreshTimer()
            this.blurWarned = false
            this.refresh(false)
            this.openList('focus')
        })

        this.input.addEventListener('blur', () => this.onInputBlur())

        this.input.addEventListener('input', () => {
            this.selected = -1
            this.commandPreview.hide()
            this.updateSelection(false)
            this.updateInputHeight()
            this.clearRefreshTimer()
            this.refreshTimer = setTimeout(() => {
                this.refreshTimer = null
                this.refresh(true)
                this.openList('typing')
            }, 80)
        })

        // Only dock buttons use the click action setting; the manager only edits.
        this.list.addEventListener('click', event => {
            const row = event.target instanceof Element ? event.target.closest('.qcl-dock-row') : null
            if (!row) return
            const index = Number(row.getAttribute('data-index'))
            if (Number.isFinite(index) && this.rows[index]) {
                this.selected = index
                if (this.settings().clickAction === 'fill') this.fillSelected()
                else this.runSelected()
            }
        })

        this.list.addEventListener('contextmenu', event => {
            const element = event.target instanceof Element ? event.target.closest('.qcl-dock-row') : null
            const row = element && this.rows[Number(element.getAttribute('data-index'))]
            if (!row || row.kind !== 'cmd') return
            event.preventDefault()
            event.stopPropagation()
            this.selected = -1
            this.updateSelection(false)
            this.commandPreview.hide()
            this.api.editCommand(row.cmd)
        })

        // 点到输入条以外的地方才关列表（列表开着才检查，平时零开销）
        document.addEventListener('mousedown', this.onDocumentMouseDown, true)
    }

    /**
     * 只有"明确点在终端内容区"才收起列表。
     * 早先的规则是"点到输入条以外的任何地方就关"，结果任何一次程序性/无关的 mousedown
     * 都会把列表关掉，看起来就是闪一下。
     */
    handleDocumentMouseDown (event) {
        this.lastMouseDownTime = Date.now()
        if (!this.listVisible) {
            return
        }
        const target = event ? event.target : null
        if (!target) {
            return
        }
        if (typeof this.el.contains === 'function' && this.el.contains(target)) {
            return
        }
        if (typeof target.closest !== 'function') {
            return
        }
        const inTerminal = target.closest('.content') || target.closest('.xterm') ||
            target.closest('canvas') || target.closest('terminal-toolbar')
        if (inTerminal) {
            this.hideList('click-terminal')
        }
    }

    /**
     * 输入框失焦时**不跟终端抢焦点**（来回抢会让焦点环反复闪，看起来就是"闪"）。
     * 列表的开关本来就不依赖焦点；这里只记录一次诊断信息，便于定位是谁在抢。
     */
    onInputBlur () {
        if (!this.listVisible) {
            return
        }
        if (Date.now() - this.lastMouseDownTime < MOUSE_GRACE_MS) {
            return
        }
        if (this.openedAt && Date.now() - this.openedAt < 1500 && !this.blurWarned) {
            this.blurWarned = true
            console.warn('[tabby-quick-cmds-lite] 输入框被程序性抢走了焦点（列表保持打开；'
                + '如果你是按了 Alt+Q 之后马上打不了字，请把这条日志发给我）')
        }
    }

    onGroupChanged () {
        this.group = this.groupSelect.value
        this.input.value = ''
        this.commandPreview.hide()
        const store = this.api.config.store
        if (store) {
            store.qc = store.qc || {}
            store.qc.dock = store.qc.dock || {}
            store.qc.dock.activeGroup = this.group
            this.api.markDirty()
        }
        this.refresh(true)
        this.openList('group-change')
        // Keep focus on the select so native keyboard selection remains stable.
    }

    onKeyDown (event) {
        event.stopPropagation()
        if (event.isComposing || event.keyCode === 229) return

        if (event.ctrlKey && !event.altKey && !event.metaKey && (event.key === 's' || event.key === 'S')) {
            event.preventDefault()
            this.saveInputAsCommand()
            return
        }

        switch (event.key) {
            case 'Enter':
                if (event.shiftKey) return
                event.preventDefault()
                if (this.selected >= 0 && this.rows[this.selected]) {
                    this.runSelected()
                } else {
                    this.runInput()
                }
                break
            case 'Tab':
                if (this.selected >= 0 && this.rows[this.selected]) {
                    event.preventDefault()
                    this.fillSelected()
                }
                break
            case 'ArrowDown':
                if (this.input.value.includes('\n')) return
                event.preventDefault()
                this.moveSelection(1)
                break
            case 'ArrowUp':
                if (this.input.value.includes('\n')) return
                event.preventDefault()
                this.moveSelection(-1)
                break
            case 'Escape':
                event.preventDefault()
                this.escape()
                break
            default:
                break
        }
    }

    // ------------------------------------------------------------ 挂载/卸载

    attach (host) {
        if (!host || this.host === host) {
            return
        }
        // 自诊断：短时间内反复挂载说明停靠位置在抖，表现为整条输入条闪烁
        const now = Date.now()
        if (now - this.lastAttachTime < 2000) {
            this.attachCount++
            if (this.attachCount === 3) {
                console.warn('[tabby-quick-cmds-lite] 输入条在 2 秒内被反复重新挂载，停靠位置可能不稳定')
            }
        } else {
            this.attachCount = 0
        }
        this.lastAttachTime = now
        this.host = host
        host.appendChild(this.el)
        this.invalidateMetrics()
        this.stateSignature = ''
        this.renderedSignature = ''
        this.applyMetrics()
        this.refresh(true)
    }

    detach () {
        this.hideList('detach')
        if (this.el.parentElement) {
            this.el.parentElement.removeChild(this.el)
        }
        this.host = null
    }

    get attachedHost () {
        return this.host
    }

    isFocused () {
        return document.activeElement === this.input
    }

    /** 对齐终端内容的左右外边距，看起来像原生的一部分 */
    applyMetrics (force) {
        if (!this.host || (this.metricsApplied && !force)) {
            return
        }
        try {
            const content = this.host.querySelector(':scope > .content')
            if (content) {
                const style = getComputedStyle(content)
                this.el.style.marginLeft = style.marginLeft
                this.el.style.marginRight = style.marginRight
                this.el.style.marginBottom = style.marginBottom
                this.metricsApplied = true
            }
        } catch (error) {
            // 布局还没就绪，下次 sync 再试
        }
        if (!this.paletteApplied || force) {
            this.applyPalette()
        }
    }

    invalidateMetrics () {
        this.metricsApplied = false
        this.paletteApplied = false
        this.surface = null
    }

    /** 读取 Tabby 主题变量（themes.service.ts 把它们写在 :root 上） */
    themeVar (name) {
        try {
            const style = getComputedStyle(document.documentElement)
            if (!style || typeof style.getPropertyValue !== 'function') {
                return ''
            }
            const value = style.getPropertyValue(name)
            return value ? String(value).trim() : ''
        } catch (error) {
            return ''
        }
    }

    /**
     * 定颜色。优先用 Tabby 主题变量（前景/背景天然成对，深色浅色主题都不会看不清），
     * 主题变量缺失时才从终端底色推算对比色。
     */
    applyPalette () {
        const themeBg = this.themeVar('--theme-bg')
        const themeFg = this.themeVar('--theme-fg')
        let palette
        if (themeBg && themeFg) {
            const dark = isDarkColor(themeBg)
            palette = {
                bg: flattenColor(this.themeVar('--theme-bg-more') || themeBg, dark),
                fg: themeFg,
                dim: this.themeVar('--theme-fg-less') || themeFg,
                field: flattenColor(this.themeVar('--theme-bg-more-2') || themeBg, dark),
                border: this.themeVar('--theme-fg-less-2') || this.themeVar('--theme-fg-less') || themeFg,
            }
        } else {
            const surface = this.sampleSurface()
            const dark = isDarkColor(surface)
            palette = {
                bg: flattenColor(surface, dark),
                fg: dark ? '#e8e8e8' : '#1b1b1b',
                dim: dark ? '#a2a2a2' : '#575757',
                field: dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.06)',
                border: dark ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.22)',
            }
        }
        this.setPalette(palette)
    }

    setPalette (palette) {
        const style = this.el.style
        style.setProperty('--qcl-bg', palette.bg)
        style.setProperty('--qcl-fg', palette.fg)
        style.setProperty('--qcl-fg-dim', palette.dim)
        style.setProperty('--qcl-field', palette.field)
        style.setProperty('--qcl-border', palette.border)
        this.paletteApplied = true
    }

    /** 取一个不透明的底色给下拉列表用（终端配色可能是深色也可能是浅色） */
    sampleSurface () {
        const isOpaque = color => color && color !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(color)
        try {
            const content = this.host ? this.host.querySelector(':scope > .content') : null
            let element = content ? content.firstElementChild : null
            while (element) {
                const color = getComputedStyle(element).backgroundColor
                if (isOpaque(color)) {
                    return color
                }
                element = element.nextElementSibling
            }
            if (this.host) {
                const hostColor = getComputedStyle(this.host).backgroundColor
                if (isOpaque(hostColor)) {
                    return hostColor
                }
            }
            const bodyColor = getComputedStyle(document.body).backgroundColor
            if (isOpaque(bodyColor)) {
                return bodyColor
            }
        } catch (error) {
            // 忽略，用兜底色
        }
        return '#1e1e1e'
    }

    // ---------------------------------------------------------------- 设置

    settings () {
        const store = this.api.config.store || {}
        const qc = store.qc || {}
        const dock = qc.dock || {}
        const toNumber = (value, fallback) => {
            const number = Number(value)
            return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
        }
        return {
            enabled: dock.enabled !== false,
            maxSuggestions: toNumber(dock.maxSuggestions, 10),
            historySize: toNumber(dock.historySize, 500),
            saveHistory: dock.saveHistory !== false,
            showHistory: dock.showHistory !== false,
            terminator: logic.terminatorFor(dock.terminator),
            clickAction: dock.clickAction === 'fill' ? 'fill' : 'send',
            fontSize: Number(dock.fontSize) >= 10 ? Number(dock.fontSize) : 14,
            inputHeight: Number(dock.inputHeight) >= 24 ? Number(dock.inputHeight) : 34,
            inputRatio: Number(dock.inputRatio) >= 20 ? Number(dock.inputRatio) : 60,
        }
    }

    history () {
        const qc = (this.api.config.store && this.api.config.store.qc) || {}
        const dock = qc.dock || {}
        return logic.normalizeHistory(Array.isArray(dock.history) ? dock.history : [])
    }

    pushHistory (text) {
        const settings = this.settings()
        if (!settings.saveHistory) {
            return
        }
        const store = this.api.config.store
        if (!store) {
            return
        }
        // 终端正在等密码时，发出去的这条不是命令，不能记
        if (this.recentOutputAsksForSecret()) {
            return
        }
        if (!store.qc) {
            store.qc = {}
        }
        if (!store.qc.dock) {
            store.qc.dock = {}
        }
        store.qc.dock.history = logic.pushHistoryEntry(this.history(), text, settings.historySize)
        this.api.markDirty()
    }

    /**
     * 密码防护：读 xterm 可见缓冲区里光标附近 3 行，若行尾是 password / passphrase /
     * 密码 / 口令 提示（OpenSSH、sudo、mysql 等都是这个形态），判定为敏感输入。
     * 读不到缓冲区时按"不是密码"处理，不影响正常记录。
     */
    recentOutputAsksForSecret () {
        try {
            const terminal = this.api.executor && typeof this.api.executor.activeTerminal === 'function'
                ? this.api.executor.activeTerminal()
                : null
            const frontend = terminal && terminal.frontend
            const buffer = frontend && frontend.xterm && frontend.xterm.buffer ? frontend.xterm.buffer.active : null
            if (!buffer) {
                return false
            }
            const viewportY = typeof buffer.viewportY === 'number' ? buffer.viewportY : 0
            const cursorY = typeof buffer.cursorY === 'number' ? buffer.cursorY : 0
            for (let row = Math.max(0, cursorY - 2); row <= cursorY; row++) {
                const line = buffer.getLine(viewportY + row)
                if (!line) {
                    continue
                }
                if (/(password|passphrase|口令|密码)\s*[:：]?\s*$/i.test(line.translateToString(true))) {
                    return true
                }
            }
        } catch (error) {
            // 缓冲区不可用就放行
        }
        return false
    }

    /** 整理页"丢弃"单条：从历史里删掉这个文本 */
    removeHistoryText (text) {
        const store = this.api.config.store
        if (!store) {
            return
        }
        if (!store.qc) {
            store.qc = {}
        }
        if (!store.qc.dock) {
            store.qc.dock = {}
        }
        store.qc.dock.history = this.history().filter(item => item.text !== text)
        this.api.markDirty()
        this.refresh(true)
    }

    /** 待整理数 = 不在收藏里的历史条数；顺带刷新整理按钮的角标 */
    updateOrganizerBadge () {
        let count = 0
        const favorites = this.api.store && typeof this.api.store.favoriteTexts === 'function'
            ? this.api.store.favoriteTexts()
            : null
        if (favorites) {
            for (const item of this.history()) {
                if (item.text && !favorites.has(item.text)) {
                    count++
                }
            }
        }
        if (count !== this.organizerPending) {
            this.organizerPending = count
            this.organizerBadge.textContent = count > 99 ? '99+' : String(count)
            this.organizerBadge.hidden = count === 0
        }
    }

    clearHistory () {
        const store = this.api.config.store
        if (!store) {
            return
        }
        if (!store.qc) {
            store.qc = {}
        }
        if (!store.qc.dock) {
            store.qc.dock = {}
        }
        store.qc.dock.history = []
        this.api.markDirty()
        this.refresh(true)
    }

    // ------------------------------------------------------- 由外部调用的同步

    /** 分组/设置/命令列表变化时刷新（幂等且廉价，可被心跳反复调用） */
    sync () {
        if (!this.host) {
            return
        }
        this.applyMetrics(false)
        const groupsChanged = this.rebuildGroups()
        this.refresh(groupsChanged)
    }

    rebuildGroups () {
        // 原生下拉正开着的时候不要动它的 options，否则弹层会闪
        if (document.activeElement === this.groupSelect) {
            return false
        }
        let names = []
        let hasUngrouped = false
        try {
            names = this.api.store.groups()
            hasUngrouped = this.api.store.hasUngrouped()
        } catch (error) {
            return false
        }
        const signature = `${names.join('\n')}|${hasUngrouped}`
        if (signature === this.groupSignature) {
            return false
        }
        this.groupSignature = signature

        const previous = this.group
        const options = [new Option('全部分组', GROUP_ALL)]
        for (const name of names) {
            options.push(new Option(name, name))
        }
        if (hasUngrouped) {
            options.push(new Option('未分组', GROUP_UNGROUPED))
        }
        this.groupSelect.replaceChildren(...options)
        const exists = Array.from(this.groupSelect.options).some(option => option.value === previous)
        this.group = exists ? previous : GROUP_ALL
        this.groupSelect.value = this.group
        return true
    }

    groupParam () {
        if (this.group === GROUP_ALL) {
            return null
        }
        if (this.group === GROUP_UNGROUPED) {
            return ''
        }
        return this.group
    }

    // ------------------------------------------------------------ 列表渲染

    /**
     * force=true：无条件重算并重置高亮；force=false：状态没变就什么都不做。
     * 这样每秒的心跳同步几乎零开销。
     */
    refresh (force) {
        const settings = this.settings()
        this.el.style.fontSize = `${settings.fontSize}px`
        this.groupSelect.style.height = `${settings.inputHeight}px`
        this.updateInputHeight()
        this.el.classList.toggle('qcl-dock-pinned', this.isPinned())
        const query = this.input.value
        const history = this.history()
        this.updateOrganizerBadge()
        const limit = this.group !== GROUP_ALL ? 0 : settings.maxSuggestions
        const revision = typeof this.api.store.revision === 'number' ? this.api.store.revision : 0
        const signature = [
            query, this.group, limit, settings.showHistory, settings.saveHistory,
            history.length, (history[0] && history[0].text) || '', revision,
        ].join('\u0000')

        if (!force && signature === this.stateSignature) {
            return
        }
        this.stateSignature = signature

        const result = this.api.store.search(query, this.groupParam(), limit, true)

        let rows = []
        if (query.trim()) {
            rows = result.items.map(cmd => ({
                kind: 'cmd',
                name: cmd.name || '未命名命令',
                group: cmd.group || '未分组',
                text: logic.preview(cmd.text, 200),
                cmd,
            }))
            if (this.group === GROUP_ALL && settings.showHistory && settings.saveHistory) {
                const tokens = logic.tokenize(query)
                const historyRows = this.history()
                    .filter(item => tokens.every(token => item.text.toLocaleLowerCase().includes(token)))
                    .slice(0, 3)
                    .map(item => ({ kind: 'history', name: item.text, group: '历史', text: '', value: item.text }))
                rows = rows.concat(historyRows)
            }
            this.hint.textContent = result.total > rows.length ? `${rows.length}/${result.total}` : `${result.total} 条`
        } else {
            rows = result.items.map(cmd => ({ kind: 'cmd', name: cmd.name || '未命名命令', group: cmd.group || '未分组', text: logic.preview(cmd.text, 200), cmd }))
            if (this.group === GROUP_ALL && settings.showHistory && settings.saveHistory) {
                rows = this.history()
                    .slice(0, Math.max(limit, 8))
                    .map(item => ({ kind: 'history', name: item.text, group: '历史', text: '', value: item.text })).concat(rows).slice(0, limit)
            }
            this.hint.textContent = `${result.total} 条命令`
        }

        this.rows = rows
        this.renderRows()
        if (this.isPinned()) this.openList('group-pinned')
        if (force) {
            this.selected = -1
            this.lastSelection = -1
        } else if (this.selected >= rows.length) {
            this.selected = -1
        }
        this.updateSelection(true)
    }

    renderRows () {
        // 内容没变就不动 DOM，避免打字时列表内容抖动
        const tipKind = this.rows.length ? '' : (this.input.value.trim() ? 'tip-input' : 'tip-hint')
        const signature = `${tipKind}\n${this.rows.map(row => `${row.kind}|${row.name}|${row.group}|${row.text}`).join('\n')}`
        if (signature === this.renderedSignature) {
            return
        }
        this.renderedSignature = signature

        this.commandPreview.hide()
        this.rowElements = []
        const nodes = []

        if (!this.rows.length) {
            const tip = createElement('div', 'qcl-dock-tip')
            if (this.isPinned()) {
                tip.textContent = '本分组还没有命令，可点 ＋ 添加'
            } else if (this.input.value.trim()) {
                tip.textContent = '没有匹配的收藏命令 —— 回车可直接把输入内容发送到终端'
            } else {
                tip.appendChild(document.createTextNode('回车把输入内容发送到终端　'))
                const kbd = createElement('kbd', null, '↑↓')
                tip.appendChild(kbd)
                tip.appendChild(document.createTextNode(' 选择收藏命令　'))
                const kbd2 = createElement('kbd', null, 'Tab')
                tip.appendChild(kbd2)
                tip.appendChild(document.createTextNode(' 填入输入框　'))
                const kbd3 = createElement('kbd', null, 'Esc')
                tip.appendChild(kbd3)
                tip.appendChild(document.createTextNode(' 回到终端'))
            }
            this.list.replaceChildren(tip)
            return
        }

        this.rows.forEach((row, index) => {
            const element = createElement('button', 'qcl-dock-row')
            element.type = 'button'
            element.setAttribute('data-index', String(index))
            element.setAttribute('aria-label', row.name)
            element.appendChild(createElement('span', 'qcl-dock-row-name', row.name))
            if (row.kind === 'history') element.appendChild(createElement('span', 'qcl-dock-row-kind', '历史'))
            const show = () => this.commandPreview.show(element, row.kind === 'cmd' ? row.cmd.text : row.value, row.name)
            element.addEventListener('mouseenter', show)
            element.addEventListener('mouseleave', () => this.commandPreview.scheduleHide())
            element.addEventListener('focus', show)
            element.addEventListener('blur', () => this.commandPreview.scheduleHide())
            nodes.push(element)
            this.rowElements.push(element)
        })

        this.list.replaceChildren(...nodes)
    }

    updateSelection (scroll) {
        this.rowElements.forEach((element, index) => {
            element.classList.toggle('selected', index === this.selected)
        })
        if (!scroll || this.selected === this.lastSelection || this.selected <= 0) {
            return
        }
        this.lastSelection = this.selected
        const element = this.rowElements[this.selected]
        if (element && typeof element.scrollIntoView === 'function') {
            element.scrollIntoView({ block: 'nearest' })
        }
    }

    moveSelection (delta) {
        if (!this.rows.length) {
            return
        }
        this.openList('navigate')
        const count = this.rows.length
        this.selected = this.selected < 0 ? (delta > 0 ? 0 : count - 1) : ((this.selected + delta) % count + count) % count
        this.updateSelection(true)
        const row = this.rows[this.selected]
        this.commandPreview.show(this.rowElements[this.selected], row.kind === 'cmd' ? row.cmd.text : row.value, row.name)
    }

    openList (reason) {
        if (!this.host) {
            return
        }
        if (!this.listVisible) {
            this.openedAt = Date.now()
            this.openReason = reason || 'unknown'
        }
        this.list.hidden = false
        this.listVisible = true
        this.updateSelection(false)
        // 刚打开就被别的东西抢走焦点的话，补一次（终端前端的 focus() 是延迟执行的）
        // List visibility is independent of focus; never steal focus from controls.
    }

    hideList (reason) {
        this.commandPreview.hide()
        if (this.isPinned() && ['click-terminal', 'escape'].includes(reason)) {
            this.selected = -1
            this.updateSelection(false)
            return
        }
        const wasVisible = this.listVisible
        this.list.hidden = true
        this.listVisible = false
        this.lastSelection = -1
        if (this.focusRetryTimer) {
            clearTimeout(this.focusRetryTimer)
            this.focusRetryTimer = null
        }
        // 自诊断：短时间内开了又关，说明有东西在捣乱，把原因打到控制台
        if (wasVisible && this.openedAt && Date.now() - this.openedAt < 800) {
            console.warn(`[tabby-quick-cmds-lite] 建议列表只开了 ${Date.now() - this.openedAt}ms 就被关闭`
                + `（打开原因: ${this.openReason}，关闭原因: ${reason || 'unknown'}）`)
        }
    }

    /**
     * 打开后最多补两次焦点（终端前端的 focus() 是 setTimeout 延迟执行的），
     * 补完就不再纠缠 —— 反复抢焦点会让界面闪。
     */
    scheduleFocusRetry () {
        if (this.focusRetryTimer) {
            clearTimeout(this.focusRetryTimer)
            this.focusRetryTimer = null
        }
        this.focusRetriesLeft = 2
        const attempt = () => {
            this.focusRetryTimer = null
            if (!this.listVisible || this.isFocused() || this.focusRetriesLeft <= 0) {
                return
            }
            if (Date.now() - this.lastMouseDownTime < MOUSE_GRACE_MS) {
                return
            }
            this.focusRetriesLeft--
            this.input.focus()
            if (this.focusRetriesLeft > 0 && !this.isFocused()) {
                this.focusRetryTimer = setTimeout(attempt, 220)
            }
        }
        this.focusRetryTimer = setTimeout(attempt, 80)
    }

    /**
     * 终端被 Tabby 聚焦（selectTab / 窗口重新获得焦点）时会同步调用 frontend.focus()，
     * 把焦点从输入框抢走。列表还开着说明用户仍想继续输入，这里补一次焦点。
     *
     * 只补一次，且用户刚点过鼠标（说明是他自己点的终端）时不动 —— 不与终端无限互抢。
     * 注意：点终端时列表已经在 document 的捕获阶段收起了，所以不会走到这里。
     */
    restoreFocus () {
        if (this.focusRestoreTimer) {
            clearTimeout(this.focusRestoreTimer)
        }
        this.focusRestoreTimer = setTimeout(() => {
            this.focusRestoreTimer = null
            if (!this.listVisible || this.isFocused() || document.activeElement === this.groupSelect || document.getElementById('qcl-ai-overlay')) {
                return
            }
            if (Date.now() - this.lastMouseDownTime < MOUSE_GRACE_MS) {
                return
            }
            this.input.focus()
        }, 0)
    }

    // ---------------------------------------------------------------- 动作

    isPinned () { return this.group !== GROUP_ALL && !this.input.value.trim() }

    updateInputHeight () {
        const base = this.settings().inputHeight
        const lines = this.input.value.split('\n').length
        this.input.style.height = 'auto'
        this.input.style.height = `${Math.min(160, Math.max(base, this.input.scrollHeight + 2, lines * 20 + 14))}px`
        this.sendButton.disabled = this.sending || !this.input.value.trim()
    }

    async runSelected () {
        const row = this.rows[this.selected]
        if (!row || this.sending) return
        await this.performSend(() => row.kind === 'cmd'
            ? this.api.executor.send(row.cmd)
            : this.api.executor.sendText(row.value), row.kind === 'history' ? row.value : null)
    }

    async runInput () {
        const text = this.input.value
        if (!text.trim() || this.sending) return
        await this.performSend(() => this.api.executor.sendText(text), text)
    }

    async performSend (send, historyText) {
        const initialInput = this.input.value
        this.sending = true
        this.commandPreview.hide()
        this.updateInputHeight()
        try {
            if (await send() === false) return
            if (historyText) this.pushHistory(historyText)
            if (this.input.value === initialInput) this.afterRun()
        } catch (error) {
            if (this.api.notify) this.api.notify('发送失败，输入内容已保留：' + String(error.message || error))
        } finally {
            this.sending = false
            this.updateInputHeight()
        }
    }

    afterRun () {
        this.input.value = ''
        this.selected = -1
        this.refresh(true)
        this.input.focus()
        this.openList('after-run')
    }

    fillText (text) {
        this.input.value = String(text || '')
        this.selected = -1
        this.clearRefreshTimer()
        this.commandPreview.hide()
        this.refresh(true)
        this.input.focus()
        this.input.setSelectionRange(this.input.value.length, this.input.value.length)
        this.openList('fill')
    }

    fillSelected () {
        const row = this.rows[this.selected]
        if (row) this.fillText(row.kind === 'cmd' ? row.cmd.text : row.value)
    }

    escape () {
        if (this.input.value) {
            this.input.value = ''
            this.refresh(true)
            this.openList('escape-clear')
            return
        }
        this.hideList('escape')
        this.input.blur()
        this.api.focusTerminal()
    }

    saveInputAsCommand () {
        const text = this.input.value
        this.api.saveAsCommand(text)
    }

    /** 由快捷键 Alt+Q 调用 */
    focusInput () {
        this.refresh(false)
        this.input.focus()
        this.input.select()
        this.openList('hotkey')
    }

    clearRefreshTimer () {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer)
            this.refreshTimer = null
        }
    }

    destroy () {
        this.clearRefreshTimer()
        this.commandPreview.destroy()
        if (this.focusRestoreTimer) {
            clearTimeout(this.focusRestoreTimer)
            this.focusRestoreTimer = null
        }
        document.removeEventListener('mousedown', this.onDocumentMouseDown, true)
        this.detach()
    }
}

module.exports = { QuickCmdsDock, parseColor, isDarkColor, flattenColor }

