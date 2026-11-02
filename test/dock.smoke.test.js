'use strict'

/* eslint-disable no-console */

/**
 * 用一个极简的假 DOM 冒烟测试 dist/dock.js：
 * 覆盖构造、挂载、搜索渲染、键盘操作、历史记忆、整理角标、密码防护等真实代码路径。
 */

const assert = require('assert')

// ------------------------------------------------------------------ 假 DOM
const { install, FakeElement } = require('./fake-dom')
install()

// ------------------------------------------------------------------ 被测对象
const { QuickCmdsDock } = require('../dist/dock')

function makeApi (commands) {
    const calls = { sent: [], text: [], history: [], dirty: 0, manager: 0, organizer: 0, saved: [], enabled: [], focusedTerminal: 0 }
    const index = commands.map((cmd, order) => ({
        cmd,
        order,
        nameLower: cmd.name.toLocaleLowerCase(),
        groupLower: cmd.group.toLocaleLowerCase(),
        textLower: cmd.text.toLocaleLowerCase(),
        haystack: `${cmd.name}\n${cmd.group}\n${cmd.text}`.toLocaleLowerCase(),
    }))
    return {
        calls,
        config: { store: { qc: { dock: { enabled: true, maxSuggestions: 10, historySize: 500, history: [] } } } },
        store: {
            revision: 1,
            groups: () => Array.from(new Set(commands.map(x => x.group).filter(Boolean))),
            hasUngrouped: () => commands.some(x => !x.group),
            favoriteTexts: () => new Set(index.map(entry => String(entry.cmd.text || '').trim())),
            search: (query, group, limit, rank) => {
                const tokens = String(query || '').toLocaleLowerCase().split(/\s+/).filter(Boolean)
                const matched = index.filter(entry =>
                    (group === null || (entry.cmd.group || '') === group) &&
                    tokens.every(token => entry.haystack.includes(token)))
                return { items: matched.slice(0, limit).map(x => x.cmd), total: matched.length }
            },
        },
        executor: {
            send: cmd => calls.sent.push(cmd),
            sendText: (text, appendCr) => calls.text.push({ text, appendCr }),
        },
        openManager: () => calls.manager++,
        openOrganizer: () => calls.organizer++,
        saveAsCommand: text => calls.saved.push(text),
        setEnabled: value => calls.enabled.push(value),
        focusTerminal: () => calls.focusedTerminal++,
        markDirty: () => calls.dirty++,
        notify: () => null,
    }
}

const commands = [
    { id: '1', name: '查看 Docker 容器', group: '20_Docker', text: 'docker ps -a', appendCR: true },
    { id: '2', name: '看温度', group: '10_系统', text: 'watch sensors', appendCR: true },
    { id: '3', name: '未分组命令', group: '', text: 'echo hi', appendCR: true },
]

let passed = 0
const failures = []
const asyncTests = []

const createdDocks = []
/** 统一登记，便于每个用例前销毁上一个用例的实例（它们的定时器会抢 document.activeElement） */
function makeDock (api) {
    const dock = new QuickCmdsDock(api)
    createdDocks.push(dock)
    return dock
}

function resetEnvironment () {    global.document.resetListeners()
    for (const key of Object.keys(global.__themeVars || {})) {
        delete global.__themeVars[key]
    }
    // 诊断日志在测试里静音（需要断言的用例会临时接管 console.warn）
    console.warn = () => null
    while (createdDocks.length) {
        createdDocks.pop().destroy()
    }
}

/**
 * 同步用例立即跑；async 用例排到最后依次跑。
 * 每个用例开始前清掉 document 级监听与主题变量，避免不同 dock 实例之间串状态。
 */
function test (name, fn) {
    if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
        asyncTests.push({ name, fn })
        return
    }
    resetEnvironment()
    try {
        fn()
        passed++
        console.log(`  ok  ${name}`)
    } catch (error) {
        failures.push({ name, error })
        console.log(`FAIL  ${name}\n      ${error.message}`)
    }
}

async function runAsyncTests () {
    for (const { name, fn } of asyncTests) {
        resetEnvironment()
        try {
            await fn()
            passed++
            console.log(`  ok  ${name}`)
        } catch (error) {
            failures.push({ name, error })
            console.log(`FAIL  ${name}\n      ${error.message}`)
        }
    }
}

