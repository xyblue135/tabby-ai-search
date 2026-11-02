'use strict'

/* eslint-disable no-console */

/**
 * 端到端（离线）冒烟测试：
 * 用替身模块冒充 @angular/*、tabby-core/settings/terminal 加载真实的 dist/index.js，
 * 然后手工实例化各个服务与组件，验证：
 *   - 数据层读写 qc.cmds
 *   - 执行层把正确的字节写进终端（多行整段、终止符、split tab 解包）
 *   - 底部输入条按当前活动终端停靠 / 跟随 / 收起
 *   - 管理器、整理记忆与设置页的交互
 */

const assert = require('assert')
const path = require('path')
const Module = require('module')

const { install } = require('./fake-dom')
const { FakeElement } = install()

// ------------------------------------------------------------ 模块替身
const stubDir = path.join(__dirname, 'stubs')
const MAP = {
    '@angular/core': 'angular-core.js',
    '@angular/common': 'angular-common.js',
    '@angular/forms': 'angular-forms.js',
    '@ng-bootstrap/ng-bootstrap': 'ng-bootstrap.js',
    'tabby-core': 'tabby-core.js',
    'tabby-settings': 'tabby-settings.js',
    'tabby-terminal': 'tabby-terminal.js',
}
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
    if (MAP[request]) {
        return path.join(stubDir, MAP[request])
    }
    return originalResolve.call(this, request, ...rest)
}

const pluginModule = require('../dist/index.js')
const core = require('tabby-core')
const terminal = require('tabby-terminal')
const bootstrap = require('@ng-bootstrap/ng-bootstrap')
const {
    CommandStoreService,
    CommandExecutorService,
    QuickCmdsLiteDockService,
    QuickCmdsLiteModalComponent,
    QuickCmdsLiteOrganizerComponent,
    QuickCmdsLiteSettingsTabComponent,
    QuickCmdsLiteSettingsTabProvider,
    QuickCmdsLiteConfigProvider,
    QuickCmdsLiteHotkeyProvider,
    QuickCmdsLiteButtonProvider,
} = pluginModule.__internals

const COMMANDS = [
    { id: 'a', name: '查看 Docker 容器', group: '20_Docker', text: 'docker ps -a', appendCR: true },
    { id: 'b', name: 'performance模式', group: '10_系统', text: 'for i in 1 2; do\n\techo $i\ndone', appendCR: true },
    { id: 'c', name: '看温度', group: '10_系统', text: 'watch sensors', appendCR: true },
    { id: 'd', name: '备忘', group: '', text: '', appendCR: true },
]

let passed = 0
const failures = []
function test (name, fn) {
    try {
        const result = fn()
        if (result && typeof result.then === 'function') {
            result.then(() => {
                passed++
                console.log(`  ok  ${name}`)
            }, error => {
                failures.push({ name, error })
                console.log(`FAIL  ${name}\n      ${error.message}`)
            })
            return
        }
        passed++
        console.log(`  ok  ${name}`)
    } catch (error) {
        failures.push({ name, error })
        console.log(`FAIL  ${name}\n      ${error.message}`)
    }
}

function fixtures (options) {
    const pendingConfig = !!(options && options.pendingConfig)
    const config = new core.ConfigService()
    if (!pendingConfig) {
        config.store = {
            qc: {
                cmds: COMMANDS.map(x => ({ ...x })),
                groups: [],
                // 真实运行时 ConfigProvider 的默认值会保证 qc.dock 存在
                dock: { enabled: true, history: [] },
            },
        }
        config.ready.next(true)
        config.ready.complete()
    }
    const app = new core.AppService()
    const notifications = new core.NotificationsService()
    const hotkeys = new core.HotkeysService()
    const modal = new bootstrap.NgbModal()
    const zone = { run: fn => fn(), runOutsideAngular: fn => fn() }
    const platform = new core.PlatformService()
    const store = new CommandStoreService(config)
    const executor = new CommandExecutorService(app, config, notifications)
    const dockService = new QuickCmdsLiteDockService(app, config, store, executor, modal, notifications, zone, platform)
    const makeTerminal = () => {
        const tab = new terminal.BaseTerminalTabComponent()
        tab.hostView = { rootNodes: [new FakeElement('tabby-terminal')] }
        return tab
    }
    return { config, app, notifications, hotkeys, modal, zone, platform, store, executor, dockService, makeTerminal }
}

