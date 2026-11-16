import { translate } from './i18n';
export const DEFAULT_TEMPLATE = '【{type}】【{version}】【{module}】{description}';
export const CONVENTIONAL_TEMPLATE = '{type}({module}): {description}';
export const CONVENTIONAL_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
export const FIELDS = ['type', 'version', 'module', 'description'] as const;
export type Field = typeof FIELDS[number];
export type Values = Record<string, string>;
export type Recent = Record<string, string>;
export interface Config {
  types: string[];
  versions: string[];
  modules: string[];
  defaultVersion: string;
  template: string;
  rememberLastValues: boolean;
  fieldLayout?: import('./fields').FieldLayout | null;
}

export function validateField(field: Field, value: string, language?: string): string | undefined {
  if (!value.trim()) return translate(language, 'required');
  if (/[\r\n\u2028\u2029\x00-\x1f\x7f]/u.test(value)) return translate(language, 'singleLine');
  if (field !== 'description' && /[【】]/u.test(value)) return translate(language, 'fieldBrackets');
  return undefined;
}

export function validateTemplate(template: string, language?: string): string | undefined {
  if (/[\r\n\u2028\u2029\x00-\x1f\x7f]/u.test(template)) return translate(language, 'templateLine');
  for (const field of FIELDS) {
    if (template.split(`{${field}}`).length !== 2) return translate(language, 'templateField', `{${field}}`);
  }
  if (/\{[^{}]*\}/u.test(template.replace(/\{(type|version|module|description)\}/gu, ''))) {
    return translate(language, 'templateUnknown');
  }
  return undefined;
}

export function formatMessage(values: Values, template = DEFAULT_TEMPLATE, language?: string): string {
  const error = validateTemplate(template, language);
  if (error) throw new Error(error);
  for (const field of FIELDS) {
    const fieldError = validateField(field, values[field], language);
    if (fieldError) throw new Error(fieldError);
  }
  // Single-pass replacement keeps placeholder-like text in user input literal.
  return template.replace(/\{(type|version|module|description)\}/gu, (_, field: Field) => values[field].trim());
}

export function candidates(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))];
}
