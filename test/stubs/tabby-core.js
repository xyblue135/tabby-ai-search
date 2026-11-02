'use strict'

/**
 * tabby-core / tabby-settings / tabby-terminal 的最小替身。
 * 这里定义的对象就是被测代码运行时拿到的"Tabby"，
 * 因此可以直接驱动：伪造 activeTab、发快捷键、检查写入终端的字节。
 */

class Subject {
    constructor () {
        this.handlers = []
    }

    subscribe (handler) {
        this.handlers.push(handler)
        return { unsubscribe: () => { this.handlers = this.handlers.filter(x => x !== handler) } }
    }

    next (value) {
        this.handlers.forEach(handler => handler(value))
    }
}

/** 模仿 rxjs AsyncSubject：complete 之后再订阅也能立刻拿到最后一个值 */
class AsyncSubject {
    constructor () {
        this.handlers = []
        this.completed = false
        this.value = undefined
    }

    subscribe (handler) {
        if (this.completed) {
            handler(this.value)
            return { unsubscribe: () => null }
        }
        this.handlers.push(handler)
        return { unsubscribe: () => { this.handlers = this.handlers.filter(x => x !== handler) } }
    }

    next (value) {
        this.value = value
    }

    complete () {
        this.completed = true
        const handlers = this.handlers
        this.handlers = []
        handlers.forEach(handler => handler(this.value))
    }

    toPromise () {
        if (this.completed) {
            return Promise.resolve(this.value)
        }
        return new Promise(resolve => { this.handlers.push(resolve) })
    }
}

class ConfigService {
    constructor () {
        // 真实 Tabby 里 load() 之前 store 就是 undefined，这里保持同样的时序
        this.store = undefined
        this.saved = 0
        this.changed = new Subject()
        this.changed$ = this.changed
        this.ready = new AsyncSubject()
        this.ready$ = this.ready
    }

    async save () {
        this.saved++
    }
}

class AppService {
    constructor () {
        this.tabs = []
        this.activeTab = null
        this.activeTabChange = new Subject()
        this.activeTabChange$ = this.activeTabChange
        this.tabOpened = new Subject()
        this.tabOpened$ = this.tabOpened
        this.tabClosed = new Subject()
        this.tabClosed$ = this.tabClosed
        this.tabRemoved = new Subject()
        this.tabRemoved$ = this.tabRemoved
        this.tabsChanged = new Subject()
        this.tabsChanged$ = this.tabsChanged
    }
}

class NotificationsService {
    constructor () {
        this.notices = []
        this.errors = []
    }

    notice (text) {
        this.notices.push(text)
    }

    info (text) {
        this.notices.push(text)
    }

    error (text, details) {
        this.errors.push({ text, details })
    }
}

class HotkeysService {
    constructor () {
        this.hotkey = new Subject()
        this.hotkey$ = this.hotkey
    }

    emit (id) {
        this.hotkey.next(id)
    }
}

class PlatformService {
    constructor () {
        this.themeChanged = new Subject()
        this.themeChanged$ = this.themeChanged
    }
}

class ConfigProvider {
    constructor () {
        this.defaults = {}
        this.platformDefaults = {}
    }
}

class ToolbarButtonProvider { }

class HotkeyProvider { }

class SplitTabComponent {
    constructor (focused) {
        this.focused = focused
        this.focusChanged = new Subject()
        this.focusChanged$ = this.focusChanged
    }

    getFocusedTab () {
        return this.focused
    }

    getAllTabs () {
        return this.focused ? [this.focused] : []
    }

    emitFocused () {
        this.focusedEmitted = true
    }
}

class TabbyCoreModule { }

module.exports = {
    default: TabbyCoreModule,
    ConfigService,
    AppService,
    NotificationsService,
    HotkeysService,
    PlatformService,
    ConfigProvider,
    ToolbarButtonProvider,
    HotkeyProvider,
    SplitTabComponent,
}