console.log('数据层')

test('读取旧 qc.cmds，统计数量与分组', () => {
    const { store, config } = fixtures()
    store.initialize()
    assert.strictEqual(store.count(), 4)
    assert.deepStrictEqual(store.groups(), ['10_系统', '20_Docker'])
    assert.strictEqual(store.hasUngrouped(), true)
    assert.strictEqual(config.saved, 0, 'id 都齐全时不应该写配置')
})

test('缺少 id 的命令会被补 id 并落盘一次', () => {
    const { store, config } = fixtures()
    config.store.qc.cmds.push({ name: '新命令', text: 'ls', group: '', appendCR: true })
    store.initialize()
    assert.strictEqual(typeof config.store.qc.cmds[4].id, 'string')
    assert.strictEqual(config.saved, 1)
})

test('favoriteTexts 返回收藏正文集合（整理页判定用）', () => {
    const { store } = fixtures()
    store.initialize()
    const texts = store.favoriteTexts()
    assert.ok(texts instanceof Set)
    assert.ok(texts.has('docker ps -a'))
    assert.strictEqual(texts.size, 3, '备忘命令正文为空，去重后不计入')
})

test('搜索支持多关键词 / 分组 / 未分组', () => {
    const { store } = fixtures()
    store.initialize()
    assert.strictEqual(store.search('docker', null, 10, true).total, 1)
    assert.strictEqual(store.search('系统 echo', null, 10, true).total, 1)
    assert.strictEqual(store.search('', '10_系统', 10, false).total, 2)
    assert.strictEqual(store.search('', '', 10, false).total, 1)
})

test('upsert / remove 会重建索引并保存', () => {
    const { store, config } = fixtures()
    store.initialize()
    const created = store.upsert({ name: '新命令', text: 'ls -al', group: '  临时  ', appendCR: false })
    assert.strictEqual(created.group, '临时')
    assert.strictEqual(config.saved, 1)
    assert.strictEqual(store.search('临时', null, 10, false).total, 1)

    store.remove(created)
    assert.strictEqual(store.count(), 4)
    assert.strictEqual(config.saved, 2)
})

console.log('执行层')

test('split tab 里取到聚焦的终端', () => {
    const { executor, app, makeTerminal } = fixtures()
    const tab = makeTerminal()
    assert.strictEqual(executor.resolveTerminal(tab), tab)

    const split = new core.SplitTabComponent(tab)
    assert.strictEqual(executor.resolveTerminal(split), tab)

    assert.strictEqual(executor.resolveTerminal({ title: '设置页' }), null)
    assert.strictEqual(executor.resolveTerminal(null), null)

    app.activeTab = split
    assert.strictEqual(executor.activeTerminal(), tab)
})

test('执行收藏命令：全局自动回车开启时写入的字节带 CR', () => {
    const { executor, app, makeTerminal, config } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    config.store.qc.autoReturn = true
    return executor.send(COMMANDS[0]).then(ok => {
        assert.strictEqual(ok, true)
        assert.deepStrictEqual(tab.inputs, ['docker ps -a\r'])
    })
})

test('执行收藏命令：默认不自动回车', () => {
    const { executor, app, makeTerminal } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    return executor.send(COMMANDS[0]).then(ok => {
        assert.strictEqual(ok, true)
        assert.deepStrictEqual(tab.inputs, ['docker ps -a'])
    })
})

test('多行 for 循环整段发送，行首缩进被去掉', () => {
    const { executor, app, makeTerminal, config } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    config.store.qc.autoReturn = true
    return executor.send(COMMANDS[1]).then(() => {
        assert.strictEqual(tab.inputs.length, 1, '应该只发一次')
        assert.strictEqual(tab.inputs[0], 'for i in 1 2; do\recho $i\rdone\r')
    })
})

test('发送文本：默认不加回车，多行原样整段', () => {
    const { executor, app, makeTerminal } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    return executor.sendText('echo 1\necho 2').then(() => {
        assert.deepStrictEqual(tab.inputs, ['echo 1\necho 2'])
    })
})

test('发送文本：全局自动回车开启时补终止符', () => {
    const { executor, app, makeTerminal, config } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    config.store.qc.autoReturn = true
    return executor.sendText('git status').then(() => {
        assert.deepStrictEqual(tab.inputs, ['git status\r'])
    })
})

