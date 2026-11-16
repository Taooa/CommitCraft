import { candidates, Config, CONVENTIONAL_TEMPLATE, DEFAULT_TEMPLATE, Field, FIELDS, Values } from './model';
import { translate } from './i18n';

export interface CommitField {
  id: string;
  label: string;
  input: 'suggest' | 'text';
  enabled: boolean;
  required: boolean;
  remember: boolean;
  options: string[];
  defaultValue: string;
  prefix: string;
  suffix: string;
}
export interface FieldLayout { fields: CommitField[]; template: string | null }
export interface ResolvedLayout { fields: CommitField[]; template: string }
export const VERSIONED_TYPES = ['新增', '修复', '文档', '格式', '重构', '优化', '测试', '构建', '集成', '维护', '回退'];
export const VERSIONED_VERSIONS = ['1.0.0', '1.5.0', '2.0.0', '2.5.0', '3.0.0', '3.5.0', '4.0.0', '4.5.0'];
export function versionedFields(config: Config): CommitField[] {
  return legacyFields({ ...config, template: DEFAULT_TEMPLATE, types: [...VERSIONED_TYPES], versions: [...VERSIONED_VERSIONS], defaultVersion: VERSIONED_VERSIONS[0] });
}
export function isOriginalLayout(layout: unknown): boolean {
  return layout == null || (typeof layout === 'object' && !Array.isArray(layout) && Object.keys(layout).length === 0);
}
const control = /[\r\n\u2028\u2029\x00-\x1f\x7f]/u;
export const validId = (id: string): boolean => /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(id) && !['constructor', 'prototype', '__proto__'].includes(id);
export function fieldLabel(field: CommitField, language?: string): string {
  return field.label.trim() || (FIELDS.includes(field.id as Field) ? translate(language, field.id as Field) : field.id);
}

export function legacyFields(config: Config): CommitField[] {
  if (config.template === CONVENTIONAL_TEMPLATE) return conventionalFields(config);
  return FIELDS.map(id => ({
    id, label: '', input: id === 'description' ? 'text' : 'suggest', enabled: true, required: true,
    remember: id !== 'description', options: id === 'type' ? config.types : id === 'version' ? config.versions : id === 'module' ? config.modules : [],
    defaultValue: id === 'type' ? config.types[0] ?? '' : id === 'version' ? config.defaultVersion : '',
    prefix: id === 'description' ? '' : '【', suffix: id === 'description' ? '' : '】'
  }));
}

export function conventionalFields(config: Config): CommitField[] {
  return ['type', 'module', 'description'].map(id => ({
    id, label: '', input: id === 'description' ? 'text' : 'suggest', enabled: true,
    required: id !== 'module', remember: id !== 'description',
    options: id === 'type' ? config.types : id === 'module' ? config.modules : [],
    defaultValue: '', prefix: id === 'module' ? '(' : id === 'description' ? ': ' : '', suffix: id === 'module' ? ')' : ''
  }));
}

export function validateFieldValue(field: CommitField, value: string, language?: string): string | undefined {
  if (control.test(value)) return translate(language, 'singleLine');
  if (!value.trim()) return field.required ? translate(language, 'required') : undefined;
  if ((field.prefix.includes('【') || field.suffix.includes('】')) && /[【】]/u.test(value)) return translate(language, 'fieldBrackets');
  if (field.id === 'module' && field.prefix === '(' && field.suffix === ')' && /[():!]/u.test(value)) return translate(language, 'scopeCharacters');
  return undefined;
}

