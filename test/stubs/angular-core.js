'use strict'

/** @angular/core 的最小替身（只够加载插件、拿到可实例化的类） */

function decoratorFactory () {
    return () => undefined
}

class EventEmitter {
    constructor () {
        this.handlers = []
    }

    subscribe (handler) {
        this.handlers.push(handler)
        return { unsubscribe: () => { this.handlers = this.handlers.filter(x => x !== handler) } }
    }

    emit (value) {
        this.handlers.forEach(handler => handler(value))
    }
}

class NgZone {
    run (fn) {
        return fn()
    }

    runOutsideAngular (fn) {
        return fn()
    }
}

class ChangeDetectorRef {
    markForCheck () { /* noop */ }
}

class ApplicationRef { }

module.exports = {
    Injectable: decoratorFactory,
    Component: decoratorFactory,
    NgModule: decoratorFactory,
    Directive: decoratorFactory,
    Input: decoratorFactory,
    Output: decoratorFactory,
    ViewChild: decoratorFactory,
    HostBinding: decoratorFactory,
    HostListener: decoratorFactory,
    Inject: decoratorFactory,
    Optional: decoratorFactory,
    EventEmitter,
    NgZone,
    ChangeDetectorRef,
    ApplicationRef,
    ChangeDetectionStrategy: { OnPush: 0, Default: 1 },
}
