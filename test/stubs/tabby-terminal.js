'use strict'

/** tabby-terminal 的最小替身：BaseTerminalTabComponent 用来做 instanceof 判断 */

class BaseTerminalTabComponent {
    constructor () {
        this.title = 'cmd.exe'
        this.inputs = []
        this.focusedEmitted = 0
        this.hostView = null
    }

    sendInput (data) {
        this.inputs.push(data)
    }

    emitFocused () {
        this.focusedEmitted++
    }
}

module.exports = { BaseTerminalTabComponent }
