import { Config, CONVENTIONAL_TEMPLATE, CONVENTIONAL_TYPES, DEFAULT_TEMPLATE, FIELDS, Values } from './model';
import { conventionalFields, fieldLabel, FieldLayout, formatFields, isOriginalLayout, legacyFields, normalizeLayout, resolveLayout, versionedFields } from './fields';
import { isChinese } from './i18n';

export const editorEnglish = {
  title: 'Configure Commit Fields', subtitle: 'Shape your commit flow. Keep everyday commits simple.',
  scope: 'Save configuration to', user: 'User settings', workspace: 'Workspace settings', folder: 'Folder settings',
  add: 'Add field', save: 'Save changes', reload: 'Reload saved settings', reset: 'Restore original fields',
  conventional: 'Rule 1 · Conventional Commits', versioned: 'Rule 2 · Versioned commits',
  rulesHint: 'Rule 1 is the default: type, optional scope, description. Rule 2 uses Chinese types: type, version, module, description. Choosing a rule replaces the fields in this editor; save to apply.',
  label: 'Field name', id: 'Stable ID', input: 'Input', suggest: 'Suggestions + custom value', text: 'Free text',
  enabled: 'Enabled', required: 'Required', remember: 'Remember used values', options: 'Suggestions (one per line)',
  defaultValue: 'Default value', prefix: 'Prefix', suffix: 'Suffix', up: 'Move up', down: 'Move down', remove: 'Delete field',
  preview: 'Output preview', previewHint: 'Uses defaults or first suggestions; other values are illustrative.',
  automatic: 'Build output automatically from enabled fields', template: 'Output template',
  templateHint: 'Use each enabled field ID once, e.g. {type}. Empty optional fields omit their configured prefix and suffix.',
  autoHint: 'Fields are joined in order. Empty optional fields omit their entire segment.',
  saved: 'Saved. The next commit will use these fields.', dirty: 'Unsaved changes', loading: 'Loading…',
  legacy: 'Base fields: using your configured types, scopes and output template.',
  customized: 'Custom fields: suggestions, defaults and formatting are managed here.',
  switchDirty: 'Save changes or reload saved settings before switching the save location.',
  conflict: 'Settings changed outside this editor. Reload saved settings before saving again.',
  invalidScope: 'This save location is unavailable.', saveFailed: 'Could not save settings: ',
  newField: 'New field', empty: 'Add at least one enabled, required field.',
  unsavedClose: 'Closing this page discards unsaved changes.',
  help: 'Rename, reorder, disable or delete fields here. Daily commits still use step-by-step input.',
  optionsHint: 'Deleting a suggestion here removes it from configuration. Previously used values can still appear from history.',
  resetHint: 'Restores fields from your base settings after Save. Defaults use Conventional Commits; explicit older templates are preserved. Usage history is kept.',
  scopeHint: 'Folder settings apply to this folder; workspace settings apply to this workspace; user settings apply to all projects. More specific settings take precedence.'
};
export function editorStrings(language?: string): Record<keyof typeof editorEnglish, string> {
  if (!isChinese(language)) return { ...editorEnglish };
  return {
    title: '配置提交字段', subtitle: '按项目配置填写项，日常提交依旧简单。',
    scope: '保存位置', user: '用户设置', workspace: '工作区设置', folder: '文件夹设置',
    add: '添加字段', save: '保存修改', reload: '重新载入已保存配置', reset: '恢复原有字段',
    conventional: '规则1 · 约定式提交', versioned: '规则2 · 版本提交',
    rulesHint: '默认规则1：类型、模块（选填）、描述。规则2使用中文类型：类型、版本、模块、描述。点击规则覆盖当前编辑内容，保存后生效。',
    label: '字段名称', id: '固定标识', input: '输入方式', suggest: '候选 + 自定义输入', text: '自由输入',
    enabled: '启用', required: '必填', remember: '记住用过的值', options: '候选值（每行一个）',
    defaultValue: '默认值', prefix: '前缀', suffix: '后缀', up: '上移', down: '下移', remove: '删除字段',
    preview: '输出预览', previewHint: '优先使用默认值或首个候选，其他值为示例。',
    automatic: '根据启用字段自动拼接输出', template: '输出模板',
    templateHint: '每个启用字段的标识使用一次，例如 {type}。选填为空时连同该字段的前后缀一起省略。',
    autoHint: '按字段顺序拼接，选填为空时不输出该字段及其前后缀。',
    saved: '已保存，下次提交将使用这些字段。', dirty: '尚未保存', loading: '正在加载…',
    legacy: '基础字段模式：沿用现有类型、模块候选及输出模板。',
    customized: '自定义字段模式：候选、默认值和格式在此管理。',
    switchDirty: '请先保存修改或重新载入，再切换保存位置。',
    conflict: '配置已在其他位置修改，请重新载入后再保存。',
    invalidScope: '此保存位置不可用。', saveFailed: '保存配置失败：',
    newField: '新字段', empty: '请至少保留一个启用且必填的字段。',
    unsavedClose: '关闭页面会丢弃未保存的修改。',
    help: '可以修改、排序、停用或删除字段；日常提交仍是逐项输入、回车下一项。',
    optionsHint: '此处删除的是配置候选；以前用过的值仍可能从历史记录出现。',
    resetHint: '保存后恢复基础设置中的字段；默认使用约定式提交，明确设置的旧模板仍保留。使用历史保留。',
    scopeHint: '文件夹设置只作用于该文件夹，工作区设置作用于当前工作区，用户设置作用于所有项目；更具体的设置优先。'
  };
}
export type SaveScope = 'user' | 'workspace' | 'folder';
export interface EditorSnapshot { config: Config; revision: string; source: string }
export interface FieldEditorServices {
  language?: string;
  scopes: { id: SaveScope; label: string }[];
  initialScope: SaveScope;
  read(scope: SaveScope): EditorSnapshot;
  write(scope: SaveScope, layout: FieldLayout | null): Promise<void>;
}

