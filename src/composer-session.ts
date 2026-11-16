import { candidates, Config, FIELDS, Values, validateTemplate } from './model';
import { deliver } from './submission';
import type { Services, Target } from './workflow';

export class ComposerSession {
  private targets: Target[] = [];
  private selected?: Target;
  private config?: Config;
  private busy = false;

  constructor(private readonly services: Services, private readonly send: (message: unknown) => void, private readonly initialKey?: string) {}

  private model(target: Target) {
    const config = this.services.config(target);
    this.config = config;
    const recent = config.rememberLastValues ? this.services.recent(target) : undefined;
    const history = config.rememberLastValues ? this.services.history(target) : undefined;
    return {
      target, template: config.template, templateError: validateTemplate(config.template), remember: config.rememberLastValues,
      values: { type: recent?.type ?? config.types[0] ?? '', version: recent?.version ?? config.defaultVersion, module: recent?.module ?? '', description: '' },
      options: { type: candidates(history?.type ?? [], config.types), version: candidates(history?.version ?? [], config.versions), module: candidates(history?.module ?? [], config.modules) }
    };
  }

  async handle(raw: unknown): Promise<void> {
    if (this.busy || !raw || typeof raw !== 'object') return;
    const message = raw as Record<string, unknown>;
    if (!['ready', 'select', 'submit'].includes(String(message.kind))) return;
    this.busy = true;
    try {
      if (message.kind === 'ready') {
        this.targets = await this.services.targets();
        this.selected = this.targets.find(target => target.key === this.initialKey) ?? this.targets[0];
        if (!this.selected) throw new Error('没有可用的工作区，请重新打开编辑器。');
        this.send({ kind: 'init', targets: this.targets, model: this.model(this.selected) });
      } else if (message.kind === 'select') {
        const target = this.targets.find(item => item.key === message.key);
        if (!target) throw new Error('目标仓库不可用，请重新打开编辑器。');
        this.selected = target;
        this.send({ kind: 'model', model: this.model(target) });
      } else {
        const target = this.selected;
        const config = this.config;
        if (!target || !config || message.key !== target.key) throw new Error('目标仓库已变更，请检查后重试。');
        if (message.action !== 'write' && message.action !== 'copy') throw new Error('无法识别此操作。');
        if (message.action === 'write' && !target.canWrite) throw new Error('当前工作区仅支持复制。');
        const values = message.values as Values | undefined;
        if (!values || FIELDS.some(field => typeof values[field] !== 'string')) throw new Error('请完整填写提交信息。');
        let feedback = '';
        const services = { ...this.services, info: (text: string) => { feedback = text; }, error: (text: string) => { throw new Error(text); } };
        const success = await deliver(services, target, values, config.template, message.action, config.rememberLastValues);
        this.send({ kind: 'complete', success, message: success ? feedback : '已保留原提交内容。', model: this.model(target) });
      }
    } catch (error) {
      this.send({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally { this.busy = false; }
  }
}