function press (dock, key, extra) {
    const event = { key, preventDefault: () => { event.defaultPrevented = true }, stopPropagation: () => { event.stopped = true }, ...extra }
    dock.input.dispatch('keydown', event)
    return event
}

console.log('dock 冒烟测试')

test('构造后按钮与列表就位，分组下拉已填好', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    const bar = dock.el.children.find(child => child.className.includes('qcl-dock-bar'))
    assert.ok(bar, '应有 bar')
    assert.strictEqual(bar.children.length, 11, '命令库/分组/提示符/输入框/发送/hint/AI/整理/＋/⌄/⚙ 共 11 个')
    const values = dock.groupSelect.options.map(option => option.value)
    // 分组顺序由 store.groups() 决定（真实实现按 localeCompare 排序）
    assert.deepStrictEqual(values, ['*', '20_Docker', '10_系统', '-'])
    assert.strictEqual(dock.input.placeholder.length > 0, true, '输入框有占位提示')
    assert.ok(dock.input.title.includes('Enter 发送'), '快捷键提示在 title 里')
})

test('挂载到终端宿主元素并渲染建议列表', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    const host = new FakeElement('tabby-terminal')
    dock.attach(host)
    assert.strictEqual(dock.attachedHost, host)
    assert.strictEqual(host.children[0], dock.el)

    dock.input.value = 'docker'
    dock.input.focus()
    dock.refresh(true)
    const rows = dock.list.children
    assert.strictEqual(rows.length, 1, `应只有 1 条匹配，实际 ${rows.length}`)
    assert.strictEqual(rows[0].getAttribute('data-index'), '0')
    assert.ok(dock.hint.textContent.includes('1'))
})

test('回车执行高亮的收藏命令（先 ↑↓ 明确选中）', async () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.focus()
    dock.input.value = '温度'
    dock.refresh(true)
    assert.strictEqual(dock.rows.length, 1)
    press(dock, 'ArrowDown')                  // 1.2.0 起输入不自动选中首条，需显式选择
    const event = press(dock, 'Enter')
    assert.ok(event.defaultPrevented, '应 preventDefault')
    assert.ok(event.stopped, '应 stopPropagation，避免打扰终端')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.strictEqual(api.calls.sent.length, 1)
    assert.strictEqual(api.calls.sent[0].id, '2')
    assert.deepStrictEqual(api.calls.text, [], '不应发送原始文本')
    assert.strictEqual(dock.input.value, '', '执行后应清空')
    assert.strictEqual(document.activeElement, dock.input, '执行后保持焦点')
    assert.strictEqual(dock.listVisible, true, '执行后列表继续开着，方便连着敲下一条')
})

test('输入未选中任何条目时，回车把输入原样发送到终端', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.value = 'ls -al /tmp'
    dock.refresh(true)
    assert.strictEqual(dock.rows.length, 0)
    press(dock, 'Enter')
    assert.strictEqual(api.calls.text[0].text, 'ls -al /tmp')
    assert.deepStrictEqual(api.calls.sent, [])
})

test('空输入回车什么都不做', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.value = '   '
    press(dock, 'Enter')
    assert.deepStrictEqual(api.calls.text, [])
    assert.deepStrictEqual(api.calls.sent, [])
})

test('↑↓ 移动高亮，Tab 填入输入框', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.value = ''
    dock.group = '*'
    dock.refresh(true)
    // 空输入 + 全部分组：历史为空时直接给出收藏命令建议（1.2.0 起的行为）
    assert.strictEqual(dock.rows.length, 3)

    dock.input.value = 'e'
    dock.refresh(true)
    assert.ok(dock.rows.length >= 1)
    press(dock, 'ArrowDown')
    press(dock, 'ArrowUp')
    const tab = press(dock, 'Tab')
    assert.ok(tab.defaultPrevented)
    assert.ok(dock.input.value.length > 0, 'Tab 应把命令填进输入框')
    assert.deepStrictEqual(api.calls.text, [], 'Tab 不发送')
})