export class FieldEditorSession {
  private scope?: SaveScope;
  private snapshot?: EditorSnapshot;
  private busy = false;
  private strings;
  constructor(private services: FieldEditorServices, private send: (message: unknown) => void) {
    this.strings = editorStrings(services.language);
  }
  private load(scope: SaveScope) {
    if (!this.services.scopes.some(item => item.id === scope)) throw new Error(this.strings.invalidScope);
    const snapshot = this.services.read(scope);
    this.scope = scope;
    this.snapshot = snapshot;
    const fields = legacyFields(snapshot.config);
    let selected = isOriginalLayout(snapshot.config.fieldLayout) ? null : snapshot.config.fieldLayout;
    let warning = '';
    if (selected) {
      try { selected = normalizeLayout(selected, this.services.language); }
      catch (error) { warning = error instanceof Error ? error.message : String(error); selected = null; }
    }
    this.send({ kind: 'loaded', scope, source: snapshot.source, scopes: this.services.scopes, strings: this.strings,
      fields: selected?.fields ?? fields, warning,
      template: selected?.template ?? (selected ? null : snapshot.config.template),
      original: !selected, defaults: fields,
      conventionalDefaults: conventionalFields({ ...snapshot.config, types: [...CONVENTIONAL_TYPES] }),
      versionedDefaults: versionedFields(snapshot.config),
      automatic: selected ? selected.template === null : [DEFAULT_TEMPLATE, CONVENTIONAL_TEMPLATE].includes(snapshot.config.template),
      defaultsTemplate: snapshot.config.template, defaultsAutomatic: [DEFAULT_TEMPLATE, CONVENTIONAL_TEMPLATE].includes(snapshot.config.template),
      labels: Object.fromEntries(FIELDS.map(id => [id, fieldLabel({ ...fields[0], id, label: '' }, this.services.language)]))
    });
  }
  async handle(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as Record<string, unknown>;
    if (!['ready', 'load', 'preview', 'save'].includes(String(message.kind))) return;
    if (this.busy) return;
    try {
      if (message.kind === 'ready') { this.load(this.services.initialScope); return; }
      if (message.kind === 'load') { this.load(message.scope as SaveScope); return; }
      if (!this.snapshot || !this.scope || message.scope !== this.scope) throw new Error(this.strings.invalidScope);
      const restoring = message.restore === true;
      const layout = restoring ? null : normalizeLayout(message.layout as FieldLayout, this.services.language);
      const config = { ...this.snapshot.config, fieldLayout: layout };
      const resolved = resolveLayout(config, this.services.language);
      if (message.kind === 'preview') {
        const examples: Values = Object.fromEntries(resolved.fields.filter(field => field.enabled).map(field => [field.id, field.defaultValue || field.options[0] || fieldLabel(field, this.services.language)]));
        this.send({ kind: 'preview', request: message.request, text: formatFields(examples, resolved, this.services.language) });
        return;
      }
      if (this.services.read(this.scope).revision !== this.snapshot.revision) throw new Error(this.strings.conflict);
      this.busy = true;
      await this.services.write(this.scope, layout);
      this.load(this.scope);
      this.send({ kind: 'saved', message: this.strings.saved });
    } catch (error) {
      this.send({ kind: message.kind === 'preview' ? 'previewError' : 'error', request: message.request, message: error instanceof Error ? error.message : String(error) });
    } finally { this.busy = false; }
  }
}
