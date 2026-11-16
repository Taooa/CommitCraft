import { candidates, Config, CONVENTIONAL_TEMPLATE, Recent, Values } from './model';
import { History } from './history';
import { deliver } from './submission';
import { translate } from './i18n';
import { CommitField, formatFields, ResolvedLayout, resolveLayout, validateFieldValue } from './fields';

export interface Target { key: string; label: string; path: string; canWrite: boolean }
export type Choice<T extends string> = { id: T; label: string; description?: string; detail?: string };
export type InputResult = { kind: 'value'; value: string } | { kind: 'back' } | undefined;
export interface Services {
  language?: string;
  targets(): Promise<Target[]>;
  config(target: Target): Config;
  recent(target: Target): Recent | undefined;
  history(target: Target): History;
  save(target: Target, values: Recent): Promise<void>;
  pick<T extends string>(title: string, choices: Choice<T>[], placeholder?: string): Promise<T | undefined>;
  input(field: string, value: string, options: string[], step: number, definition?: CommitField, totalSteps?: number): Promise<InputResult>;
  read(target: Target): string | undefined;
  write(target: Target, message: string): void;
  commit?(target: Target, message: string): Promise<void>;
  copy(message: string): Promise<void>;
  confirm(oldMessage: string): Promise<boolean>;
  info(message: string): void;
  error(message: string): void;
}

export async function generate(services: Services, contextKey?: string): Promise<void> {
  const targets = await services.targets();
  let target = contextKey ? targets.find(item => item.key === contextKey) : undefined;
  if (!target && targets.length === 1) target = targets[0];
  if (!target) {
    const key = await services.pick(translate(services.language, 'selectTarget'), targets.map(item => ({ id: item.key, label: item.label, description: translate(services.language, item.canWrite ? 'gitRepository' : 'copyOnly'), detail: item.path })));
    target = targets.find(item => item.key === key);
  }
  if (!target) return;
  const config = services.config(target);
  let layout: ResolvedLayout;
  try { layout = resolveLayout(config, services.language); }
  catch (error) {
    services.error(translate(services.language, 'layoutSetting', error instanceof Error ? error.message : String(error)));
    return;
  }
  const recent = config.rememberLastValues ? services.recent(target) : undefined;
  const history = config.rememberLastValues ? services.history(target) : undefined;
  const fields = layout.fields.filter(field => field.enabled);
  const values: Values = Object.fromEntries(fields.map(field => [field.id, (field.remember ? recent?.[field.id] : undefined) ?? field.defaultValue]));
  if (layout.template === CONVENTIONAL_TEMPLATE && !/^[a-zA-Z]+!?$/u.test(values.type ?? '')) values.type = '';
  let step = 0;
  while (true) {
    while (step < fields.length) {
      const field = fields[step];
      let used = field.remember ? history?.[field.id] ?? [] : [];
      if (layout.template === CONVENTIONAL_TEMPLATE && field.id === 'type') used = used.filter(value => /^[a-zA-Z]+!?$/u.test(value));
      const result = await services.input(field.id, values[field.id], field.input === 'suggest' ? candidates([values[field.id]], used, field.options) : [], step + 1, field, fields.length);
      if (!result) return;
      if (result.kind === 'back') { step = Math.max(0, step - 1); continue; }
      if (layout.template === CONVENTIONAL_TEMPLATE && field.id === 'type' && !/^[a-zA-Z]+!?$/u.test(result.value.trim())) { services.error(translate(services.language, 'conventionalType')); continue; }
      const error = validateFieldValue(field, result.value, services.language);
      if (error) { services.error(error); continue; }
      values[field.id] = result.value.trim();
      step++;
    }
    const message = formatFields(values, layout, services.language);
    const actions: Choice<'commit' | 'write' | 'copy' | 'edit'>[] = [];
    if (target.canWrite) actions.push({ id: 'write', label: `$(git-commit) ${translate(services.language, 'write')}`, description: target.label, detail: message });
    if (target.canWrite && services.commit) actions.push({ id: 'commit', label: `$(check) ${translate(services.language, 'commit')}`, description: target.label, detail: `${message}\n${translate(services.language, 'commitDetail', target.label)}` });
    actions.push({ id: 'copy', label: `$(copy) ${translate(services.language, 'copy')}`, detail: message }, { id: 'edit', label: `$(edit) ${translate(services.language, 'edit')}`, detail: translate(services.language, 'editDetail') });
    const action = await services.pick(translate(services.language, 'preview'), actions, message);
    if (!action) return;
    if (action === 'edit') { step = 0; continue; }
    try {
      await deliver(services, target, values, layout.template, action, config.rememberLastValues, layout);
    } catch (error) {
      if (action !== 'commit') throw error;
      services.error(translate(services.language, 'commitFailed', error instanceof Error ? error.message : String(error)));
      // Retain all entries so a hook/identity/staging failure can be retried or copied.
      continue;
    }
    return;
  }
}
