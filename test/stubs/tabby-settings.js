'use strict'

class SettingsTabProvider {
    constructor () {
        this.id = ''
        this.title = ''
    }

    getComponentType () {
        throw new Error('not implemented')
    }
}

module.exports = { SettingsTabProvider }