test('Esc：先清空，再交还焦点给终端', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.value = 'docker'
    dock.refresh(true)
    press(dock, 'Escape')
    assert.strictEqual(dock.input.value, '')
    assert.strictEqual(api.calls.focusedTerminal, 0)
    press(dock, 'Escape')
    assert.strictEqual(api.calls.focusedTerminal, 1)
})

test('点击建议行会执行该命令', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.value = 'docker'
    dock.refresh(true)
    const row = dock.list.children[0]
    dock.list.dispatch('click', { target: row })
    assert.strictEqual(api.calls.sent.length, 1)
    assert.strictEqual(api.calls.sent[0].id, '1')
})

test('分组下拉过滤', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.group = '10_系统'
    dock.groupSelect.value = '10_系统'
    dock.refresh(true)
    assert.strictEqual(dock.hint.textContent.startsWith('1'), true)
    dock.group = '-'
    dock.refresh(true)
    assert.ok(dock.hint.textContent.startsWith('1'))
})

test('执行后写入历史（对象条目）并延迟落盘', async () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.value = 'sudo reboot'
    dock.refresh(true)
    press(dock, 'Enter')
    await new Promise(resolve => setTimeout(resolve, 10))
    const history = api.config.store.qc.dock.history
    assert.strictEqual(history.length, 1)
    assert.strictEqual(history[0].text, 'sudo reboot')
    assert.strictEqual(history[0].count, 1)
    assert.strictEqual(api.calls.dirty, 1)

    dock.input.value = 'sudo reboot'
    press(dock, 'Enter')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.strictEqual(api.config.store.qc.dock.history.length, 1, '重复命令合并')
    assert.strictEqual(api.config.store.qc.dock.history[0].count, 2, '重复命令次数 +1')
})

test('空输入时建议列表来自历史（旧字符串数据自动迁移，历史排在前）', async () => {
    const api = makeApi(commands)
    api.config.store.qc.dock.history = ['git status', 'docker ps']
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.value = ''
    dock.refresh(true)
    assert.strictEqual(dock.rows.length, 5, '历史 2 条 + 收藏 3 条')
    assert.strictEqual(dock.rows[0].kind, 'history')
    assert.strictEqual(dock.rows[0].name, 'git status')
    press(dock, 'ArrowDown')
    press(dock, 'Enter')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.strictEqual(api.calls.text[0].text, 'git status')
})

test('清空历史', () => {
    const api = makeApi(commands)
    api.config.store.qc.dock.history = [{ text: 'a', count: 1 }, { text: 'b', count: 1 }]
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.clearHistory()
    assert.deepStrictEqual(api.config.store.qc.dock.history, [])
    assert.strictEqual(api.calls.dirty, 1)
})

console.log('整理角标与恢复')

test('待整理角标：不在收藏里的历史才计数，并显示在按钮上', () => {
    const api = makeApi(commands)
    api.config.store.qc.dock.history = [
        { text: 'docker ps -a', count: 2 },   // 已在收藏
        { text: 'tail -f app.log', count: 1 }, // 未收藏
        { text: 'htop', count: 3 },
    ]
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.refresh(true)
    assert.strictEqual(dock.organizerPending, 2)
    assert.strictEqual(dock.organizerBadge.hidden, false)
    assert.strictEqual(dock.organizerBadge.textContent, '2')
})

test('历史全部进收藏后角标隐藏', () => {
    const api = makeApi(commands)
    api.config.store.qc.dock.history = [{ text: 'docker ps -a', count: 1 }]
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.refresh(true)
    assert.strictEqual(dock.organizerPending, 0)
    assert.strictEqual(dock.organizerBadge.hidden, true)
})

test('整理按钮点击交给上层；丢弃后可恢复', () => {
    const api = makeApi(commands)
    api.config.store.qc.dock.history = [{ text: 'tail -f app.log', count: 3 }]
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))

    dock.organizerButton.dispatch('click', {})
    assert.strictEqual(api.calls.organizer, 1)

    dock.removeHistoryText('tail -f app.log')
    assert.deepStrictEqual(api.config.store.qc.dock.history, [])

    dock.restoreHistoryText({ text: 'tail -f app.log', count: 3 })
    const restored = api.config.store.qc.dock.history
    assert.strictEqual(restored.length, 1)
    assert.strictEqual(restored[0].text, 'tail -f app.log')
    assert.strictEqual(restored[0].count, 3, '恢复时保留使用次数')
})