test('没有终端时给出提示且不抛错', async () => {
    const { executor, notifications } = fixtures()
    const ok = await executor.sendText('ls', true)
    assert.strictEqual(ok, false)
    assert.strictEqual(notifications.notices.length, 1)
})

test('终端报错时捕获并提示', async () => {
    const { executor, app, makeTerminal, notifications } = fixtures()
    const tab = makeTerminal()
    tab.sendInput = () => {
        throw new Error('session closed')
    }
    app.activeTab = tab
    const ok = await executor.sendText('ls', true)
    assert.strictEqual(ok, false)
    assert.strictEqual(notifications.errors.length, 1)
})

test('支持 CRLF / LF 设置（需全局自动回车）', async () => {
    const { executor, config, app, makeTerminal } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    config.store.qc.autoReturn = true
    config.store.qc.dock = { terminator: 'lf' }
    await executor.sendText('ls')
    assert.deepStrictEqual(tab.inputs, ['ls\n'])

    tab.inputs = []
    config.store.qc.dock.terminator = 'crlf'
    await executor.sendText('ls')
    assert.deepStrictEqual(tab.inputs, ['ls\r\n'])
})

console.log('底部输入条')

test('start() 把输入条停靠到当前终端下方', () => {
    const { dockService, app, makeTerminal, config } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    dockService.start()
    const host = tab.hostView.rootNodes[0]
    assert.strictEqual(host.children.length, 1)
    assert.ok(host.children[0].className.includes('qcl-dock'))
    assert.strictEqual(dockService.dock.attachedHost, host)

    // 再次 start 不应重复订阅
    dockService.start()
    assert.strictEqual(host.children.length, 1)
})

test('切换到非终端标签时摘掉输入条', () => {
    const { dockService, app, makeTerminal } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    dockService.start()
    const host = tab.hostView.rootNodes[0]

    app.activeTab = { title: '设置' }
    dockService.reconcileNow()
    assert.strictEqual(host.children.length, 0)
    assert.strictEqual(dockService.dock.attachedHost, null)
})

test('切换标签时输入条跟着搬过去', () => {
    const { dockService, app, makeTerminal } = fixtures()
    const first = makeTerminal()
    const second = makeTerminal()
    app.activeTab = first
    dockService.start()
    app.activeTab = second
    dockService.reconcileNow()
    assert.strictEqual(first.hostView.rootNodes[0].children.length, 0)
    assert.strictEqual(second.hostView.rootNodes[0].children.length, 1)
})

test('split tab 里跟随聚焦面板', () => {
    const { dockService, app, makeTerminal } = fixtures()
    const left = makeTerminal()
    const right = makeTerminal()
    const split = new core.SplitTabComponent(left)
    app.activeTab = split
    dockService.start()
    assert.strictEqual(left.hostView.rootNodes[0].children.length, 1)

    split.focused = right
    split.focusChanged.next(right)
    assert.strictEqual(left.hostView.rootNodes[0].children.length, 0)
    assert.strictEqual(right.hostView.rootNodes[0].children.length, 1)
})

test('focusDockInput 聚焦输入框；收起时写配置', () => {
    const { dockService, app, makeTerminal, config, notifications } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    dockService.start()
    dockService.focusDockInput()
    assert.strictEqual(global.document.activeElement, dockService.dock.input)

    dockService.setEnabled(false)
    assert.strictEqual(config.store.qc.dock.enabled, false)
    assert.strictEqual(config.saved, 1)
    assert.strictEqual(tab.hostView.rootNodes[0].children.length, 0)
    assert.ok(notifications.notices.length >= 1)

    dockService.focusDockInput()
    assert.strictEqual(config.store.qc.dock.enabled, true)
    assert.strictEqual(tab.hostView.rootNodes[0].children.length, 1)
})

test('dock 里回车会把命令发到终端（端到端）', async () => {
    const { dockService, app, makeTerminal, config } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    config.store.qc.autoReturn = true
    dockService.start()
    dockService.dock.input.value = 'docker'
    dockService.dock.refresh(true)
    dockService.dock.onKeyDown({ key: 'ArrowDown', preventDefault: () => null, stopPropagation: () => null })
    dockService.dock.onKeyDown({ key: 'Enter', preventDefault: () => null, stopPropagation: () => null })
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.deepStrictEqual(tab.inputs, ['docker ps -a\r'])
})