export function validateLayout(raw: unknown, language?: string): asserts raw is FieldLayout {
  const fail = (reason: string): never => { throw new Error(translate(language, 'layoutInvalid', reason)); };
  if (!raw || typeof raw !== 'object') fail(translate(language, 'layoutObject'));
  const layout = raw as FieldLayout;
  if (!Array.isArray(layout.fields) || layout.fields.length < 1 || layout.fields.length > 30) fail(translate(language, 'layoutCount'));
  if (layout.template !== null && typeof layout.template !== 'string') fail(translate(language, 'layoutTemplate'));
  const ids = new Set<string>();
  for (const field of layout.fields) {
    if (!field || typeof field !== 'object' || typeof field.id !== 'string' || !validId(field.id) || ids.has(field.id)) fail(translate(language, 'layoutIds'));
    ids.add(field.id);
    if (typeof field.label !== 'string' || control.test(field.label) || field.label.length > 100 || (!field.label.trim() && !FIELDS.includes(field.id as Field))) fail(translate(language, 'layoutLabel'));
    if (!['suggest', 'text'].includes(field.input) || ['enabled', 'required', 'remember'].some(key => typeof field[key as 'enabled'] !== 'boolean')) fail(translate(language, 'layoutProperties'));
    if (['prefix', 'suffix', 'defaultValue'].some(key => typeof field[key as 'prefix'] !== 'string' || control.test(field[key as 'prefix']))) fail(translate(language, 'layoutSingleLine'));
    if (!Array.isArray(field.options) || field.options.some(value => typeof value !== 'string' || !value.trim() || control.test(value))) fail(translate(language, 'layoutOptions'));
    // Required fields may start blank, but nonempty defaults and candidates must be usable.
    const candidateField = { ...field, required: false };
    for (const value of [field.defaultValue, ...field.options]) {
      const error = validateFieldValue(candidateField, value, language);
      if (error) fail(`${fieldLabel(field, language)}: ${error}`);
    }
    if (/[{}]/u.test(field.prefix + field.suffix)) fail(translate(language, 'layoutAffixes'));
  }
  if (!layout.fields.some(field => field.enabled && field.required)) fail(translate(language, 'layoutRequired'));
  if (layout.template !== null) validateFieldTemplate(layout.template, layout.fields, language);
}

export function validateFieldTemplate(template: string, fields: CommitField[], language?: string): void {
  if (control.test(template)) throw new Error(translate(language, 'templateLine'));
  const tokens = [...template.matchAll(/\{([^{}]*)\}/gu)].map(match => match[1]);
  if (tokens.some(id => !fields.some(field => field.id === id))) throw new Error(translate(language, 'templateUnknown'));
  for (const field of fields) {
    const count = tokens.filter(id => id === field.id).length;
    if ((field.enabled && count !== 1) || count > 1) throw new Error(translate(language, 'templateField', `{${field.id}}`));
  }
}

export function resolveLayout(config: Config, language?: string): ResolvedLayout {
  if (!isOriginalLayout(config.fieldLayout)) {
    const custom = config.fieldLayout;
    validateLayout(custom, language);
    const fields = custom.fields;
    const template = custom.template ?? fields.filter(field => field.enabled).map(field => `${field.prefix}{${field.id}}${field.suffix}`).join('');
    return { fields, template };
  }
  const fields = legacyFields(config);
  validateFieldTemplate(config.template ?? DEFAULT_TEMPLATE, fields, language);
  return { fields, template: config.template ?? DEFAULT_TEMPLATE };
}

export function formatFields(values: Values, layout: ResolvedLayout, language?: string): string {
  validateFieldTemplate(layout.template, layout.fields, language);
  if (layout.template === CONVENTIONAL_TEMPLATE && !/^[a-zA-Z]+!?$/u.test((values.type ?? '').trim())) throw new Error(translate(language, 'conventionalType'));
  let template = layout.template;
  for (const field of layout.fields) {
    if (field.enabled) {
      const error = validateFieldValue(field, values[field.id] ?? '', language);
      if (error) throw new Error(`${fieldLabel(field, language)}: ${error}`);
    }
    if (!field.enabled || !(values[field.id] ?? '').trim()) {
      // Remove the whole configured segment, including brackets, for skipped fields.
      template = template.split(`${field.prefix}{${field.id}}${field.suffix}`).join('');
    }
  }
  const enabled = new Set(layout.fields.filter(field => field.enabled).map(field => field.id));
  const output = template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (_, id: string) => enabled.has(id) ? (values[id] ?? '').trim() : '');
  return layout.template === CONVENTIONAL_TEMPLATE ? output.replace(/^([a-zA-Z]+)!\(([^()]*)\): /u, '$1($2)!: ') : output;
}

export function normalizeLayout(layout: FieldLayout, language?: string): FieldLayout {
  validateLayout(layout, language);
  return { template: layout.template, fields: layout.fields.map(field => ({
    id: field.id, label: field.label.trim(), input: field.input, enabled: field.enabled,
    required: field.required, remember: field.remember, options: candidates(field.options),
    defaultValue: field.defaultValue.trim(), prefix: field.prefix, suffix: field.suffix
  })) };
}
