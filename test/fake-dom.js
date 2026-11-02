'use strict'

/**
 * 极简假 DOM，供 node 环境下冒烟测试 dock.js / index.js。
 * 只实现被测代码真正用到的部分。
 */

/** 够用的 CSSStyleDeclaration 替身：既能直接赋值属性，也支持自定义属性 */
class FakeStyle {
    constructor () {
        this._properties = {}
    }

    setProperty (name, value) {
        this._properties[name] = String(value)
    }

    getPropertyValue (name) {
        return this._properties[name] || ''
    }

    removeProperty (name) {
        const value = this._properties[name] || ''
        delete this._properties[name]
        return value
    }
}

class FakeElement {
    constructor (tag) {
        this.tagName = String(tag).toUpperCase()
        this.nodeType = String(tag).startsWith('#') ? 3 : 1
        this.children = []
        this.parentElement = null
        this.style = new FakeStyle()
        this.attributes = {}
        this.listeners = {}
        this.hidden = false
        this.value = ''
        this.textContent = ''
        this._classes = new Set()
        this.options = []
        const self = this
        this.classList = {
            add: (...names) => names.forEach(name => self._classes.add(name)),
            remove: (...names) => names.forEach(name => self._classes.delete(name)),
            contains: name => self._classes.has(name),
            toggle: (name, force) => {
                const on = force === undefined ? !self._classes.has(name) : !!force
                if (on) {
                    self._classes.add(name)
                } else {
                    self._classes.delete(name)
                }
                return on
            },
        }
    }

    get className () {
        return Array.from(this._classes).join(' ')
    }

    set className (value) {
        this._classes = new Set(String(value).split(/\s+/).filter(Boolean))
    }

    get isConnected () {
        let node = this
        while (node.parentElement) {
            node = node.parentElement
        }
        return node === global.document.body || node === global.document.head
    }

    appendChild (child) {
        if (child.parentElement) {
            child.parentElement.removeChild(child)
        }
        this.children.push(child)
        child.parentElement = this
        return child
    }

    removeChild (child) {
        this.children = this.children.filter(x => x !== child)
        child.parentElement = null
        return child
    }

    replaceChildren (...nodes) {
        for (const child of this.children) {
            child.parentElement = null
        }
        this.children = []
        for (const node of nodes) {
            this.appendChild(node)
        }
    }

    addEventListener (type, handler) {
        this.listeners[type] = this.listeners[type] || []
        this.listeners[type].push(handler)
    }

    removeEventListener () { /* 不需要 */ }

    dispatch (type, event) {
        for (const handler of this.listeners[type] || []) {
            handler(event)
        }
    }

    setAttribute (key, value) {
        this.attributes[key] = String(value)
    }

    getAttribute (key) {
        return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null
    }

    removeAttribute (key) {
        delete this.attributes[key]
    }

    querySelector () {
        return null
    }

    closest (selector) {
        const wanted = String(selector).replace(/^\./, '')
        let current = this
        while (current) {
            if (current._classes && current._classes.has(wanted)) {
                return current
            }
            current = current.parentElement
        }
        return null
    }

    contains (node) {
        let current = node
        while (current) {
            if (current === this) {
                return true
            }
            current = current.parentElement
        }
        return false
    }

    focus () {
        global.document.activeElement = this
        this.dispatch('focus', { target: this })
    }

    blur () {
        if (global.document.activeElement === this) {
            global.document.activeElement = null
        }
        this.dispatch('blur', { target: this })
    }

    select () { /* noop */ }

    setSelectionRange () { /* noop */ }

    scrollIntoView () { /* noop */ }

    remove () {
        if (this.parentElement) {
            this.parentElement.removeChild(this)
        }
    }

    getBoundingClientRect () {
        return { left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 }
    }

    matches () {
        return false
    }
}

class FakeOption extends FakeElement {
    constructor (text, value) {
        super('option')
        this.text = text
        this.value = value
    }
}

class FakeSelect extends FakeElement {
    constructor () {
        super('select')
        this.value = ''
    }

    replaceChildren (...nodes) {
        super.replaceChildren(...nodes)
        this.options = nodes
        if (!nodes.some(option => option.value === this.value)) {
            this.value = nodes.length ? nodes[0].value : ''
        }
    }
}

function install () {
    const registry = new Map()
    const documentListeners = {}
    global.Element = FakeElement
    global.Option = FakeOption
    global.document = {
        activeElement: null,
        head: new FakeElement('head'),
        body: new FakeElement('body'),
        createElement: tag => (tag === 'select' ? new FakeSelect() : new FakeElement(tag)),
        createTextNode: text => {
            const node = new FakeElement('#text')
            node.textContent = String(text)
            return node
        },
        getElementById: id => registry.get(id) || null,
        addEventListener: (type, handler) => {
            documentListeners[type] = documentListeners[type] || []
            documentListeners[type].push(handler)
        },
        removeEventListener: (type, handler) => {
            documentListeners[type] = (documentListeners[type] || []).filter(x => x !== handler)
        },
        /** 测试用：派发 document 级事件 */
        dispatch: (type, event) => {
            for (const handler of documentListeners[type] || []) {
                handler(event)
            }
        },
        listenerCount: type => (documentListeners[type] || []).length,
        /** 测试隔离用：清掉所有 document 级监听 */
        resetListeners: () => {
            for (const type of Object.keys(documentListeners)) {
                delete documentListeners[type]
            }
        },
    }
    global.window = {
        dispatchEvent: () => true,
        addEventListener: () => null,
        removeEventListener: () => null,
        innerWidth: 1280,
        innerHeight: 800,
    }
    global.Event = class Event {
        constructor (type) {
            this.type = type
        }
    }
    global.getComputedStyle = () => ({
        marginLeft: '0px',
        marginRight: '0px',
        marginBottom: '0px',
        backgroundColor: 'transparent',
        color: 'rgb(220, 220, 220)',
        // 测试里通过 global.__themeVars 模拟 Tabby 写在 :root 上的主题变量
        getPropertyValue: name => (global.__themeVars && global.__themeVars[name]) || '',
    })
    global.__themeVars = {}
    return { FakeElement, FakeOption, FakeSelect, registry }
}

module.exports = { install, FakeElement, FakeOption, FakeSelect }