test('终端 emitFocused 照常发出，且不会把输入框焦点吞掉', async () => {
    const { dockService, app, makeTerminal } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    dockService.start()
    dockService.focusDockInput()
    assert.ok(dockService.dock.listVisible)

    const before = tab.focusedEmitted
    tab.emitFocused()
    assert.strictEqual(tab.focusedEmitted, before + 1, 'emitFocused 必须真的发出去（不能被拦截）')

    // Tabby 紧接着会同步抢焦点，这里模拟一下
    new FakeElement('div').focus()
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.strictEqual(global.document.activeElement, dockService.dock.input, '焦点应还给输入框')
})

test('列表已收起（用户点了终端）时 emitFocused 不抢焦点', async () => {
    const { dockService, app, makeTerminal } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    dockService.start()
    dockService.focusDockInput()
    dockService.dock.hideList('test')
    tab.emitFocused()
    new FakeElement('div').focus()
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.notStrictEqual(global.document.activeElement, dockService.dock.input, '不该抢回输入框焦点')
})

test('markDirty 合并落盘（不是同步写）', () => {
    const { dockService, app, makeTerminal, config } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    dockService.start()
    const before = config.saved
    dockService.markDirty()
    dockService.markDirty()
    assert.strictEqual(config.saved, before, '应该延迟到 2 秒后')
})

test('clearHistory 清空 qc.dock.history', () => {
    const { dockService, app, makeTerminal, config } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    dockService.start()
    config.store.qc.dock.history = [{ text: 'a', count: 1 }, { text: 'b', count: 1 }]
    dockService.clearHistory()
    assert.deepStrictEqual(config.store.qc.dock.history, [])
})

test('历史记忆：discard / restore（走已挂载的输入条）', () => {
    const { dockService, app, makeTerminal, config } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    dockService.start()
    config.store.qc.dock.history = [{ text: 'tail -f app.log', count: 4 }]

    dockService.discardHistory('tail -f app.log')
    assert.deepStrictEqual(config.store.qc.dock.history, [])

    dockService.restoreHistory({ text: 'tail -f app.log', count: 4 })
    const restored = config.store.qc.dock.history
    assert.strictEqual(restored.length, 1)
    assert.strictEqual(restored[0].text, 'tail -f app.log')
    assert.strictEqual(restored[0].count, 4)
})

test('历史记忆：输入条未挂载时也能整理（走配置直读）', () => {
    const { dockService, config } = fixtures()
    config.store.qc.dock.history = ['old-string-entry', { text: 'kept', count: 2 }]
    const entries = dockService.historyEntries()
    assert.strictEqual(entries.length, 2)
    assert.strictEqual(entries[0].text, 'old-string-entry', '字符串会被迁移成对象')

    dockService.discardHistory('old-string-entry')
    assert.deepStrictEqual(config.store.qc.dock.history.map(x => x.text), ['kept'])
    assert.ok(config.saved >= 1)

    dockService.restoreHistory({ text: 'old-string-entry', count: 1 })
    assert.strictEqual(config.store.qc.dock.history.length, 2)
    assert.strictEqual(config.store.qc.dock.history[0].text, 'old-string-entry')
})

console.log('整理记忆组件')

function makeOrganizer ({ history, dockMounted } = {}) {
    const { config, store, dockService } = fixtures()
    config.store.qc.dock.history = history || []
    if (!dockMounted) {
        dockService.dock = null
    }
    const calls = { saved: [], discarded: [], restored: [] }
    const organizer = new QuickCmdsLiteOrganizerComponent(
        new bootstrap.NgbActiveModal(),
        store,
        {
            historyEntries: () => dockService.historyEntries(),
            saveAsCommand: text => calls.saved.push(text),
            discardHistory: text => {
                calls.discarded.push(text)
                config.store.qc.dock.history = config.store.qc.dock.history.filter(item => item.text !== text)
            },
            restoreHistory: entry => {
                calls.restored.push(entry)
                config.store.qc.dock.history = [{ text: entry.text, count: entry.count, ts: entry.ts }]
                    .concat(config.store.qc.dock.history.filter(item => item.text !== entry.text))
            },
            clearHistory: () => { config.store.qc.dock.history = [] },
        },
        config,
        { markForCheck: () => null },
    )
    return { config, store, organizer, calls }
}