test('密码防护：终端正等密码时不记录（命令照常发送）', async () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))

    // 没有终端/缓冲区时放行
    assert.strictEqual(dock.recentOutputAsksForSecret(), false)

    // 伪造 xterm 缓冲区：光标行是 OpenSSH 密码提示
    const line = text => ({ translateToString: () => text })
    api.executor.activeTerminal = () => ({
        frontend: {
            xterm: {
                buffer: {
                    active: {
                        viewportY: 10,
                        cursorY: 5,
                        getLine: absoluteY => line(absoluteY === 15 ? "root@host's password: " : '$ ls'),
                    },
                },
            },
        },
    })
    assert.strictEqual(dock.recentOutputAsksForSecret(), true)

    dock.input.value = 'S3cret!'
    dock.refresh(true)
    press(dock, 'Enter')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.strictEqual(api.calls.text.length, 1, '命令照常发送')
    assert.deepStrictEqual(api.config.store.qc.dock.history, [], '但不入历史')

    // 密码提示不在光标附近时恢复记录
    api.executor.activeTerminal = () => ({
        frontend: {
            xterm: {
                buffer: {
                    active: {
                        viewportY: 10,
                        cursorY: 5,
                        getLine: () => line('$ ls'),
                    },
                },
            },
        },
    })
    assert.strictEqual(dock.recentOutputAsksForSecret(), false)
    dock.input.value = 'docker ps'
    dock.refresh(true)
    press(dock, 'Enter')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.strictEqual(api.config.store.qc.dock.history.length, 1)
})

test('收起的 ⌄ 按钮把开关交给上层', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.collapseButton.dispatch('click', {})
    assert.deepStrictEqual(api.calls.enabled, [false])
})

test('＋ 按钮把输入内容交给"保存为命令"', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.input.value = 'journalctl -xe'
    dock.saveButton.dispatch('click', {})
    assert.deepStrictEqual(api.calls.saved, ['journalctl -xe'])
})

test('☰ 按钮打开管理器', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.managerButton.dispatch('click', {})
    assert.strictEqual(api.calls.manager, 1)
})

test('Ctrl+S 存为新命令', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.input.value = 'df -h'
    press(dock, 's', { ctrlKey: true })
    assert.deepStrictEqual(api.calls.saved, ['df -h'])
})

test('detach 把元素从宿主里摘掉', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    const host = new FakeElement('tabby-terminal')
    dock.attach(host)
    dock.detach()
    assert.strictEqual(host.children.length, 0)
    assert.strictEqual(dock.attachedHost, null)
})

test('sync 在状态未变时不重绘（心跳零开销）', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.value = 'docker'
    dock.refresh(true)
    const firstRender = dock.list.children
    dock.sync()
    dock.sync()
    assert.strictEqual(dock.list.children, firstRender, 'DOM 节点应保持同一批')
})

test('命令改名后 sync 会重绘', () => {
    const local = commands.map(x => ({ ...x }))
    const api = makeApi(local)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.value = 'docker'
    dock.refresh(true)
    const firstRender = dock.list.children
    local[0].name = '查看 Docker 容器（改名）'
    api.store.revision++
    dock.sync()
    assert.notStrictEqual(dock.list.children, firstRender)
    assert.ok(dock.list.children[0].children[0].textContent.includes('改名'))
})

test('打字（80ms 防抖后）自动打开建议列表', async () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.focus()
    dock.hideList()
    dock.input.value = 'docker'
    dock.input.dispatch('input', {})
    assert.strictEqual(dock.listVisible, false, '防抖期间先不开')
    await new Promise(resolve => setTimeout(resolve, 140))
    assert.strictEqual(dock.listVisible, true, '防抖结束后应打开')
    assert.ok(dock.list.children.length >= 1)
})

