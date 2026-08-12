declare module '@angular/core' {
  export interface OnInit { ngOnInit(): void }
  export interface OnDestroy { ngOnDestroy(): void }
  export const ChangeDetectionStrategy: { OnPush: any }
  export class ChangeDetectorRef { markForCheck(): void }
  export function Component(meta: any): ClassDecorator
  export function Injectable(meta?: any): ClassDecorator
  export function NgModule(meta: any): ClassDecorator
}

declare module '@angular/common' { export class CommonModule {} }
declare module '@angular/forms' { export class FormsModule {} }

declare module '@ng-bootstrap/ng-bootstrap' {
  export class NgbActiveModal { close(result?: any): void }
  export class NgbModal { open(component: any, options?: any): any }
  export class NgbModule {}
}

declare module 'tabby-core' {
  export default class TabbyCoreModule {}
  export class BaseTabComponent { title?: string; emitFocused?(): void }
  export class SplitTabComponent extends BaseTabComponent { getFocusedTab(): BaseTabComponent }
  export class AppService { activeTab: BaseTabComponent }
  export class ConfigService { store: any; save(): void }
  export class ConfigProvider { defaults: any; platformDefaults: any }
  export class ToolbarButtonProvider { provide(): IToolbarButton[] }
  export interface IToolbarButton { icon: string; weight?: number; title?: string; touchBarNSImage?: string; click?: () => any }
  export class HotkeysService { matchedHotkey: { subscribe(fn: (hotkey: string) => void): any } }
}

declare module 'tabby-settings' {
  export class SettingsTabProvider { id: string; title: string; getComponentType(): any }
}

declare module 'tabby-terminal' {
  import { BaseTabComponent } from 'tabby-core'
  export class BaseTerminalTabComponent extends BaseTabComponent { title: string; sendInput(data: string): Promise<any> }
}