test('整理页：只列不在收藏里的历史，带次数与相对时间', () => {
    const { organizer } = makeOrganizer({
        history: [
            { text: 'docker ps -a', count: 2, ts: Date.now() - 30000 },  // 已在收藏
            { text: 'tail -f app.log', count: 3, ts: Date.now() - 120000 },
        ],
    })
    organizer.ngOnInit()
    assert.strictEqual(organizer.pending.length, 1)
    assert.strictEqual(organizer.pending[0].text, 'tail -f app.log')
    assert.strictEqual(organizer.pending[0].count, 3)
    assert.strictEqual(organizer.pending[0].time, '2 分钟前')
})

test('整理页：过滤框多关键词过滤', () => {
    const { organizer } = makeOrganizer({
        history: [
            { text: 'docker logs -f app', count: 1 },
            { text: 'kubectl get pods', count: 1 },
            { text: 'tail -f app.log', count: 1 },
        ],
    })
    organizer.ngOnInit()
    assert.strictEqual(organizer.pending.length, 3)

    organizer.query = 'app log'
    organizer.onQueryChanged()
    assert.deepStrictEqual(organizer.pending.map(x => x.text).sort(), ['docker logs -f app', 'tail -f app.log'], '两个关键词都要命中')

    organizer.query = 'pods'
    organizer.onQueryChanged()
    assert.deepStrictEqual(organizer.pending.map(x => x.text), ['kubectl get pods'])

    organizer.query = 'docker pods'
    organizer.onQueryChanged()
    assert.strictEqual(organizer.pending.length, 0)
})

test('整理页：丢弃后出现撤销条，撤销把条目放回', () => {
    const { organizer, calls } = makeOrganizer({ history: [{ text: 'htop', count: 2 }] })
    organizer.ngOnInit()
    assert.strictEqual(organizer.pending.length, 1)

    organizer.discard(organizer.pending[0])
    assert.deepStrictEqual(calls.discarded, ['htop'])
    assert.ok(organizer.lastDiscarded, '丢弃后应有撤销条')
    assert.strictEqual(organizer.pending.length, 0)

    organizer.undoDiscard()
    assert.deepStrictEqual(calls.restored.map(x => x.text), ['htop'])
    assert.strictEqual(organizer.lastDiscarded, null)
})

test('整理页：存为收藏走编辑页（保存后靠 changed$ 自动消失）', () => {
    const { organizer, calls } = makeOrganizer({ history: [{ text: 'df -h', count: 1 }] })
    organizer.ngOnInit()
    organizer.save(organizer.pending[0])
    assert.deepStrictEqual(calls.saved, ['df -h'])
})

test('整理页：旧字符串历史也能整理', () => {
    const { organizer } = makeOrganizer({ history: ['legacy-entry'] })
    organizer.ngOnInit()
    assert.strictEqual(organizer.pending.length, 1)
    assert.strictEqual(organizer.pending[0].text, 'legacy-entry')
    assert.strictEqual(organizer.pending[0].count, 1)
})

test('整理页：close 后不再有撤销定时器', () => {
    const { organizer } = makeOrganizer({ history: [{ text: 'x', count: 1 }] })
    organizer.ngOnInit()
    organizer.discard(organizer.pending[0])
    organizer.close()
    organizer.ngOnDestroy()
    assert.strictEqual(organizer.undoTimer, null)
})

console.log('快捷键 / 工具栏')

test('配置未加载完时快捷键 / 工具栏按钮不会炸', () => {
    const { config, dockService, hotkeys, notifications, store, executor, modal, app, zone } = fixtures({ pendingConfig: true })
    const provider = new QuickCmdsLiteButtonProvider(hotkeys, dockService)
    assert.strictEqual(provider.provide().length, 2)
    assert.doesNotThrow(() => hotkeys.emit('qc'))
    assert.doesNotThrow(() => hotkeys.emit('qc-manager'))
    assert.strictEqual(modal.opened.length, 1)
    assert.ok(notifications.notices.some(text => text.includes('配置')))
    // 管理器即便此时打开也不能炸
    const component = new QuickCmdsLiteModalComponent(new bootstrap.NgbActiveModal(), store, app, dockService, { markForCheck: () => null })
    assert.doesNotThrow(() => component.ngOnInit())
    assert.strictEqual(component.total, 0)
})

