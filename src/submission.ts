import { formatMessage, Values } from './model';
import type { Services, Target } from './workflow';
import { translate } from './i18n';
import { formatFields, ResolvedLayout } from './fields';

export async function deliver(services: Services, target: Target, values: Values, template: string, action: 'commit' | 'write' | 'copy', remember: boolean, layout?: ResolvedLayout): Promise<boolean> {
  const message = layout ? formatFields(values, layout, services.language) : formatMessage(values, template, services.language);
  if (action === 'commit') {
    if (!target.canWrite || !services.commit) throw new Error(translate(services.language, 'commitUnavailable'));
    await services.commit(target, message);
  } else if (action === 'copy') await services.copy(message);
  else {
    while (true) {
      const before = services.read(target);
      if (before === undefined) {
        services.error(translate(services.language, 'repositoryClosed'));
        return false;
      }
      if (before && before !== message && !await services.confirm(before)) return false;
      if (services.read(target) !== before) continue;
      services.write(target, message);
      break;
    }
  }
  if (remember) {
    try { await services.save(target, layout ? Object.fromEntries(layout.fields.filter(field => field.enabled && field.remember).map(field => [field.id, values[field.id] ?? ''])) : { type: values.type, version: values.version, module: values.module }); }
    catch { services.info(translate(services.language, action === 'commit' ? 'committedHistoryFailed' : 'historyFailed')); return true; }
  }
  services.info(action === 'commit' ? translate(services.language, 'committed', target.label) : action === 'copy' ? translate(services.language, 'copied') : translate(services.language, 'written', target.label));
  return true;
}
