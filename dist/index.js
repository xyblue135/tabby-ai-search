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
let CommandStoreService = class CommandStoreService {
    constructor(config) {
        this.config = config;
        this.source = null;
        this.index = [];
        this.groupCache = [];
    }
    ensureStore() {
        const store = this.config.store;
        if (!store.aic) {
            store.aic = { cmds: [], groups: [] };
        }
        if (!Array.isArray(store.aic.cmds)) {
            store.aic.cmds = [];
        }
        if (!Array.isArray(store.aic.groups)) {
            store.aic.groups = [];
        }
        if (this.source !== store.aic.cmds) {
            this.source = store.aic.cmds;
            this.rebuildIndex(false);
        }
        return this.source;
    }
    makeId() {
        return `aic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    }
    rebuildIndex(persistIds) {
        const commands = this.source || [];
        let changed = false;
        this.index = commands.map((cmd) => {
            if (!cmd.id) {
                cmd.id = this.makeId();
                changed = true;
            }
            cmd.group = cmd.group || '';
            cmd.appendCR = cmd.appendCR !== false;
            const search = `${cmd.name || ''}\n${cmd.group || ''}\n${cmd.text || ''}`.toLocaleLowerCase();
            return { cmd, search };
        });
        const groups = new Set();
        for (const item of this.index) {
            if (item.cmd.group) {
                groups.add(item.cmd.group);
            }
        }
        this.groupCache = Array.from(groups).sort((a, b) => a.localeCompare(b));
        if (changed && persistIds) {
            this.config.save();
        }
    }
    initialize() {
        this.ensureStore();
        // Persist stable IDs once. This is the only migration performed.
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
    search(query, group, limit) {
        this.ensureStore();
        const q = (query || '').trim().toLocaleLowerCase();
        const items = [];
        let total = 0;
        for (const entry of this.index) {
            if (group !== null && (entry.cmd.group || '') !== group) {
                continue;
            }
            if (q && !entry.search.includes(q)) {
                continue;
            }
            total++;
            if (items.length < limit) {
                items.push(entry.cmd);
            }
        }
        return { items, total };
    }
    upsert(draft, original) {
        const commands = this.ensureStore();
        if (original) {
            Object.assign(original, {
                name: draft.name,
                text: draft.text,
                group: draft.group || '',
                appendCR: draft.appendCR !== false,
            });
        }
        else {
            commands.push({
                id: this.makeId(),
                name: draft.name,
                text: draft.text,
                group: draft.group || '',
                appendCR: draft.appendCR !== false,
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
let CommandExecutorService = class CommandExecutorService {
    constructor(app) {
        this.app = app;
    }
    async send(command) {
        if (!this.app.activeTab) {
            return;
        }
        await this.sendToTab(this.app.activeTab, command);
    }
    async sendToTab(tab, command) {
        if (tab instanceof tabby_core_1.SplitTabComponent) {
            const focused = tab.getFocusedTab();
            if (focused) {
                await this.sendToTab(focused, command);
            }
            return;
        }
        if (!(tab instanceof tabby_terminal_1.BaseTerminalTabComponent)) {
            return;
        }
        const terminal = tab;
        const title = (terminal.title || '').toLocaleLowerCase();
        const terminator = title.includes('cmd.exe') || title.includes('powershell') ? '\r\n' : '\n';
        const decodeControl = (text) => text.replace(/\\x([0-9a-f]{2})/ig, (_, pair) => String.fromCharCode(parseInt(pair, 16)));
        if (command.appendCR === false) {
            await terminal.sendInput(decodeControl(command.text || ''));
            return;
        }
        const lines = (command.text || '').split(/(?:\r\n|\r|\n)/);
        for (let line of lines) {
            if (!line) {
                continue;
            }
            if (line.startsWith('\\s')) {
                const delay = Number.parseInt(line.slice(2), 10);
                if (Number.isFinite(delay) && delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, Math.min(delay, 60000)));
                }
                continue;
            }
            line = decodeControl(line);
            await terminal.sendInput(line);
            await new Promise(resolve => setTimeout(resolve, 20));
            await terminal.sendInput(terminator);
        }
    }
};
CommandExecutorService = __decorate([
    (0, core_1.Injectable)(),
    __metadata("design:paramtypes", [tabby_core_1.AppService])
], CommandExecutorService);
const MODAL_TEMPLATE = `
<div class="aic-shell">
  <div class="aic-header">
    <div>
      <div class="aic-title">AI Commands</div>
      <div class="aic-subtitle">AI 命令收藏夹 · {{ total }} 条匹配</div>
    </div>
    <button class="btn btn-sm btn-outline-secondary" type="button" (click)="close()">关闭</button>
  </div>

  <div class="aic-toolbar">
    <input class="form-control" type="text" autofocus [(ngModel)]="query"
      (ngModelChange)="onQueryChanged($event)" (keyup.enter)="runFirst()"
      placeholder="搜索名称 / 分组 / 命令内容...">
    <button class="btn btn-primary" type="button" (click)="newCommand()">+ 新增</button>
  </div>

  <div class="aic-layout">
    <div class="aic-groups">
      <button class="aic-group" [class.active]="activeGroup === null" (click)="selectGroup(null)">全部</button>
      <button class="aic-group" *ngFor="let group of groups; trackBy: trackGroup"
        [class.active]="activeGroup === group" (click)="selectGroup(group)">{{ group }}</button>
      <button class="aic-group" [class.active]="activeGroup === ''" (click)="selectGroup('')">未分组</button>
    </div>

    <div class="aic-main">
      <div class="aic-editor" *ngIf="editing">
        <div class="aic-editor-grid">
          <label>名称<input class="form-control" [(ngModel)]="draft.name" placeholder="例如：查看 Docker 容器"></label>
          <label>分组<input class="form-control" [(ngModel)]="draft.group" placeholder="例如：Docker"></label>
        </div>
        <label>命令<textarea class="form-control aic-textarea" rows="5" [(ngModel)]="draft.text" placeholder="docker ps -a"></textarea></label>
        <label class="aic-check"><input type="checkbox" [(ngModel)]="draft.appendCR"> 执行后自动回车</label>
        <div class="aic-editor-actions">
          <button class="btn btn-sm btn-primary" type="button" (click)="saveDraft()" [disabled]="!canSave()">保存</button>
          <button class="btn btn-sm btn-outline-secondary" type="button" (click)="cancelEdit()">取消</button>
        </div>
      </div>

      <div class="aic-empty" *ngIf="!editing && results.length === 0">没有匹配的命令</div>

      <div class="aic-list" *ngIf="results.length">
        <div class="aic-row" *ngFor="let cmd of results; trackBy: trackCommand" (click)="run(cmd)">
          <div class="aic-row-content">
            <div class="aic-name">{{ cmd.name || '未命名命令' }}</div>
            <div class="aic-meta">{{ cmd.group || '未分组' }}</div>
            <code>{{ preview(cmd.text) }}</code>
          </div>
          <div class="aic-actions">
            <button class="btn btn-sm btn-outline-secondary" type="button" title="复制" (click)="copy(cmd, $event)">复制</button>
            <button class="btn btn-sm btn-outline-secondary" type="button" title="编辑" (click)="editCommand(cmd, $event)">编辑</button>
            <button class="btn btn-sm btn-outline-danger" type="button" title="删除" (click)="deleteCommand(cmd, $event)">删除</button>
          </div>
        </div>
      </div>

      <button class="btn btn-sm btn-outline-secondary aic-more" *ngIf="results.length < total" (click)="showMore()">
        显示更多（当前 {{ results.length }} / {{ total }}）
      </button>
    </div>
  </div>
</div>
`;
const MODAL_STYLES = `
:host { display: block; }
.aic-shell { min-height: 560px; display: flex; flex-direction: column; }
.aic-header { display:flex; justify-content:space-between; align-items:center; padding:16px 18px 10px; border-bottom:1px solid rgba(127,127,127,.2); }
.aic-title { font-size:18px; font-weight:600; }
.aic-subtitle { font-size:12px; opacity:.65; margin-top:2px; }
.aic-toolbar { display:grid; grid-template-columns:1fr auto; gap:8px; padding:12px 18px; }
.aic-layout { display:grid; grid-template-columns:150px minmax(0,1fr); flex:1; min-height:0; border-top:1px solid rgba(127,127,127,.15); }
.aic-groups { padding:10px; overflow:auto; border-right:1px solid rgba(127,127,127,.18); max-height:620px; }
.aic-group { display:block; width:100%; border:0; background:transparent; color:inherit; text-align:left; padding:8px 10px; border-radius:6px; margin-bottom:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.aic-group:hover, .aic-group.active { background:rgba(127,127,127,.16); }
.aic-main { padding:10px 14px 16px; overflow:auto; max-height:620px; }
.aic-list { display:flex; flex-direction:column; gap:6px; }
.aic-row { display:flex; gap:12px; align-items:center; padding:10px 12px; border:1px solid rgba(127,127,127,.2); border-radius:8px; cursor:pointer; }
.aic-row:hover { background:rgba(127,127,127,.08); }
.aic-row-content { min-width:0; flex:1; }
.aic-name { font-weight:600; }
.aic-meta { font-size:11px; opacity:.6; margin:2px 0 5px; }
.aic-row code { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:inherit; opacity:.8; }
.aic-actions { display:flex; gap:5px; flex-shrink:0; }
.aic-editor { padding:12px; margin-bottom:10px; border:1px solid rgba(127,127,127,.25); border-radius:8px; background:rgba(127,127,127,.05); }
.aic-editor-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.aic-editor label { display:block; font-size:12px; margin-bottom:8px; }
.aic-editor label input, .aic-editor label textarea { margin-top:4px; }
.aic-textarea { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.aic-check { display:flex !important; align-items:center; gap:7px; }
.aic-editor-actions { display:flex; gap:8px; }
.aic-empty { text-align:center; opacity:.6; padding:50px 10px; }
.aic-more { width:100%; margin-top:10px; }
@media (max-width: 760px) {
  .aic-layout { grid-template-columns:1fr; }
  .aic-groups { display:flex; gap:4px; border-right:0; border-bottom:1px solid rgba(127,127,127,.18); max-height:none; overflow-x:auto; }
  .aic-group { width:auto; flex:0 0 auto; }
  .aic-row { align-items:flex-start; }
  .aic-actions { flex-direction:column; }
  .aic-editor-grid { grid-template-columns:1fr; }
}
`;
let AiCmdsModalComponent = class AiCmdsModalComponent {
    constructor(modalInstance, store, executor, app, cdr) {
        this.modalInstance = modalInstance;
        this.store = store;
        this.executor = executor;
        this.app = app;
        this.cdr = cdr;
        this.query = '';
        this.activeGroup = null;
        this.groups = [];
        this.results = [];
        this.total = 0;
        this.limit = 150;
        this.editing = false;
        this.draft = { name: '', text: '', group: '', appendCR: true };
        this.searchTimer = null;
    }
    ngOnInit() {
        this.store.initialize();
        this.groups = this.store.groups();
        this.refresh();
    }
    ngOnDestroy() {
        if (this.searchTimer) {
            clearTimeout(this.searchTimer);
        }
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
        this.activeGroup = group;
        this.limit = 150;
        this.refresh();
    }
    refresh() {
        const found = this.store.search(this.query, this.activeGroup, this.limit);
        this.results = found.items;
        this.total = found.total;
        this.groups = this.store.groups();
        this.cdr.markForCheck();
    }
    showMore() {
        this.limit += 200;
        this.refresh();
    }
    async run(cmd) {
        await this.executor.send(cmd);
        this.close();
    }
    runFirst() {
        if (this.results.length) {
            this.run(this.results[0]);
        }
    }
    preview(text) {
        return (text || '').replace(/\s+/g, ' ').slice(0, 220);
    }
    newCommand() {
        this.editingOriginal = undefined;
        this.draft = { name: '', text: this.query || '', group: this.activeGroup || '', appendCR: true };
        this.editing = true;
        this.cdr.markForCheck();
    }
    editCommand(cmd, event) {
        event.stopPropagation();
        this.editingOriginal = cmd;
        this.draft = {
            id: cmd.id,
            name: cmd.name || '',
            text: cmd.text || '',
            group: cmd.group || '',
            appendCR: cmd.appendCR !== false,
        };
        this.editing = true;
        this.cdr.markForCheck();
    }
    cancelEdit() {
        this.editing = false;
        this.editingOriginal = undefined;
        this.cdr.markForCheck();
    }
    canSave() {
        return !!(this.draft.name && this.draft.name.trim() && this.draft.text && this.draft.text.trim());
    }
    saveDraft() {
        if (!this.canSave()) {
            return;
        }
        this.draft.name = this.draft.name.trim();
        this.draft.group = (this.draft.group || '').trim();
        this.store.upsert(this.draft, this.editingOriginal);
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
    }
    copy(cmd, event) {
        var _a;
        event.stopPropagation();
        if ((_a = navigator.clipboard) === null || _a === void 0 ? void 0 : _a.writeText) {
            navigator.clipboard.writeText(cmd.text || '');
        }
    }
    close() {
        this.modalInstance.close();
        const active = this.app.activeTab;
        if (active === null || active === void 0 ? void 0 : active.emitFocused) {
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
AiCmdsModalComponent = __decorate([
    (0, core_1.Component)({
        selector: 'ai-cmds-modal',
        template: MODAL_TEMPLATE,
        styles: [MODAL_STYLES],
        changeDetection: core_1.ChangeDetectionStrategy.OnPush,
    }),
    __metadata("design:paramtypes", [ng_bootstrap_1.NgbActiveModal,
        CommandStoreService,
        CommandExecutorService,
        tabby_core_1.AppService,
        core_1.ChangeDetectorRef])
], AiCmdsModalComponent);
let AiCmdsSettingsTabComponent = class AiCmdsSettingsTabComponent {
    constructor(modal, store) {
        this.modal = modal;
        this.store = store;
        this.count = 0;
    }
    ngOnInit() {
        this.store.initialize();
        this.count = this.store.count();
    }
    openManager() {
        this.modal.open(AiCmdsModalComponent, { size: 'lg', centered: true });
    }
};
AiCmdsSettingsTabComponent = __decorate([
    (0, core_1.Component)({
        selector: 'ai-cmds-settings',
        template: `
      <div class="settings-tab">
        <h3>AI Commands</h3>
        <p>AI 命令管理插件（轻量版）。提供命令收藏、分组、搜索、增删改，并在当前终端一键执行。</p>
        <p><b>Alt + Q</b> 打开命令面板。当前读取到 <b>{{ count }}</b> 条命令。</p>
        <button class="btn btn-primary" (click)="openManager()">打开命令管理器</button>
        <hr>
        <small class="text-muted">兼容早期 quick-command 插件的 qc.cmds 数据；shortcut、SSH 绑定、使用次数排序和参数弹窗等旧特性不执行。</small>
      </div>
    `,
    }),
    __metadata("design:paramtypes", [ng_bootstrap_1.NgbModal, CommandStoreService])
], AiCmdsSettingsTabComponent);
let AiCmdsSettingsTabProvider = class AiCmdsSettingsTabProvider extends tabby_settings_1.SettingsTabProvider {
    constructor() {
        super(...arguments);
        this.id = 'ai-cmds';
        this.title = 'AI Commands';
    }
    getComponentType() {
        return AiCmdsSettingsTabComponent;
    }
};
AiCmdsSettingsTabProvider = __decorate([
    (0, core_1.Injectable)()
], AiCmdsSettingsTabProvider);
let AiCmdsConfigProvider = class AiCmdsConfigProvider extends tabby_core_1.ConfigProvider {
    constructor() {
        super(...arguments);
        this.defaults = {
            aic: {
                cmds: [],
                groups: [],
            },
            hotkeys: {
                aic: ['Alt-Q'],
            },
        };
        this.platformDefaults = {};
    }
};
AiCmdsConfigProvider = __decorate([
    (0, core_1.Injectable)()
], AiCmdsConfigProvider);
let AiCmdsButtonProvider = class AiCmdsButtonProvider extends tabby_core_1.ToolbarButtonProvider {
    constructor(modal, hotkeys) {
        super();
        this.modal = modal;
        this.hotkeys = hotkeys;
        this.icon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/></svg>`;
        this.hotkeys.matchedHotkey.subscribe((hotkey) => {
            if (hotkey === 'aic') {
                this.activate();
            }
        });
    }
    activate() {
        this.modal.open(AiCmdsModalComponent, { size: 'lg', centered: true });
    }
    provide() {
        return [{
                icon: this.icon,
                weight: 5,
                title: 'AI Commands',
                touchBarNSImage: 'NSTouchBarComposeTemplate',
                click: async () => this.activate(),
            }];
    }
};
AiCmdsButtonProvider = __decorate([
    (0, core_1.Injectable)(),
    __metadata("design:paramtypes", [ng_bootstrap_1.NgbModal, tabby_core_1.HotkeysService])
], AiCmdsButtonProvider);
let AiCmdsModule = class AiCmdsModule {
};
AiCmdsModule = __decorate([
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
            { provide: tabby_core_1.ToolbarButtonProvider, useClass: AiCmdsButtonProvider, multi: true },
            { provide: tabby_core_1.ConfigProvider, useClass: AiCmdsConfigProvider, multi: true },
            { provide: tabby_settings_1.SettingsTabProvider, useClass: AiCmdsSettingsTabProvider, multi: true },
        ],
        declarations: [
            AiCmdsModalComponent,
            AiCmdsSettingsTabComponent,
        ],
        entryComponents: [
            AiCmdsModalComponent,
            AiCmdsSettingsTabComponent,
        ],
    })
], AiCmdsModule);
exports.default = AiCmdsModule;