test('Alt+Q 聚焦输入条，Alt+Shift+Q 打开管理器', () => {
    const { dockService, app, makeTerminal, hotkeys, modal } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    const provider = new QuickCmdsLiteButtonProvider(hotkeys, dockService)

    const buttons = provider.provide()
    assert.strictEqual(buttons.length, 2)
    assert.ok(buttons[0].icon.includes('<svg'))
    assert.strictEqual(typeof buttons[0].click, 'function')

    hotkeys.emit('qc')
    assert.strictEqual(global.document.activeElement, dockService.dock.input)

    hotkeys.emit('qc-manager')
    assert.strictEqual(modal.opened.length, 1)
})

test('工具栏按钮：切换输入条 / 打开管理器', () => {
    const { dockService, app, makeTerminal, hotkeys, modal, config } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    const provider = new QuickCmdsLiteButtonProvider(hotkeys, dockService)
    const buttons = provider.provide()

    buttons[0].click()
    assert.strictEqual(config.store.qc.dock.enabled, false)
    buttons[0].click()
    assert.strictEqual(config.store.qc.dock.enabled, true)
    buttons[1].click()
    assert.strictEqual(modal.opened.length, 1)
})

test('快捷键与配置默认值已注册', async () => {
    const hotkeyProvider = new QuickCmdsLiteHotkeyProvider()
    const descriptions = await hotkeyProvider.provide()
    assert.deepStrictEqual(descriptions.map(x => x.id), ['qc', 'qc-manager'])

    const configProvider = new QuickCmdsLiteConfigProvider()
    assert.strictEqual(configProvider.defaults.qc.dock.enabled, true)
    assert.strictEqual(configProvider.defaults.qc.dock.terminator, 'cr')
    assert.strictEqual(configProvider.defaults.qc.dock.maxSuggestions, 10)
    assert.strictEqual(configProvider.defaults.qc.dock.historySize, 500, '1.4.0 起默认 500')
    assert.deepStrictEqual(configProvider.defaults.hotkeys.qc, ['Alt-Q'])
    assert.deepStrictEqual(configProvider.defaults.hotkeys['qc-manager'], ['Alt-Shift-Q'])
})

test('设置页 provider 指向设置组件', () => {
    const provider = new QuickCmdsLiteSettingsTabProvider()
    assert.strictEqual(provider.id, 'qc-lite')
    assert.strictEqual(provider.getComponentType(), QuickCmdsLiteSettingsTabComponent)
})

console.log('管理器 / 设置页')

test('管理器没有发送入口（1.3.0 起只编辑）', () => {
    const { store, app } = fixtures()
    const component = new QuickCmdsLiteModalComponent(new bootstrap.NgbActiveModal(), store, app, { refreshDock: () => null }, { markForCheck: () => null })
    component.ngOnInit()
    assert.ok(typeof component.run !== 'function', 'run 不应存在')
})

test('管理器：搜索 / 分组 / 保存校验', () => {
    const { store, app } = fixtures()
    const component = new QuickCmdsLiteModalComponent(new bootstrap.NgbActiveModal(), store, app, { refreshDock: () => null }, { markForCheck: () => null })
    component.ngOnInit()
    assert.strictEqual(component.total, 4)

    component.query = 'docker'
    component.refresh()
    assert.strictEqual(component.results.length, 1)

    component.query = ''
    component.selectGroup('10_系统')
    assert.strictEqual(component.total, 2)
    component.selectGroup(null)

    component.newCommand()
    assert.strictEqual(component.editing, true)
    assert.strictEqual(component.canSave(), false)
    component.draft.name = '  临时命令  '
    component.draft.text = ''
    assert.strictEqual(component.canSave(), true, '内容允许为空（旧版有这种备忘命令）')
    component.saveDraft()
    assert.strictEqual(component.editing, false)
    assert.strictEqual(store.search('临时命令', null, 5, false).total, 1)
})

test('管理器：startNewWithText 带着输入条内容新建', () => {
    const { store, app } = fixtures()
    const component = new QuickCmdsLiteModalComponent(new bootstrap.NgbActiveModal(), store, app, { refreshDock: () => null }, { markForCheck: () => null })
    component.ngOnInit()
    component.startNewWithText('journalctl -xe')
    assert.strictEqual(component.editing, true)
    assert.strictEqual(component.draft.text, 'journalctl -xe')
})

