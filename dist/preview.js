'use strict'

let nextId = 0

/** One shared hover/focus preview per surface. No command is ever executed here. */
class CommandPreview {
    constructor () {
        this.owner = null
        this.panel = null
        this.timer = null
        this.onScroll = event => {
            if (!this.panel || !this.panel.contains(event.target)) this.hide()
        }
        this.onKey = event => { if (event.key === 'Escape') this.hide() }
        this.onResize = () => this.hide()
    }

    show (owner, text) {
        this.cancelHide()
        if (this.owner === owner && this.panel && this.text === text) return
        this.hide()
        this.owner = owner
        this.text = text
        const panel = document.createElement('div')
        panel.className = 'qcl-command-preview'
        panel.id = `qcl-command-preview-${++nextId}`
        panel.setAttribute('role', 'tooltip')
        const style = getComputedStyle(owner)
        const token = (key, fallback) => style.getPropertyValue(key).trim() || fallback
        panel.style.cssText = 'position:fixed;z-index:12000;box-sizing:border-box;padding:12px 14px;border:1px solid;border-radius:8px;box-shadow:0 8px 30px #0005;user-select:text;'
            + 'font:13px/1.55 "Segoe UI","Microsoft YaHei",sans-serif;max-height:45vh;overflow:auto;'
        panel.style.background = token('--qcl-bg', token('--theme-bg-more', '#202329'))
        panel.style.color = token('--qcl-fg', token('--theme-fg', '#edf0f5'))
        panel.style.borderColor = token('--qcl-border', token('--theme-fg-less-2', '#59616e'))
        const code = document.createElement('pre')
        code.textContent = text || '（空命令）'
        code.style.cssText = 'margin:0;color:inherit;background:transparent;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 Consolas,monospace;user-select:text'
        panel.appendChild(code)
        panel.addEventListener('mouseenter', () => this.cancelHide())
        panel.addEventListener('mouseleave', () => this.scheduleHide())
        this.panel = panel
        document.body.appendChild(panel)
        owner.setAttribute('aria-describedby', panel.id)
        const bounds = owner.getBoundingClientRect()
        panel.style.width = `${Math.max(180, Math.min(560, window.innerWidth - 24))}px`
        const size = panel.getBoundingClientRect()
        panel.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - size.width - 12))}px`
        const above = bounds.top - size.height - 8
        panel.style.top = `${Math.max(12, above >= 12 ? above : Math.min(bounds.bottom + 8, window.innerHeight - size.height - 12))}px`
        document.addEventListener('scroll', this.onScroll, true)
        document.addEventListener('keydown', this.onKey, true)
        window.addEventListener('resize', this.onResize)
    }

    cancelHide () { clearTimeout(this.timer); this.timer = null }
    scheduleHide () {
        this.cancelHide()
        this.timer = setTimeout(() => {
            if (!this.panel || !this.panel.matches(':hover')) this.hide()
        }, 140)
    }
    hide () {
        this.cancelHide()
        if (this.owner) this.owner.removeAttribute('aria-describedby')
        if (this.panel) this.panel.remove()
        this.owner = null
        this.panel = null
        document.removeEventListener('scroll', this.onScroll, true)
        document.removeEventListener('keydown', this.onKey, true)
        window.removeEventListener('resize', this.onResize)
    }
    destroy () { this.hide() }
}

module.exports = { CommandPreview }