test('点终端内容区才关列表；点输入条内部或无关 UI 都不关', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.focus()
    dock.input.value = 'docker'
    dock.refresh(true)
    dock.openList('test')

    // 点输入条内部（比如分组下拉）→ 保持打开
    document.dispatch('mousedown', { target: dock.groupSelect })
    assert.strictEqual(dock.listVisible, true)

    // 点跟终端无关的地方（工具栏之类）→ 也保持打开（旧规则会误关，看起来就是闪）
    document.dispatch('mousedown', { target: new FakeElement('div') })
    assert.strictEqual(dock.listVisible, true)

    // 明确点在终端内容区 → 收起，把位置让给终端
    const content = new FakeElement('div')
    content.className = 'content'
    const canvas = new FakeElement('canvas')
    content.appendChild(canvas)
    document.dispatch('mousedown', { target: canvas })
    assert.strictEqual(dock.listVisible, false)
})

test('列表开了很快就关会打印自诊断警告（便于定位"闪"）', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    const warnings = []
    const original = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    try {
        dock.openList('test-open')
        dock.hideList('test-close')
    } finally {
        console.warn = original
    }
    assert.strictEqual(warnings.length, 1)
    assert.ok(warnings[0].includes('test-open'), warnings[0])
    assert.ok(warnings[0].includes('test-close'), warnings[0])
})

test('失焦时列表不关，也不自动抢回焦点（1.3.0 起的规则）', async () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.focus()
    dock.input.value = 'docker'
    dock.refresh(true)
    dock.openList('test')
    dock.lastMouseDownTime = 0

    dock.input.blur()                     // 模拟 Tabby 终端 frontend.focus()
    assert.strictEqual(dock.listVisible, true, '列表不该被关掉')
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.strictEqual(dock.listVisible, true, '列表不该被关掉')
    assert.strictEqual(dock.isFocused(), false, '失焦本身不触发抢焦点；恢复走 emitFocused 补焦路径')
})

test('用户主动点击终端时不抢焦点（尊重用户）', async () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.focus()
    dock.input.value = 'docker'
    dock.refresh(true)
    dock.openList('test')

    const content = new FakeElement('div')
    content.className = 'content'
    document.dispatch('mousedown', { target: content })
    dock.input.blur()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.strictEqual(dock.listVisible, false)
    assert.strictEqual(dock.isFocused(), false, '不该把焦点抢回来')
})

test('切换分组后列表保持打开', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.focus()
    dock.input.value = 'docker'
    dock.refresh(true)
    dock.openList()

    dock.groupSelect.value = '20_Docker'
    dock.groupSelect.dispatch('change', {})
    assert.strictEqual(dock.group, '20_Docker')
    assert.strictEqual(dock.listVisible, true, '换分组不该把列表闪掉')
})

test('分组下拉正开着时不去动它的 options', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    const before = dock.groupSelect.options
    dock.groupSelect.focus()
    assert.strictEqual(dock.rebuildGroups(), false)
    assert.strictEqual(dock.groupSelect.options, before)
})

test('Esc 清空输入但保持列表；再按一次才回到终端', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.input.focus()
    dock.input.value = 'docker'
    dock.refresh(true)
    dock.openList()

    press(dock, 'Escape')
    assert.strictEqual(dock.input.value, '')
    assert.strictEqual(dock.listVisible, true, '第一次 Esc 只清空')

    press(dock, 'Escape')
    assert.strictEqual(dock.listVisible, false)
    assert.strictEqual(api.calls.focusedTerminal, 1)
})

test('缺少 dock 配置时使用默认值', () => {
    const api = makeApi(commands)
    api.config.store.qc = {}
    const dock = makeDock(api)
    const settings = dock.settings()
    assert.strictEqual(settings.enabled, true)
    assert.strictEqual(settings.maxSuggestions, 10)
    assert.strictEqual(settings.historySize, 500, '1.4.0 起默认 500')
    assert.strictEqual(settings.terminator, '\r')
})

// ------------------------------------------------------------------ 配色
const { parseColor } = require('../dist/dock')

function luminance (value) {
    const color = parseColor(value)
    assert.ok(color, `颜色解析失败: ${value}`)
    return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255
}

function assertReadable (dock, label) {
    const bg = dock.el.style.getPropertyValue('--qcl-bg')
    const fg = dock.el.style.getPropertyValue('--qcl-fg')
    const contrast = Math.abs(luminance(bg) - luminance(fg))
    assert.ok(contrast > 0.35, `${label}: 前景背景对比度太低 (${bg} vs ${fg}, ${contrast.toFixed(2)})`)
    return { bg, fg }
}