test('管理器：增删改后通知输入条刷新', () => {
    const { store, app } = fixtures()
    let refreshed = 0
    const component = new QuickCmdsLiteModalComponent(new bootstrap.NgbActiveModal(), store, app, { refreshDock: () => refreshed++ }, { markForCheck: () => null })
    component.ngOnInit()
    component.newCommand()
    component.draft.name = 'x'
    component.draft.text = 'echo x'
    component.saveDraft()
    assert.strictEqual(refreshed, 1)
})

test('保存为命令：把输入条内容交给管理器', () => {
    const { dockService, app, makeTerminal, modal } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    dockService.start()
    dockService.dock.input.value = 'df -h'
    const captured = {}
    modal.nextInstance = { startNewWithText: text => { captured.text = text } }
    dockService.saveAsCommand('df -h')
    assert.strictEqual(captured.text, 'df -h')
})

test('设置页读写 qc.dock', () => {
    const { config, store, dockService, app, makeTerminal, zone } = fixtures()
    const tab = makeTerminal()
    app.activeTab = tab
    const component = new QuickCmdsLiteSettingsTabComponent(config, store, dockService, zone)
    component.ngOnInit()
    assert.strictEqual(component.count, 4)
    assert.strictEqual(component.groupCount, 2)
    assert.strictEqual(component.dockEnabled, true)

    component.dockEnabled = false
    component.maxSuggestions = 20
    component.historySize = 5
    component.terminator = 'lf'
    component.apply()
    assert.strictEqual(config.store.qc.dock.enabled, false)
    assert.strictEqual(config.store.qc.dock.maxSuggestions, 20)
    assert.strictEqual(config.store.qc.dock.historySize, 5)
    assert.strictEqual(config.store.qc.dock.terminator, 'lf')
    assert.ok(config.saved >= 1)
})

test('设置页：非数字输入回落到默认值', () => {
    const { config, store, dockService, zone } = fixtures()
    const component = new QuickCmdsLiteSettingsTabComponent(config, store, dockService, zone)
    component.ngOnInit()
    component.maxSuggestions = 'abc'
    component.historySize = -5
    component.apply()
    assert.strictEqual(config.store.qc.dock.maxSuggestions, 10)
    assert.strictEqual(config.store.qc.dock.historySize, 500)
})

test('设置页：AI 设置读写与测试连接的错误处理', async () => {
    const { config, store, dockService, zone } = fixtures()
    const component = new QuickCmdsLiteSettingsTabComponent(config, store, dockService, zone)
    component.ngOnInit()

    component.aiIncludeHistory = true
    component.aiCandidateLimit = 80
    component.saveAISettings()
    assert.strictEqual(config.store.qc.ai.includeHistory, true)
    assert.strictEqual(config.store.qc.ai.candidateLimit, 80)

    // 空 baseURL：应该走 reject 显示在状态栏，而不是抛未捕获异常
    component.aiBaseURL = ''
    await component.testAI()
    assert.ok(component.aiStatus.includes('连接失败'), component.aiStatus)
    assert.ok(component.aiStatus.includes('基础 URL 无效'), component.aiStatus)
})

test('配置未加载完时设置页也不会炸', () => {
    const { config, store, dockService, zone } = fixtures({ pendingConfig: true })
    const component = new QuickCmdsLiteSettingsTabComponent(config, store, dockService, zone)
    assert.doesNotThrow(() => component.ngOnInit())
    assert.strictEqual(component.count, 0)
    assert.strictEqual(component.groupCount, 0)
    assert.doesNotThrow(() => component.apply())
    assert.doesNotThrow(() => component.clearHistory())
    assert.doesNotThrow(() => component.openManager())
})

test('插件模块导出 NgModule 与离线测试入口', () => {
    assert.strictEqual(typeof pluginModule.default, 'function')
    assert.ok(pluginModule.__internals.CommandStoreService)
    assert.ok(pluginModule.__internals.QuickCmdsLiteOrganizerComponent, '整理组件应在测试入口里')
})

// 等所有 async 用例收尾（test() 里 then/catch 是异步记账的）
setTimeout(() => {
    console.log('')
    console.log(`通过 ${passed} 项，失败 ${failures.length} 项`)
    if (failures.length) {
        for (const failure of failures) {
            console.log(`\n${failure.name}:\n${failure.error.stack}`)
        }
        process.exit(1)
    }
    // DockService 的心跳定时器会挂住事件循环，这里显式退出
    process.exit(0)
}, 300)
