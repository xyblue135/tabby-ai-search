'use strict'

/** @ng-bootstrap/ng-bootstrap 的最小替身 */

class NgbModal {
    constructor () {
        this.opened = []
        this.nextInstance = null
    }

    open (component, options) {
        const reference = { componentInstance: this.nextInstance, component, options, closed: false, close: () => { reference.closed = true } }
        this.opened.push(reference)
        return reference
    }
}

class NgbActiveModal {
    constructor () {
        this.closed = false
    }

    close () {
        this.closed = true
    }
}

class NgbModule { }

module.exports = { NgbModal, NgbActiveModal, NgbModule }
