"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@angular/core");
const common_1 = require("@angular/common");
const forms_1 = require("@angular/forms");
const ng_bootstrap_1 = require("@ng-bootstrap/ng-bootstrap");
const tabby_core_1 = require("tabby-core");
const tabby_settings_1 = require("tabby-settings");
const tabby_terminal_1 = require("tabby-terminal");
const logic_1 = require("./logic");
const dock_1 = require("./dock");
const ai_1 = require("./ai");
// ------------------------------------------------------------------ 数据层
let CommandStoreService = class CommandStoreService {
    constructor(config) {
        this.config = config;
        this.source = null;
        this.index = [];
        this.textSet = new Set();
        this.groupCache = [];
        this.ungrouped = false;
        /** 每次重建索引自增，供底部输入条判断列表是否需要重绘 */
        this.revision = 0;
        /** 是否曾经自动补过 id（补过就要落盘一次） */
        this.idsAssigned = false;
    }
    ensureStore() {
        const store = this.config.store;
        if (!store) {
            // 配置是异步加载的，加载完成前 config.store 是 undefined：
            // 这里给一个空索引，绝不抛错。
            return this.source || [];
        }
        if (!store.qc) {
            store.qc = { cmds: [], groups: [] };
        }
        if (!Array.isArray(store.qc.cmds)) {
            store.qc.cmds = [];
        }
        if (!Array.isArray(store.qc.groups)) {
            store.qc.groups = [];
        }
        if (this.source !== store.qc.cmds) {
            this.source = store.qc.cmds;
            this.rebuildIndex(false);
        }
        return this.source;
    }
    makeId() {
        return `qcl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    }
    /** 索引只在加载或增删改时重建，打字时不做任何扫描 */
    rebuildIndex(persistIds) {
        const commands = this.source || [];
        let changed = false;
        this.revision++;
        this.index = commands.map((cmd, order) => {
            if (!cmd.id) {
                cmd.id = this.makeId();
                changed = true;
            }
            cmd.group = cmd.group || '';
            const name = String(cmd.name || '');
            const group = String(cmd.group || '');
            const text = String(cmd.text || '');
            return {
                cmd,
                order,
                nameLower: name.toLocaleLowerCase(),
                groupLower: group.toLocaleLowerCase(),
                textLower: text.toLocaleLowerCase(),
                haystack: `${name}\n${group}\n${text}`.toLocaleLowerCase(),
            };
        });
        const groups = new Set();
        let ungrouped = false;
        for (const item of this.index) {
            if (item.cmd.group) {
                groups.add(item.cmd.group);
            }
            else {
                ungrouped = true;
            }
        }
        this.groupCache = Array.from(groups).sort((a, b) => a.localeCompare(b));
        this.ungrouped = ungrouped;
        this.textSet = new Set(this.index.map(item => String(item.cmd.text || '').trim()).filter(text => text));
        if (changed) {
            this.idsAssigned = true;
        }
        // ensureStore() 先扫一遍（不落盘），initialize() 再扫一遍并在这里落盘：
        // 只有真正补过 id 才写配置。
        if (this.idsAssigned && persistIds) {
            this.idsAssigned = false;
            this.config.save();
        }
    }
    initialize() {
        this.ensureStore();
        // 只在缺少 id 时补一次并落盘（唯一的迁移动作）
        this.rebuildIndex(true);
    }
    count() {
        this.ensureStore();
        return this.index.length;
    }
    groups() {
        this.ensureStore();
        return this.groupCache.slice();
    }
    hasUngrouped() {
        this.ensureStore();
        return this.ungrouped;
    }
    /** 收藏命令正文的集合（trim 后），供"整理记忆"判断哪条历史还没进收藏 */
    favoriteTexts() {
        this.ensureStore();
        return this.textSet;
    }
    /** rank=true：按相关度排序（底部输入条用）；否则保持原顺序（管理器列表用） */
    search(query, group, limit, rank) {
        this.ensureStore();
        return logic_1.matchCommands(this.index, query, group, limit, { rank: !!rank, fuzzy: !!rank });
    }
    upsert(draft, original) {
        const commands = this.ensureStore();
        const name = String(draft.name || '').trim();
        const group = String(draft.group || '').trim();
        if (original) {
            Object.assign(original, {
                name,
                text: draft.text,
                group,
            });
        }
        else {
            commands.push({
                id: this.makeId(),
                name,
                text: draft.text,
                group,
            });
        }
        this.rebuildIndex(false);
        this.config.save();
        return original || commands[commands.length - 1];
    }
    remove(command) {
        const commands = this.ensureStore();
        const index = commands.indexOf(command);
        if (index >= 0) {
            commands.splice(index, 1);
            this.rebuildIndex(false);
            this.config.save();
        }
    }
};
CommandStoreService = __decorate([
    (0, core_1.Injectable)(),
    __metadata("design:paramtypes", [tabby_core_1.ConfigService])
], CommandStoreService);
// ------------------------------------------------------------------ 执行层
let CommandExecutorService = class CommandExecutorService {
    constructor(app, config, notifications) {
        this.app = app;
        this.config = config;
        this.notifications = notifications;
    }
    terminator() {
        const store = this.config.store;
        const qc = (store && store.qc) || {};
        const dock = qc.dock || {};
        return logic_1.terminatorFor(dock.terminator);
    }
    /** 递归拆开 split tab，拿到真正能接收输入的终端 */
    resolveTerminal(tab) {
        let current = tab || null;
        for (let depth = 0; depth < 8 && current; depth++) {
            if (current instanceof tabby_terminal_1.BaseTerminalTabComponent) {
                return current;
            }
            if (typeof current.getFocusedTab === 'function') {
                const next = current.getFocusedTab();
                if (!next || next === current) {
                    return null;
                }
                current = next;
                continue;
            }
            return null;
        }
        return null;
    }
    activeTerminal() {
        return this.resolveTerminal(this.app.activeTab);
    }
    /** 执行一条收藏命令 */
    async send(command) {
        const terminal = this.activeTerminal();
        if (!terminal) {
            this.notifications.notice('当前标签不是终端，无法发送命令');
            return false;
        }
        return this.sendTextTo(terminal, command.text);
    }
    /** 执行输入框里的原始文本 */
    async sendText(text) {
        const terminal = this.activeTerminal();
        if (!terminal) {
            this.notifications.notice('当前标签不是终端，无法发送命令');
            return false;
        }
        return this.sendTextTo(terminal, text);
    }
    async sendTextTo(terminal, text) {
        const autoReturn = !!(this.config.store && this.config.store.qc && this.config.store.qc.autoReturn === true);
        let steps;
        try {
            steps = logic_1.buildSendPlan(text, {
                appendCR: autoReturn,
                terminator: this.terminator(),
            });
        } catch (error) {
            this.notifications.notice(String(error.message || error));
            return false;
        }
        // Preserve a multiline draft as pasted text when the terminal supports it.
        if (!autoReturn && steps.length === 1 && /[\r\n]/.test(steps[0].data) &&
            this.config.store?.terminal?.bracketedPaste !== false &&
            terminal.frontend?.supportsBracketedPaste?.()) {
            steps[0].data = '\x1b[200~' + steps[0].data + '\x1b[201~';
        }
        for (const step of steps) {
            if (step.delay) {
                await new Promise(resolve => setTimeout(resolve, step.delay));
                continue;
            }
            try {
                await terminal.sendInput(step.data);
            }
            catch (error) {
                this.notifications.error('发送命令失败', String(error && error.message ? error.message : error));
                return false;
            }
            if (step.gap) {
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        }
        return steps.length > 0;
    }
};
CommandExecutorService = __decorate([
    (0, core_1.Injectable)(),
    __metadata("design:paramtypes", [tabby_core_1.AppService,
        tabby_core_1.ConfigService,
        tabby_core_1.NotificationsService])
], CommandExecutorService);
// ------------------------------------------------------------- 底部输入条管理
let QuickCmdsLiteDockService = class QuickCmdsLiteDockService {
    constructor(app, config, store, executor, modal, notifications, zone, platform) {
        this.app = app;
        this.config = config;
        this.store = store;
        this.executor = executor;
        this.modal = modal;
        this.notifications = notifications;
        this.zone = zone;
        this.platform = platform;
        this.dock = null;
        this.splitTab = null;
        this.splitSubscription = null;
        this.watchdog = null;
        this.retryTimers = [];
        this.saveTimer = null;
        this.started = false;
        this.configReady = false;
        this.focusPatchedTabs = new WeakSet();
    }
    start() {
        if (this.started) {
            return;
        }
        this.started = true;
        const reconcile = () => this.reconcile();
        this.app.activeTabChange$.subscribe(reconcile);
        this.app.tabOpened$.subscribe(() => this.retryReconcile());
        this.app.tabClosed$.subscribe(reconcile);
        this.app.tabRemoved$.subscribe(reconcile);
        this.app.tabsChanged$.subscribe(reconcile);
        this.config.changed$.subscribe(reconcile);
        window.addEventListener('resize', () => {
            if (this.dock) {
                this.dock.invalidateMetrics();
            }
            this.reconcile();
        });
        // 主题/配色方案切换后重新取色（Tabby 的 --theme-* 变量会变）
        try {
            if (this.platform && this.platform.themeChanged$) {
                this.platform.themeChanged$.subscribe(() => {
                    if (this.dock) {
                        this.dock.invalidateMetrics();
                    }
                    this.reconcile();
                });
            }
        }
        catch (error) {
            // 拿不到主题事件也不影响使用
        }
        // 关键：Tabby 的配置是异步加载的（setTimeout -> init -> load），
        // 而工具栏/快捷键 provider 在配置加载前就会被实例化，
        // 所以这之前不能碰 config.store。
        const onReady = () => {
            if (this.configReady) {
                return;
            }
            this.configReady = true;
            this.reconcile();
        };
        try {
            if (this.config.ready$) {
                this.config.ready$.subscribe(onReady);
                const readyPromise = this.config.ready$.toPromise();
                if (readyPromise && typeof readyPromise.then === 'function') {
                    readyPromise.then(onReady).catch(() => null);
                }
            }
        }
        catch (error) {
            // 拿不到 ready$ 也没关系：心跳会在 config.store 出现后自行开始工作
        }
        // 心跳兜底：位置正确时几乎零开销；放在 Angular 区域外，避免每秒触发变更检测
        this.zone.runOutsideAngular(() => {
            this.watchdog = setInterval(() => this.reconcile(), 1000);
        });
        this.reconcile();
    }
    /** 取 qc.dock；create=true 时缺什么补什么。配置还没加载完时返回 null。 */
    qcDock(create) {
        const store = this.config.store;
        if (!store) {
            return null;
        }
        if (!store.qc) {
            if (!create) {
                return null;
            }
            store.qc = { cmds: [], groups: [] };
        }
        if (!store.qc.dock) {
            if (!create) {
                return null;
            }
            store.qc.dock = {};
        }
        return store.qc.dock;
    }
    dockSettings() {
        return this.qcDock(false) || {};
    }
    dockEnabled() {
        return this.dockSettings().enabled !== false;
    }
    /** 新建 tab 时宿主元素可能还没插进 DOM，多试几次 */
    retryReconcile() {
        this.retryTimers.forEach(timer => clearTimeout(timer));
        this.retryTimers = [0, 60, 250, 700].map(delay => setTimeout(() => this.reconcile(), delay));
    }
    resolveTargetTab() {
        let tab = this.app.activeTab;
        for (let depth = 0; depth < 8 && tab; depth++) {
            if (tab instanceof tabby_terminal_1.BaseTerminalTabComponent) {
                return tab;
            }
            if (typeof tab.getFocusedTab === 'function') {
                const next = tab.getFocusedTab();
                if (!next || next === tab) {
                    return null;
                }
                tab = next;
                continue;
            }
            return null;
        }
        return null;
    }
    hostElement(tab) {
        const nodes = tab && tab.hostView ? tab.hostView.rootNodes : null;
        const element = nodes && nodes[0];
        return element && element.nodeType === 1 ? element : null;
    }
    /**
     * Tabby 聚焦终端时会调用 emitFocused()，里面同步执行 frontend.focus()，
     * 把焦点从我们的输入框抢走（表现为 Alt+Q 之后打不了字）。
     *
     * 这里**不拦截**这次聚焦（拦截会让"点终端"永远拿不回焦点），
     * 而是照常放行，之后在列表仍然打开的情况下把焦点交还输入框（只补一次）。
     * 用户主动点终端时列表已经在 document 捕获阶段收起，不会抢回来。
     */
    patchTerminalFocus(tab) {
        if (!tab || typeof tab.emitFocused !== 'function' || this.focusPatchedTabs.has(tab)) {
            return;
        }
        const original = tab.emitFocused.bind(tab);
        tab.emitFocused = (...args) => {
            const hadFocus = !!(this.dock && this.dock.isFocused());
            const result = original(...args);
            if (hadFocus && this.dock && this.dock.listVisible &&
                typeof this.dock.restoreFocus === 'function') {
                this.dock.restoreFocus();
            }
            return result;
        };
        this.focusPatchedTabs.add(tab);
    }
    /** split tab 里切换焦点面板时立即跟随 */
    bindSplit() {
        const active = this.app.activeTab;
        const split = active && typeof active.getFocusedTab === 'function' && typeof active.getAllTabs === 'function'
            ? active
            : null;
        if (this.splitTab === split) {
            return;
        }
        if (this.splitSubscription) {
            this.splitSubscription.unsubscribe();
            this.splitSubscription = null;
        }
        this.splitTab = split;
        if (split && split.focusChanged$) {
            this.splitSubscription = split.focusChanged$.subscribe(() => this.reconcile());
        }
    }
    reconcile() {
        // 任何异常都不允许冒泡到 Tabby 的启动/事件流程里
        try {
            this.reconcileInternal();
        }
        catch (error) {
            console.error('[tabby-quick-cmds-lite] 停靠输入条刷新失败', error);
        }
    }
    reconcileInternal() {
        // 配置加载完成前不要动 config.store；万一拿不到 ready$，
        // 只要 store 出现了就继续工作。
        if (!this.configReady && !this.config.store) {
            return;
        }
        this.bindSplit();
        const targetTab = this.resolveTargetTab();
        this.patchTerminalFocus(targetTab);
        const host = this.dockEnabled() ? this.hostElement(targetTab) : null;
        if (!host) {
            if (this.dock) {
                this.dock.detach();
            }
            return;
        }
        if (!this.dock) {
            this.dock = new dock_1.QuickCmdsDock(this.buildDockApi());
        }
        if (this.dock.attachedHost !== host) {
            this.dock.detach();
            this.dock.attach(host);
            this.nudgeLayout();
        }
        this.dock.sync();
    }
    /** 供设置页等外部调用 */
    reconcileNow() {
        this.reconcile();
    }
    /** 输入条改变了终端可用高度，提醒各终端前端重新计算行列 */
    nudgeLayout() {
        setTimeout(() => {
            try {
                window.dispatchEvent(new Event('resize'));
            }
            catch (error) {
                // 忽略
            }
        }, 0);
    }
    buildDockApi() {
        return {
            config: this.config,
            store: this.store,
            executor: this.executor,
            openManager: () => this.openManager(),
            openOrganizer: () => this.openOrganizer(),
            editCommand: command => this.editCommand(command),
            openAI: () => this.openAI(false),
            openSettings: () => this.openSettings(),
            saveAsCommand: text => this.saveAsCommand(text),
            setEnabled: enabled => this.setEnabled(enabled),
            focusTerminal: () => this.focusTerminal(),
            markDirty: () => this.markDirty(),
            notify: text => this.notifications.notice(text),
        };
    }
    setEnabled(enabled) {
        const dock = this.qcDock(true);
        if (!dock) {
            return;
        }
        dock.enabled = enabled;
        this.config.save();
        this.reconcile();
        this.notifications.notice(enabled ? '已显示快捷命令输入条' : '已收起输入条（Alt+Q 唤出）');
    }
    toggleEnabled() {
        this.setEnabled(!this.dockEnabled());
    }
    /** Alt+Q：唤出并聚焦输入条 */
    focusDockInput() {
        const dock = this.qcDock(true);
        if (!dock) {
            this.notifications.notice('配置还在加载，请稍候再试');
            return;
        }
        if (dock.enabled === false) {
            dock.enabled = true;
            this.config.save();
            this.reconcile();
        }
        this.reconcile();
        if (this.dock && this.dock.attachedHost) {
            this.dock.focusInput();
        }
        else {
            this.notifications.notice('当前标签不是终端');
        }
    }
    fillInput(text) {
        this.focusDockInput();
        if (this.dock && this.dock.attachedHost) {
            this.dock.fillText(text);
            this.notifications.notice('已填入命令，可修改后按 Enter 发送');
        }
    }
    focusTerminal() {
        const tab = this.resolveTargetTab();
        if (tab && typeof tab.emitFocused === 'function') {
            tab.emitFocused();
        }
    }
    openAI(settings) {
        ai_1.open({ store: this.store, config: this.config, history: () => this.historyEntries() }, settings);
    }
    openSettings() {
        this.zone.run(() => { const ref = this.modal.open(QuickCmdsLiteSettingsTabComponent, { size: 'lg', centered: true }); if (ref && ref.componentInstance) ref.componentInstance.modalInstance = ref; });
    }
    openManager() {
        this.zone.run(() => {
            this.modal.open(QuickCmdsLiteModalComponent, { size: 'lg', centered: true, backdrop: 'static' });
        });
    }
    openOrganizer() {
        this.zone.run(() => {
            this.modal.open(QuickCmdsLiteOrganizerComponent, { size: 'lg', centered: true, backdrop: 'static' });
        });
    }
    editCommand(command) {
        this.zone.run(() => {
            const reference = this.modal.open(QuickCmdsLiteModalComponent, { size: 'lg', centered: true, backdrop: 'static' });
            reference.componentInstance.editorOnly = true;
            reference.componentInstance.editCommand(command);
        });
    }
    saveAsCommand(text) {
        const value = typeof text === 'string' && text.length ? text : (this.dock ? this.dock.input.value : '');
        this.zone.run(() => {
            const reference = this.modal.open(QuickCmdsLiteModalComponent, { size: 'lg', centered: true, backdrop: 'static' });
            const instance = reference.componentInstance;
            if (instance && typeof instance.startNewWithText === 'function') {
                instance.editorOnly = true;
                instance.activeGroup = this.dock ? this.dock.groupParam() : null;
                instance.startNewWithText(value);
            }
        });
    }
    /** 管理器里增删改之后立刻刷新输入条 */
    refreshDock() {
        if (this.dock) {
            this.dock.rebuildGroups();
            this.dock.refresh(true);
        }
    }
    clearHistory() {
        if (this.dock) {
            this.dock.clearHistory();
            return;
        }
        const dock = this.qcDock(true);
        if (!dock) {
            return;
        }
        dock.history = [];
        this.config.save();
    }
    /** 整理页数据源：历史条目（对象化），优先走已挂载的输入条 */
    historyEntries() {
        if (this.dock) {
            return this.dock.history();
        }
        const store = this.config.store;
        const dock = store && store.qc && store.qc.dock;
        return logic_1.normalizeHistory(Array.isArray(dock && dock.history) ? dock.history : []);
    }
    /** 整理页"丢弃"：把这条文本从历史记忆里删掉 */
    discardHistory(text) {
        if (this.dock) {
            this.dock.removeHistoryText(text);
            return;
        }
        const dock = this.qcDock(true);
        if (!dock) {
            return;
        }
        dock.history = logic_1.normalizeHistory(Array.isArray(dock.history) ? dock.history : [])
            .filter(item => item.text !== text);
        this.config.save().catch(() => null);
    }
    /** 整理页"撤销丢弃"：把刚删的条目放回历史 */
    restoreHistory(entry) {
        if (this.dock) {
            this.dock.restoreHistoryText(entry);
            return;
        }
        const dock = this.qcDock(true);
        if (!dock) {
            return;
        }
        const text = String(entry && entry.text ? entry.text : '').trim();
        if (!text) {
            return;
        }
        const history = logic_1.normalizeHistory(Array.isArray(dock.history) ? dock.history : [])
            .filter(item => item.text !== text);
        history.unshift({
            text,
            count: Number(entry.count) > 0 ? Number(entry.count) : 1,
            ts: Number(entry.ts) || Date.now(),
        });
        dock.history = history;
        this.config.save().catch(() => null);
    }
    /** 历史记录这类高频写入：合并后再落盘，避免每敲一次回车都重写整份配置文件 */
    markDirty() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.config.save().catch(() => null);
        }, 2000);
    }
};
QuickCmdsLiteDockService = __decorate([
    (0, core_1.Injectable)(),
    __metadata("design:paramtypes", [tabby_core_1.AppService,
        tabby_core_1.ConfigService,
        CommandStoreService,
        CommandExecutorService,
        ng_bootstrap_1.NgbModal,
        tabby_core_1.NotificationsService,
        core_1.NgZone,
        tabby_core_1.PlatformService])
], QuickCmdsLiteDockService);
// -------------------------------------------------------------------- 管理器
const { CommandPreview } = require('./preview');
/** 剪贴板写入 + 兜底（async Clipboard API 不可用时退回 execCommand），完成后回调一次 */
function copyTextToClipboard(text, onDone) {
    const finish = () => { if (typeof onDone === 'function') { onDone(); } };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(finish).catch(finish);
            return;
        }
    }
    catch (error) {
        // 走下面的兜底
    }
    try {
        const holder = document.createElement('textarea');
        holder.value = text;
        holder.style.position = 'fixed';
        holder.style.opacity = '0';
        document.body.appendChild(holder);
        holder.select();
        document.execCommand('copy');
        document.body.removeChild(holder);
        finish();
    }
    catch (error) {
        // 复制失败就保持原样
    }
}
const MODAL_TEMPLATE = `
<div class="qcl-shell" [class.qcl-editor-only]="editorOnly || editing">
  <div class="qcl-header">
    <div>
      <div class="qcl-title">{{ editing ? (editingOriginal ? '编辑命令' : '新增命令') : '命令管理器' }}</div>
      <div class="qcl-subtitle" *ngIf="!editorOnly && !editing">共 {{ total }} 条匹配</div>
    </div>
    <button class="btn btn-sm btn-outline-secondary" type="button" (click)="close()">关闭</button>
  </div>

  <div class="qcl-toolbar" *ngIf="!editorOnly && !editing">
    <input class="form-control" type="text" autofocus [(ngModel)]="query"
      (ngModelChange)="onQueryChanged($event)" (keydown.enter)="editFirst($event)"
      placeholder="搜索名称 / 分组 / 命令内容，空格分隔多个关键词...">
    <button class="btn btn-outline-secondary" type="button" (click)="dockService.openAI(false)">AI 找命令</button>

    <button class="btn btn-primary" type="button" (click)="newCommand()">+ 新增</button>
  </div>

  <div class="qcl-list-hint" *ngIf="!editorOnly && !editing">点击名称编辑 · 悬停查看命令</div>
  <div class="qcl-layout" [class.qcl-layout-editor]="editorOnly || editing">
    <div class="qcl-groups" *ngIf="!editorOnly && !editing">
      <button class="qcl-group" [class.active]="activeGroup === null" (click)="selectGroup(null)">全部</button>
      <button class="qcl-group" *ngFor="let group of groups; trackBy: trackGroup"
        [class.active]="activeGroup === group" (click)="selectGroup(group)">{{ group }}</button>
      <button class="qcl-group" [class.active]="activeGroup === ''" (click)="selectGroup('')">未分组</button>
    </div>

    <div class="qcl-main">
      <div class="qcl-editor" *ngIf="editing">
        <div class="qcl-editor-grid">
          <label>名称<input class="form-control" [(ngModel)]="draft.name" placeholder="例如：查看 Docker 容器"></label>
          <label>分组<input class="form-control" [(ngModel)]="draft.group" placeholder="例如：Docker"></label>
        </div>
        <label>命令<textarea class="form-control qcl-textarea" rows="5" [(ngModel)]="draft.text" placeholder="docker ps -a"></textarea></label>
        <div class="qcl-editor-actions">
          <button class="btn btn-sm btn-primary" type="button" (click)="saveDraft()" [disabled]="!canSave()">保存</button>
          <button class="btn btn-sm btn-outline-secondary" type="button" (click)="cancelEdit()">取消</button>
        </div>
      </div>

      <div class="qcl-empty" *ngIf="!editorOnly && !editing && results.length === 0">没有匹配的命令</div>

      <div class="qcl-list" *ngIf="!editorOnly && !editing && results.length">
        <div class="qcl-row" *ngFor="let cmd of results; trackBy: trackCommand"
          (mouseenter)="showPreview(cmd, $event)" (mouseleave)="hidePreview()"
          (focusin)="showPreview(cmd, $event)" (focusout)="hidePreview()">
          <button class="qcl-row-content" type="button" (click)="editCommand(cmd, $event)" (contextmenu)="editCommand(cmd, $event)">
            <span class="qcl-name">{{ cmd.name || '未命名命令' }}</span>
          </button>
          <div class="qcl-actions">
            <button class="btn btn-sm btn-outline-secondary" type="button" title="复制" (click)="copy(cmd, $event)">{{ copiedId === cmd.id ? '已复制' : '复制' }}</button>
            <button class="btn btn-sm btn-outline-secondary" type="button" title="编辑" (click)="editCommand(cmd, $event)">编辑</button>
            <button class="btn btn-sm btn-outline-danger" type="button" title="删除" (click)="deleteCommand(cmd, $event)">删除</button>
          </div>
        </div>
      </div>

      <button class="btn btn-sm btn-outline-secondary qcl-more" *ngIf="!editorOnly && !editing && results.length < total" (click)="showMore()">
        显示更多（当前 {{ results.length }} / {{ total }}）
      </button>
    </div>
  </div>
</div>
`;
const MODAL_STYLES = `
:host { display: block; }
.qcl-shell { min-height: 560px; display: flex; flex-direction: column; }
.qcl-editor-only { min-height:0; }
.qcl-layout.qcl-layout-editor { grid-template-columns:minmax(0,1fr); border-top:0; }
.qcl-editor-only .qcl-main { padding:16px 18px; }
.qcl-editor-only .qcl-editor { margin:0; padding:0; border:0; background:transparent; }
.qcl-header { display:flex; justify-content:space-between; align-items:center; padding:16px 18px 10px; border-bottom:1px solid rgba(127,127,127,.2); }
.qcl-title { font-size:18px; font-weight:600; }
.qcl-subtitle { font-size:12px; opacity:.65; margin-top:2px; }
.qcl-toolbar { display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:8px; padding:12px 18px; }
.qcl-layout { display:grid; grid-template-columns:150px minmax(0,1fr); flex:1; min-height:0; border-top:1px solid rgba(127,127,127,.15); }
.qcl-groups { padding:10px; overflow:auto; border-right:1px solid rgba(127,127,127,.18); max-height:620px; }
.qcl-group { display:block; width:100%; border:0; background:transparent; color:inherit; text-align:left; padding:8px 10px; border-radius:6px; margin-bottom:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.qcl-group:hover, .qcl-group.active { background:rgba(127,127,127,.16); }
.qcl-main { padding:10px 14px 16px; overflow:auto; max-height:620px; }
.qcl-list { display:flex; flex-direction:column; gap:6px; }
.qcl-row { display:flex; gap:8px; align-items:center; padding:3px 8px; border:1px solid rgba(127,127,127,.2); border-radius:8px; cursor:pointer; }
.qcl-row:hover { background:rgba(127,127,127,.08); }
.qcl-click-mode { font-size:11px; opacity:.7; align-self:center; }
.qcl-name { font-size:14px; }
.qcl-row-content { min-width:0; flex:1; border:0; background:transparent; color:inherit; font:inherit; text-align:left; padding:11px 4px; cursor:pointer; }
.qcl-name { font-weight:500; white-space:normal; overflow-wrap:anywhere; }
.qcl-meta { font-size:11px; opacity:.6; margin:2px 0 5px; }
.qcl-row code { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:inherit; opacity:.8; }
.qcl-actions { display:flex; gap:5px; flex-shrink:0; opacity:0; pointer-events:none; }
.qcl-row:hover .qcl-actions, .qcl-row:focus-within .qcl-actions { opacity:1; pointer-events:auto; }
.qcl-row-content:focus-visible { outline:2px solid currentColor; outline-offset:1px; border-radius:4px; }
.qcl-list-hint { padding:0 18px 12px; font-size:12px; opacity:.7; }
@media (hover:none) { .qcl-actions { opacity:1; pointer-events:auto; } }
.qcl-editor { padding:12px; margin-bottom:10px; border:1px solid rgba(127,127,127,.25); border-radius:8px; background:rgba(127,127,127,.05); }
.qcl-editor-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.qcl-editor label { display:block; font-size:12px; margin-bottom:8px; }
.qcl-editor label input, .qcl-editor label textarea { margin-top:4px; }
.qcl-textarea { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.qcl-check { display:flex !important; align-items:center; gap:7px; }
.qcl-editor-actions { display:flex; gap:8px; }
.qcl-empty { text-align:center; opacity:.6; padding:50px 10px; }
.qcl-more { width:100%; margin-top:10px; }
@media (max-width: 760px) {
  .qcl-layout { grid-template-columns:1fr; }
  .qcl-groups { display:flex; gap:4px; border-right:0; border-bottom:1px solid rgba(127,127,127,.18); max-height:none; overflow-x:auto; }
  .qcl-group { width:auto; flex:0 0 auto; }
  .qcl-row { align-items:center; }
  .qcl-toolbar { grid-template-columns:minmax(0,1fr) auto; }
  .qcl-toolbar > input { grid-column:1 / -1; }
  .qcl-actions { gap:3px; }
  .qcl-editor-grid { grid-template-columns:1fr; }
}
`;
let QuickCmdsLiteModalComponent = class QuickCmdsLiteModalComponent {
    constructor(modalInstance, store, app, dockService, cdr) {
        this.modalInstance = modalInstance;
        this.store = store;
        this.app = app;
        this.dockService = dockService;
        this.cdr = cdr;
        this.query = '';
        this.activeGroup = null;
        this.groups = [];
        this.results = [];
        this.total = 0;
        this.limit = 150;
        this.editing = false;
        this.editorOnly = false;
        this.draft = { name: '', text: '', group: '' };
        this.searchTimer = null;
        this.copiedId = null;
        this.commandPreview = new CommandPreview();
    }
    ngOnInit() {
        this.store.initialize();
        if (this.editorOnly) return;
        this.groups = this.store.groups();
        this.activeGroup = this.dockService.dock ? this.dockService.dock.groupParam() : null;
        this.refresh();
    }
    ngOnDestroy() {
        this.commandPreview.destroy();
        if (this.searchTimer) {
            clearTimeout(this.searchTimer);
        }
    }
    /** 由底部输入条的 ＋ 调用：带着内容直接进入新建状态 */
    startNewWithText(text) {
        this.editingOriginal = undefined;
        this.draft = {
            name: '',
            text: text || '',
            group: this.activeGroup || '',
        };
        this.editing = true;
        this.cdr.markForCheck();
    }
    onQueryChanged(_value) {
        if (this.searchTimer) {
            clearTimeout(this.searchTimer);
        }
        this.searchTimer = setTimeout(() => {
            this.limit = 150;
            this.refresh();
        }, 100);
    }
    selectGroup(group) {
        this.commandPreview.hide();
        this.activeGroup = group;
        this.limit = 150;
        this.refresh();
    }
    refresh() {
        this.commandPreview.hide();
        const found = this.store.search(this.query, this.activeGroup, this.limit, true);
        this.results = found.items;
        this.total = found.total;
        this.groups = this.store.groups();
        this.cdr.markForCheck();
    }
    showMore() {
        this.limit += 200;
        this.refresh();
    }
    showPreview(cmd, event) {
        this.commandPreview.show(event.currentTarget, cmd.text || '', cmd.name || '未命名命令');
    }
    hidePreview() { this.commandPreview.scheduleHide(); }
    editFirst(event) {
        if (event && (event.isComposing || event.keyCode === 229)) return;
        if (event) event.preventDefault();
        if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
        this.refresh();
        if (this.results.length) {
            this.editCommand(this.results[0]);
        }
    }
    preview(text) {
        return logic_1.preview(text, 220);
    }
    newCommand() {
        this.editingOriginal = undefined;
        this.draft = { name: '', text: this.query || '', group: this.activeGroup || '' };
        this.editing = true;
        this.cdr.markForCheck();
    }
    editCommand(cmd, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        this.commandPreview.hide();
        this.editingOriginal = cmd;
        this.draft = {
            id: cmd.id,
            name: cmd.name || '',
            text: cmd.text || '',
            group: cmd.group || '',
        };
        this.editing = true;
        this.cdr.markForCheck();
    }
    cancelEdit() {
        if (this.editorOnly) { this.close(); return; }
        this.editing = false;
        this.editingOriginal = undefined;
        this.cdr.markForCheck();
    }
    /** 名称必填；命令内容允许为空（有人拿它当快捷键备忘） */
    canSave() {
        return !!(this.draft.name && this.draft.name.trim());
    }
    saveDraft() {
        if (!this.canSave()) {
            return;
        }
        this.draft.name = this.draft.name.trim();
        this.draft.group = (this.draft.group || '').trim();
        this.store.upsert(this.draft, this.editingOriginal);
        this.dockService.refreshDock();
        if (this.editorOnly) { this.close(); return; }
        this.editing = false;
        this.editingOriginal = undefined;
        this.refresh();
    }
    deleteCommand(cmd, event) {
        event.stopPropagation();
        if (!window.confirm(`删除命令“${cmd.name || '未命名命令'}”？`)) {
            return;
        }
        this.store.remove(cmd);
        if (this.editingOriginal === cmd) {
            this.cancelEdit();
        }
        this.refresh();
        this.dockService.refreshDock();
    }
    copy(cmd, event) {
        event.stopPropagation();
        copyTextToClipboard(cmd.text || '', () => {
            this.copiedId = cmd.id;
            this.cdr.markForCheck();
            setTimeout(() => {
                if (this.copiedId === cmd.id) {
                    this.copiedId = null;
                    this.cdr.markForCheck();
                }
            }, 1200);
        });
    }
    close() {
        this.commandPreview.hide();
        this.modalInstance.close();
        const active = this.app.activeTab;
        if (active && active.emitFocused) {
            active.emitFocused();
        }
    }
    trackCommand(_index, cmd) {
        return cmd.id || cmd.text;
    }
    trackGroup(_index, group) {
        return group;
    }
};
QuickCmdsLiteModalComponent = __decorate([
    (0, core_1.Component)({
        selector: 'quick-cmds-lite-modal',
        template: MODAL_TEMPLATE,
        styles: [MODAL_STYLES],
        changeDetection: core_1.ChangeDetectionStrategy.OnPush,
    }),
    __metadata("design:paramtypes", [ng_bootstrap_1.NgbActiveModal,
        CommandStoreService,
        tabby_core_1.AppService,
        QuickCmdsLiteDockService,
        core_1.ChangeDetectorRef])
], QuickCmdsLiteModalComponent);
// ------------------------------------------------------------------ 整理记忆
const ORGANIZER_TEMPLATE = `
<div class="qcl-shell qcl-organizer-shell">
  <div class="qcl-header">
    <div>
      <div class="qcl-title">整理记忆</div>
      <div class="qcl-subtitle">{{ pending.length }} 条用过的命令还没进收藏 · 存为收藏后输入条会自动联想</div>
    </div>
    <div>
      <button class="btn btn-sm btn-outline-danger" type="button" (click)="clearAll()" [disabled]="!pending.length">清空历史</button>
      <button class="btn btn-sm btn-outline-secondary" type="button" (click)="close()">关闭</button>
    </div>
  </div>
  <div class="qcl-organizer-toolbar" *ngIf="pending.length || query">
    <input class="form-control" type="text" [(ngModel)]="query" (ngModelChange)="onQueryChanged()" placeholder="过滤历史命令（空格分隔多个关键词）...">
  </div>
  <div class="qcl-undo" *ngIf="lastDiscarded">
    已丢弃「{{ previewText(lastDiscarded.text) }}」
    <button class="btn btn-sm btn-outline-secondary" type="button" (click)="undoDiscard()">撤销</button>
  </div>
  <div class="qcl-organizer">
    <div class="qcl-empty" *ngIf="!pending.length">{{ query ? '没有匹配的历史命令' : '没有待整理的命令 —— 在底部输入条里用过的命令会自动出现在这里' }}</div>
    <div class="qcl-row" *ngFor="let item of visible; trackBy: trackItem"
      (mouseenter)="showPreview(item, $event)" (mouseleave)="hidePreview()">
      <div class="qcl-row-content">
        <span class="qcl-name">{{ previewText(item.text) }}</span>
        <div class="qcl-meta">用了 {{ item.count }} 次<ng-container *ngIf="item.time"> · {{ item.time }}</ng-container><ng-container *ngIf="item.similar"> · 与收藏「{{ item.similar.name }}」相似，可考虑丢弃</ng-container></div>
      </div>
      <div class="qcl-actions">
        <button class="btn btn-sm btn-outline-primary" type="button" title="打开编辑并保存为收藏命令" (click)="save(item)">存为收藏</button>
        <button class="btn btn-sm btn-outline-secondary" type="button" title="复制完整命令" (click)="copy(item)">{{ copiedText === item.text ? '已复制' : '复制' }}</button>
        <button class="btn btn-sm btn-outline-danger" type="button" title="从记忆中删除这条" (click)="discard(item)">丢弃</button>
      </div>
    </div>
    <button class="btn btn-sm btn-outline-secondary qcl-more" type="button" *ngIf="pending.length > visible.length" (click)="showMore()">
      显示更多（{{ visible.length }} / {{ pending.length }}）
    </button>
  </div>
</div>
`;
const ORGANIZER_STYLES = [MODAL_STYLES, `
.qcl-organizer-shell { min-height: 420px; }
.qcl-organizer { flex: 1; min-height: 0; overflow: auto; padding: 10px 14px 16px; display: flex; flex-direction: column; gap: 6px; }
.qcl-organizer-toolbar { padding: 10px 14px 0; }
.qcl-undo { display: flex; gap: 10px; align-items: center; padding: 8px 14px; border-bottom: 1px solid rgba(127,127,127,.2); font-size: 12px; }
`];
let QuickCmdsLiteOrganizerComponent = class QuickCmdsLiteOrganizerComponent {
    constructor(modalInstance, store, dockService, config, cdr) {
        this.modalInstance = modalInstance;
        this.store = store;
        this.dockService = dockService;
        this.config = config;
        this.cdr = cdr;
        this.pending = [];
        this.visible = [];
        this.limit = 100;
        this.query = '';
        this.copiedText = null;
        this.lastDiscarded = null;
        this.undoTimer = null;
        this.commandPreview = new CommandPreview();
        this.changeSubscription = null;
    }
    ngOnInit() {
        this.store.initialize();
        this.refresh();
        // 在弹出的编辑页里保存后配置会变化，这里跟着刷新"待整理"列表
        this.changeSubscription = this.config.changed$.subscribe(() => this.refresh());
    }
    ngOnDestroy() {
        this.commandPreview.destroy();
        this.clearUndoTimer();
        if (this.changeSubscription) {
            this.changeSubscription.unsubscribe();
            this.changeSubscription = null;
        }
    }
    refresh() {
        const favorites = this.store.favoriteTexts();
        const tokens = logic_1.tokenize(this.query);
        // 拷贝一份再做展示标注，避免把 similar 字段写回配置文件
        const items = this.dockService.historyEntries()
            .filter(item => item && item.text && !favorites.has(item.text))
            .map(item => ({ text: item.text, count: item.count || 1, ts: item.ts || null, time: logic_1.relativeTime(item.ts), similar: null }))
            .filter(item => !tokens.length || tokens.every(token => item.text.toLocaleLowerCase().includes(token)));
        for (let i = 0; i < items.length; i++) {
            items[i].similar = i < 100 ? logic_1.findSimilarFavorite(this.store.index, items[i].text) : null;
        }
        this.pending = items;
        this.visible = items.slice(0, this.limit);
        this.cdr.markForCheck();
    }
    onQueryChanged() {
        this.limit = 100;
        this.refresh();
    }
    showMore() {
        this.limit += 100;
        this.visible = this.pending.slice(0, this.limit);
        this.cdr.markForCheck();
    }
    previewText(text) {
        return logic_1.preview(text, 160);
    }
    showPreview(item, event) {
        this.commandPreview.show(event.currentTarget, item.text, '历史命令');
    }
    hidePreview() { this.commandPreview.scheduleHide(); }
    save(item) {
        this.commandPreview.hide();
        // 打开"只编辑"弹窗；保存成功后 config.changed$ 会触发 refresh，
        // 这条历史因为已经进了收藏而自动从待整理列表消失
        this.dockService.saveAsCommand(item.text);
    }
    copy(item) {
        copyTextToClipboard(item.text, () => this.markCopied(item.text));
    }
    markCopied(text) {
        this.copiedText = text;
        this.cdr.markForCheck();
        setTimeout(() => {
            if (this.copiedText === text) {
                this.copiedText = null;
                this.cdr.markForCheck();
            }
        }, 1200);
    }
    discard(item) {
        this.commandPreview.hide();
        this.lastDiscarded = item;
        this.clearUndoTimer();
        // 撤销条在弹窗里待 8 秒，超时视为放弃（历史这时已落盘或即将落盘，都不影响恢复）
        this.undoTimer = setTimeout(() => {
            this.undoTimer = null;
            this.lastDiscarded = null;
            this.cdr.markForCheck();
        }, 8000);
        this.dockService.discardHistory(item.text);
        this.refresh();
    }
    clearUndoTimer() {
        if (this.undoTimer) {
            clearTimeout(this.undoTimer);
            this.undoTimer = null;
        }
    }
    undoDiscard() {
        const entry = this.lastDiscarded;
        if (!entry) {
            return;
        }
        this.clearUndoTimer();
        this.lastDiscarded = null;
        this.dockService.restoreHistory(entry);
        this.refresh();
    }
    clearAll() {
        if (!window.confirm(`清空全部 ${this.dockService.historyEntries().length} 条输入历史？收藏命令不受影响。`)) {
            return;
        }
        this.dockService.clearHistory();
        this.refresh();
    }
    close() {
        this.commandPreview.hide();
        this.modalInstance.close();
    }
    trackItem(_index, item) {
        return item.text;
    }
};
QuickCmdsLiteOrganizerComponent = __decorate([
    (0, core_1.Component)({
        selector: 'quick-cmds-lite-organizer',
        template: ORGANIZER_TEMPLATE,
        styles: ORGANIZER_STYLES,
        changeDetection: core_1.ChangeDetectionStrategy.OnPush,
    }),
    __metadata("design:paramtypes", [ng_bootstrap_1.NgbActiveModal,
        CommandStoreService,
        QuickCmdsLiteDockService,
        tabby_core_1.ConfigService,
        core_1.ChangeDetectorRef])
], QuickCmdsLiteOrganizerComponent);
// -------------------------------------------------------------------- 设置页
const SETTINGS_TEMPLATE = `
<div class="settings-tab">
  <div class="d-flex justify-content-between align-items-center"><h3>Quick Commands Lite 总设置</h3><button class="btn btn-sm btn-outline-secondary" (click)="close()">关闭</button></div>
  <p>共 <b>{{ count }}</b> 条收藏命令，分为 <b>{{ groupCount }}</b> 个分组。底部输入条常驻在终端下方，即输即发。</p>
  <p class="text-muted">
    <b>Alt+Q</b> 聚焦输入条 ·
    <b>Alt+Shift+Q</b> 打开命令管理器 ·
    输入条里：<b>回车</b> 发送 / <b>↑↓</b> 选命令 / <b>Tab</b> 填入输入框 / <b>Ctrl+S</b> 存为新命令 / <b>Esc</b> 回到终端
  </p>
  <hr>
  <h5>AI 设置</h5>
  <div class="row g-2">
    <div class="col-md-6"><label class="form-label">基础 URL</label><input class="form-control form-control-sm" [(ngModel)]="aiBaseURL"></div>
    <div class="col-md-6"><label class="form-label">API 密钥</label><input class="form-control form-control-sm" type="password" [(ngModel)]="aiApiKey"></div>
    <div class="col-md-6"><label class="form-label">模型</label><input class="form-control form-control-sm" [(ngModel)]="aiModel"></div>
    <div class="col-md-6"><label class="form-label">接口类型</label><select class="form-select form-select-sm" [(ngModel)]="aiProtocol"><option value="chat">Chat Completions</option><option value="responses">Responses</option><option value="messages">Anthropic Messages</option></select></div>
  </div>
  <div class="mt-2"><label class="form-label">AI 分组黑名单（未勾选的分组不参与检索）</label><div class="d-flex flex-wrap gap-2"><label *ngFor="let group of aiGroups"><input type="checkbox" [checked]="!aiExcludedGroups.includes(group)" (change)="toggleAiGroup(group, $event.target.checked)"> {{ group || '未分组' }}</label></div><button class="btn btn-sm btn-outline-secondary mt-2" (click)="clearAiGroups()">清空所有勾选</button><button class="btn btn-sm btn-outline-secondary mt-2 ms-2" (click)="selectAiGroups()">全选分组</button></div>
  <div class="mt-2"><label class="form-label">最多发送给 AI 的候选命令</label><input class="form-control form-control-sm" type="number" min="10" max="200" [(ngModel)]="aiCandidateLimit"><label class="form-check mt-2"><input type="checkbox" [(ngModel)]="aiIncludeHistory"> 把输入历史也纳入 AI 检索（收藏 + 历史一起作为语料）</label></div><div class="mt-2"><button class="btn btn-sm btn-primary" (click)="saveAISettings()">保存 AI 设置</button><button class="btn btn-sm btn-outline-secondary ms-2" (click)="testAI()">测试 AI 连接</button><span class="ms-2">{{ aiStatus }}</span><button class="btn btn-sm btn-outline-secondary ms-2" (click)="dockService.openAI(false)">打开 AI 找命令</button></div>
  <hr>
  <h5>命令发送</h5>
  <label class="form-check mb-2">
    <input class="form-check-input" type="checkbox" [(ngModel)]="autoReturn" (ngModelChange)="apply()">
    发送后自动回车（全局）
  </label>
  <p class="text-muted">默认关闭，统一用于全部收藏命令、历史和输入框。</p>
  <h5>输入栏显示</h5>
  <div class="row g-3"><div class="col-auto"><label class="form-label">字体大小</label><input class="form-control form-control-sm" type="number" min="10" max="24" [(ngModel)]="fontSize" (ngModelChange)="apply()"></div><div class="col-auto"><label class="form-label">输入栏高度</label><input class="form-control form-control-sm" type="number" min="24" max="80" [(ngModel)]="inputHeight" (ngModelChange)="apply()"></div></div>
  <hr>
  <div class="form-check">
    <input class="form-check-input" type="checkbox" id="qcl-dock-enabled" [(ngModel)]="dockEnabled" (ngModelChange)="apply()">
    <label class="form-check-label" for="qcl-dock-enabled">在终端底部显示快捷命令输入条</label>
  </div>
  <div class="form-check">
    <input class="form-check-input" type="checkbox" id="qcl-save-history" [(ngModel)]="saveHistory" (ngModelChange)="apply()">
    <label class="form-check-label" for="qcl-save-history">记录输入历史（输入框为空时列出最近用过的命令）</label>
  </div>
  <div class="mt-3">
    <label class="form-label">终端底部命令按钮的左键行为</label>
    <select class="form-select form-select-sm" [(ngModel)]="clickAction" (ngModelChange)="apply()">
      <option value="send">发送到终端（回车由全局开关控制）</option>
      <option value="fill">点击命令仅填入输入框，手动按 Enter 发送</option>
    </select>
  </div>
  <div class="form-check">
    <input class="form-check-input" type="checkbox" id="qcl-show-history" [(ngModel)]="showHistory" (ngModelChange)="apply()">
    <label class="form-check-label" for="qcl-show-history">在建议列表里包含历史命令</label>
  </div>
  <div class="row g-3 mt-2">
    <div class="col-auto">
      <label class="form-label">最多建议条数</label>
      <input class="form-control form-control-sm" type="number" min="3" max="50" [(ngModel)]="maxSuggestions" (ngModelChange)="apply()">
    </div>
    <div class="col-auto">
      <label class="form-label">历史记忆条数</label>
      <input class="form-control form-control-sm" type="number" min="0" max="2000" [(ngModel)]="historySize" (ngModelChange)="apply()">
    </div>
    <div class="col-auto">
      <label class="form-label">执行时发送的回车符</label>
      <select class="form-select form-select-sm" [(ngModel)]="terminator" (ngModelChange)="apply()">
        <option value="cr">CR — 等同手动按回车（推荐）</option>
        <option value="lf">LF</option>
        <option value="crlf">CRLF</option>
      </select>
    </div>
  </div>
  <div class="mt-3">
    <button class="btn btn-primary" (click)="openManager()">打开命令管理器</button>
    <button class="btn btn-outline-secondary ms-2" (click)="clearHistory()">清空输入历史（{{ historyCount }} 条）</button>
  </div>
  <p class="text-muted mt-3">
    当前快捷键：输入条 <b>{{ hotkeyInput || '未设置' }}</b> · 管理器 <b>{{ hotkeyManager || '未设置' }}</b>
    （可在「设置 → 快捷键」里修改）
  </p>
  <small class="text-muted">
    兼容旧版 qc.cmds 数据；旧版的单命令快捷键、SSH Profile 绑定、使用次数排序、参数弹窗不会执行。
    多行命令现在整段发送，for / while / 续行 / heredoc 不会被拆散。
  </small>
</div>
`;
let QuickCmdsLiteSettingsTabComponent = class QuickCmdsLiteSettingsTabComponent {
    constructor(config, store, dockService, zone) {
        this.config = config;
        this.store = store;
        this.dockService = dockService;
        this.zone = zone;
        this.modalInstance = null;
        this.count = 0;
        this.groupCount = 0;
        this.historyCount = 0;
        this.dockEnabled = true;
        this.saveHistory = true;
        this.showHistory = true;
        this.maxSuggestions = 10;
        this.historySize = 30;
        this.terminator = 'cr';
        this.autoReturn = false;
        this.clickAction = 'send';
        this.fontSize = 14; this.inputHeight = 34; this.inputRatio = 60;
        this.aiBaseURL = ''; this.aiApiKey = ''; this.aiModel = 'auto'; this.aiProtocol = 'chat'; this.aiGroups = []; this.aiExcludedGroups = []; this.aiCandidateLimit = 50; this.aiIncludeHistory = false; this.aiStatus = '';
        this.hotkeyInput = '';
        this.hotkeyManager = '';
        this.changeSubscription = null;
        this.dockService.start();
    }
    ngOnInit() {
        this.store.initialize();
        this.readConfig();
        this.changeSubscription = this.config.changed$.subscribe(() => this.readConfig());
    }
    ngOnDestroy() {
        if (this.changeSubscription) {
            this.changeSubscription.unsubscribe();
            this.changeSubscription = null;
        }
    }
    readConfig() {
        const store = this.config.store;
        if (!store) {
            return;
        }
        const dock = this.dockService.qcDock(false) || {};
        const hotkeys = store.hotkeys || {};
        this.count = this.store.count();
        this.groupCount = this.store.groups().length;
        this.historyCount = Array.isArray(dock.history) ? dock.history.length : 0;
        this.dockEnabled = dock.enabled !== false;
        this.saveHistory = dock.saveHistory !== false;
        this.showHistory = dock.showHistory !== false;
        this.maxSuggestions = Number(dock.maxSuggestions) > 0 ? Number(dock.maxSuggestions) : 10;
        this.historySize = Number(dock.historySize) >= 0 ? Number(dock.historySize) : 500;
        this.terminator = dock.terminator || 'cr';
        this.autoReturn = store.qc?.autoReturn === true;
        this.clickAction = dock.clickAction === 'fill' ? 'fill' : 'send';
        this.fontSize = Number(dock.fontSize) >= 10 ? Number(dock.fontSize) : 14; this.inputHeight = Number(dock.inputHeight) >= 24 ? Number(dock.inputHeight) : 34; this.inputRatio = Number(dock.inputRatio) >= 20 ? Number(dock.inputRatio) : 60;
        const ai = ai_1.settings({ config: this.config }); this.aiBaseURL=ai.baseURL; this.aiApiKey=ai.apiKey; this.aiModel=ai.model; this.aiProtocol=ai.protocol; this.aiGroups=this.store.groups().concat(this.store.hasUngrouped() ? [''] : []); this.aiExcludedGroups=Array.isArray(ai.excludedGroups)?ai.excludedGroups.slice():[]; this.aiCandidateLimit=Number(ai.candidateLimit)||50; this.aiIncludeHistory=ai.includeHistory===true;
        this.hotkeyInput = (hotkeys.qc || []).join(' / ');
        this.hotkeyManager = (hotkeys['qc-manager'] || []).join(' / ');
    }
    apply() {
        const dock = this.dockService.qcDock(true);
        if (!dock) {
            return;
        }
        dock.enabled = this.dockEnabled;
        dock.saveHistory = this.saveHistory;
        dock.showHistory = this.showHistory;
        dock.maxSuggestions = Number(this.maxSuggestions) > 0 ? Number(this.maxSuggestions) : 10;
        dock.historySize = Number(this.historySize) >= 0 ? Number(this.historySize) : 500;
        dock.terminator = this.terminator;
        this.config.store.qc.autoReturn = this.autoReturn === true;
        dock.clickAction = this.clickAction === 'fill' ? 'fill' : 'send'; dock.fontSize = Math.max(10, Math.min(24, Number(this.fontSize)||14)); dock.inputHeight = Math.max(24, Math.min(80, Number(this.inputHeight)||34)); dock.inputRatio = Math.max(20, Math.min(90, Number(this.inputRatio)||60));
        this.config.save().catch(() => null);
        this.dockService.reconcileNow();
    }
    close() { if (this.modalInstance) this.modalInstance.close(); }
    toggleAiGroup(group, checked) { this.aiExcludedGroups = checked ? this.aiExcludedGroups.filter(x => x !== group) : Array.from(new Set(this.aiExcludedGroups.concat([group]))) }
    clearAiGroups() { this.aiExcludedGroups = this.aiGroups.slice() }
    selectAiGroups() { this.aiExcludedGroups = [] }
    saveAISettings() { const cfg = { baseURL: this.aiBaseURL, apiKey: this.aiApiKey, model: this.aiModel || 'auto', protocol: this.aiProtocol || 'chat', excludedGroups: this.aiExcludedGroups, candidateLimit: Math.max(10, Math.min(200, Number(this.aiCandidateLimit) || 50)), includeHistory: this.aiIncludeHistory === true }; ai_1.saveSettings({ config: this.config }, cfg); this.aiCandidateLimit = cfg.candidateLimit; }
    testAI() {
        const cfg = { baseURL: this.aiBaseURL, apiKey: this.aiApiKey, model: this.aiModel || 'auto', protocol: this.aiProtocol || 'chat' };
        this.aiStatus = '正在连接…';
        // request() 的回调（Node http）在 Angular 区域外，状态要显式带回 zone 里刷新；
        // 返回 promise 方便测试等待结果
        return ai_1.request(cfg, '只回答 OK', new AbortController().signal)
            .then(() => this.zone.run(() => { this.aiStatus = '连接成功' }))
            .catch(e => this.zone.run(() => { this.aiStatus = '连接失败：' + String(e && e.message ? e.message : e) }));
    }
    clearHistory() {
        this.dockService.clearHistory();
        this.config.save().catch(() => null);
        this.readConfig();
    }
    openManager() {
        this.dockService.openManager();
    }
};
QuickCmdsLiteSettingsTabComponent = __decorate([
    (0, core_1.Component)({
        selector: 'quick-cmds-lite-settings',
        template: SETTINGS_TEMPLATE,
    }),
    __metadata("design:paramtypes", [tabby_core_1.ConfigService,
        CommandStoreService,
        QuickCmdsLiteDockService,
        core_1.NgZone])
], QuickCmdsLiteSettingsTabComponent);
let QuickCmdsLiteSettingsTabProvider = class QuickCmdsLiteSettingsTabProvider extends tabby_settings_1.SettingsTabProvider {
    constructor() {
        super(...arguments);
        this.id = 'qc-lite';
        this.title = 'Quick Commands Lite';
        this.weight = 10;
    }
    getComponentType() {
        return QuickCmdsLiteSettingsTabComponent;
    }
};
QuickCmdsLiteSettingsTabProvider = __decorate([
    (0, core_1.Injectable)()
], QuickCmdsLiteSettingsTabProvider);
// ------------------------------------------------------------- 配置 / 快捷键
let QuickCmdsLiteConfigProvider = class QuickCmdsLiteConfigProvider extends tabby_core_1.ConfigProvider {
    constructor() {
        super(...arguments);
        this.defaults = {
            qc: {
                autoReturn: false,
                cmds: [],
                groups: [],
                dock: {
                    enabled: true,
                    maxSuggestions: 10,
                    historySize: 500,
                    history: [],
                    saveHistory: true,
                    showHistory: true,
                    terminator: 'cr',
                    clickAction: 'send',
                    fontSize: 14, inputHeight: 34, inputRatio: 60,
                },
            },
            hotkeys: {
                qc: ['Alt-Q'],
                'qc-manager': ['Alt-Shift-Q'],
            },
        };
        this.platformDefaults = {};
    }
};
QuickCmdsLiteConfigProvider = __decorate([
    (0, core_1.Injectable)()
], QuickCmdsLiteConfigProvider);
let QuickCmdsLiteHotkeyProvider = class QuickCmdsLiteHotkeyProvider extends tabby_core_1.HotkeyProvider {
    async provide() {
        return [
            { id: 'qc', name: 'Quick Commands Lite: 聚焦底部命令输入条' },
            { id: 'qc-manager', name: 'Quick Commands Lite: 打开命令管理器' },
        ];
    }
};
QuickCmdsLiteHotkeyProvider = __decorate([
    (0, core_1.Injectable)()
], QuickCmdsLiteHotkeyProvider);
// ---------------------------------------------------------------- 工具栏按钮
const DOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/></svg>`;
const LIST_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>`;
let QuickCmdsLiteButtonProvider = class QuickCmdsLiteButtonProvider {
    constructor(hotkeys, dockService) {
        this.hotkeys = hotkeys;
        this.dockService = dockService;
        // 先订阅快捷键再启动输入条：启动过程出问题也不影响快捷键
        this.hotkeys.hotkey$.subscribe(id => {
            if (id === 'qc') {
                this.dockService.focusDockInput();
            }
            else if (id === 'qc-manager') {
                this.dockService.openManager();
            }
        });
        this.dockService.start();
    }
    provide() {
        return [
            {
                icon: DOCK_ICON,
                weight: 5,
                title: '显示/隐藏快捷命令输入条（Alt+Q）',
                touchBarNSImage: 'NSTouchBarComposeTemplate',
                click: () => this.dockService.toggleEnabled(),
            },
            {
                icon: LIST_ICON,
                weight: 6,
                title: '打开命令管理器（Alt+Shift+Q）',
                click: () => this.dockService.openManager(),
            },
        ];
    }
};
QuickCmdsLiteButtonProvider = __decorate([
    (0, core_1.Injectable)(),
    __metadata("design:paramtypes", [tabby_core_1.HotkeysService,
        QuickCmdsLiteDockService])
], QuickCmdsLiteButtonProvider);
// -------------------------------------------------------------------- 模块
let QuickCmdsLiteModule = class QuickCmdsLiteModule {
};
QuickCmdsLiteModule = __decorate([
    (0, core_1.NgModule)({
        imports: [
            common_1.CommonModule,
            forms_1.FormsModule,
            ng_bootstrap_1.NgbModule,
            tabby_core_1.default,
        ],
        providers: [
            CommandStoreService,
            CommandExecutorService,
            QuickCmdsLiteDockService,
            { provide: tabby_core_1.ToolbarButtonProvider, useClass: QuickCmdsLiteButtonProvider, multi: true },
            { provide: tabby_core_1.ConfigProvider, useClass: QuickCmdsLiteConfigProvider, multi: true },
            { provide: tabby_core_1.HotkeyProvider, useClass: QuickCmdsLiteHotkeyProvider, multi: true },
            { provide: tabby_settings_1.SettingsTabProvider, useClass: QuickCmdsLiteSettingsTabProvider, multi: true },
        ],
        declarations: [
            QuickCmdsLiteModalComponent,
            QuickCmdsLiteOrganizerComponent,
            QuickCmdsLiteSettingsTabComponent,
        ],
        entryComponents: [
            QuickCmdsLiteModalComponent,
            QuickCmdsLiteOrganizerComponent,
            QuickCmdsLiteSettingsTabComponent,
        ],
    })
], QuickCmdsLiteModule);
exports.default = QuickCmdsLiteModule;
// 仅用于离线测试（Tabby 只使用上面的 default 导出）
exports.__internals = {
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
};