test('深色主题：用主题变量，字看得清', () => {
    global.__themeVars = {
        '--theme-bg': '#171717',
        '--theme-fg': '#cacaca',
        '--theme-fg-less': '#8a8a8a',
        '--theme-bg-more': '#242424',
        '--theme-bg-more-2': '#313131',
    }
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    const { bg } = assertReadable(dock, '深色主题')
    assert.ok(luminance(bg) < 0.5, '背景应该是深色')
})

test('浅色主题：用主题变量，字看得清（就是之前看不清的场景）', () => {
    global.__themeVars = {
        '--theme-bg': '#ffffff',
        '--theme-fg': '#262626',
        '--theme-fg-less': '#6b6b6b',
        '--theme-bg-more': '#f2f2f2',
        '--theme-bg-more-2': '#e6e6e6',
    }
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    const { bg, fg } = assertReadable(dock, '浅色主题')
    assert.ok(luminance(bg) > 0.5, '背景应该是浅色')
    assert.ok(luminance(fg) < 0.5, '文字应该是深色')
})

test('没有主题变量时：按终端底色算对比色', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    // 假 DOM 里取不到底色 -> 兜底成深色面板
    assertReadable(dock, '兜底配色')
})

test('主题背景半透明（vibrancy）时压成不透明，避免终端文字透上来', () => {
    global.__themeVars = {
        '--theme-bg': 'rgba(23, 23, 23, 0.4)',
        '--theme-fg': '#cacaca',
        '--theme-bg-more': 'rgba(36, 36, 36, 0.4)',
    }
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    const bg = dock.el.style.getPropertyValue('--qcl-bg')
    assert.ok(!bg.includes('rgba'), `背景应被压成不透明: ${bg}`)
    assert.strictEqual(parseColor(bg).a, 1)
    assertReadable(dock, 'vibrancy')
})

// ------------------------------------------------ 回归：部署时丢过方法
// 1.1.4 曾经把整段"动作"方法弄丢，装进 Tabby 后回车 / Esc / Ctrl+S 全部
//    报 "is not a function"。这里把键盘与按钮调用到的方法逐个断言一遍，
//    任何一次漏部署都会立刻失败。
test('API 表面完整：键盘与按钮用到的方法都存在', () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    const required = [
        'runSelected', 'runInput', 'afterRun', 'fillSelected', 'escape',
        'saveInputAsCommand', 'focusInput', 'openList', 'hideList',
        'scheduleFocusRetry', 'restoreFocus', 'moveSelection', 'refresh',
        'renderRows', 'updateSelection', 'sync', 'attach', 'detach', 'destroy',
        'updateOrganizerBadge', 'removeHistoryText', 'restoreHistoryText',
        'recentOutputAsksForSecret',
    ]
    const missing = required.filter(name => typeof dock[name] !== 'function')
    assert.deepStrictEqual(missing, [], `缺少方法: ${missing.join(', ')}`)
})

test('焦点被终端抢走后交还输入框', async () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.focusInput()
    assert.ok(dock.listVisible)
    // 模拟 Tabby 的 frontend.focus()：把焦点抢到终端
    new FakeElement('div').focus()
    assert.ok(!dock.isFocused(), '焦点已被终端抢走')
    dock.restoreFocus()
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(dock.isFocused(), '焦点应被交还输入框')
})

test('刚点过鼠标（用户主动点终端）时不抢回焦点', async () => {
    const api = makeApi(commands)
    const dock = makeDock(api)
    dock.attach(new FakeElement('tabby-terminal'))
    dock.focusInput()
    global.document.dispatch('mousedown', { target: new FakeElement('div') })
    new FakeElement('div').focus()
    dock.restoreFocus()
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(!dock.isFocused(), '用户刚点过鼠标，不该把焦点抢回来')
})

runAsyncTests().then(() => {
    console.log('')
    console.log(`通过 ${passed} 项，失败 ${failures.length} 项`)
    if (failures.length) {
        for (const failure of failures) {
            console.log(`\n${failure.name}:\n${failure.error.stack}`)
        }
        process.exit(1)
    }
    process.exit(0)
})
