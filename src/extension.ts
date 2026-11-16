import * as vscode from 'vscode';
import * as path from 'path';
import { candidates, Config, CONVENTIONAL_TEMPLATE, CONVENTIONAL_TYPES, Field, validateField } from './model';
import { createHistoryStore } from './history';
import { Choice, generate, InputResult, Services, Target } from './workflow';
import { translate } from './i18n';
import { CommitField, fieldLabel, validateFieldValue } from './fields';
import { openFieldEditor } from './field-editor';
import { editorStrings } from './field-editor-session';

// Minimal structural subset of the built-in vscode.git API v1.
interface Repository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
  state: { indexChanges: readonly unknown[]; mergeChanges: readonly unknown[]; rebaseCommit: unknown | undefined };
  status(): Promise<void>;
  commit(message: string, options: { all: boolean; amend: boolean; empty: boolean; noVerify: boolean; useEditor: boolean; postCommitCommand: null }): Promise<void>;
}
interface GitAPI {
  repositories: Repository[];
  state: 'uninitialized' | 'initialized';
  onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
}
interface GitExtension { enabled: boolean; getAPI(version: 1): GitAPI }

function input(field: string, value: string, options: string[], step: number, definition?: CommitField, totalSteps = 4): Promise<InputResult> {
  const language = vscode.env.language;
  const label = definition ? fieldLabel(definition, language) : translate(language, field as Field);
  return new Promise(resolve => {
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { rawValue: string }>();
    picker.title = `CommitCraft · ${label}`;
    picker.step = step;
    picker.totalSteps = totalSteps;
    picker.ignoreFocusOut = true;
    picker.matchOnDescription = true;
    picker.placeholder = field === 'description' ? translate(language, 'descriptionHint') : translate(language, 'chooseHint', label);
    if (step > 1) picker.buttons = [vscode.QuickInputButtons.Back];
    const disposables: vscode.Disposable[] = [];
    let done = false;
    function finish(result: InputResult) {
      if (done) return;
      done = true;
      resolve(result);
      picker.hide();
      disposables.forEach(item => item.dispose());
      picker.dispose();
    }
    const refresh = (text: string) => {
      const all = candidates(text.trim() ? [text] : value ? [value] : [], options);
      picker.items = all.map(label => ({ label, rawValue: label, description: text.trim() && label === text.trim() ? translate(language, 'currentInput') : !text && label === value ? translate(language, 'lastChoice') : undefined }));
      if (definition && !definition.required) picker.items = [...picker.items, { label: translate(language, 'skip'), rawValue: '', description: translate(language, 'optional'), alwaysShow: true }];
      if (picker.items.length) picker.activeItems = [picker.items[0]];
    };
    disposables.push(picker.onDidChangeValue(refresh), picker.onDidTriggerButton(() => finish({ kind: 'back' })), picker.onDidHide(() => finish(undefined)), picker.onDidAccept(() => {
      const selected = picker.selectedItems[0]?.rawValue ?? picker.value;
      const error = definition ? validateFieldValue(definition, selected, language) : validateField(field as Field, selected, language);
      if (error) { picker.title = `${label}: ${error}`; return; }
      finish({ kind: 'value', value: selected });
    }));
    // Start with an empty filter so older candidates remain visible alongside the default.
    refresh('');
    picker.show();
  });
}

export function createServices(context: vscode.ExtensionContext): Services {
  const selections = createHistoryStore(context.workspaceState);
  let api: GitAPI | undefined;
  let roots = new Map<string, vscode.Uri>();
  return {
    language: vscode.env.language,
    async targets() {
      roots = new Map();
      try {
        const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        const git = extension && await extension.activate();
        api = git?.enabled ? git.getAPI(1) : undefined;
        if (api?.state === 'uninitialized') {
          const pending = api;
          await new Promise<void>(resolve => {
            const timer = setTimeout(finish, 5000);
            const listener = pending.onDidChangeState(state => { if (state === 'initialized') finish(); });
            function finish() { clearTimeout(timer); listener.dispose(); resolve(); }
            if (pending.state === 'initialized') finish();
          });
        }
      } catch { api = undefined; }
      const repositories = api?.repositories ?? [];
      const uris = repositories.length ? repositories.map(repo => repo.rootUri) : (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri);
      const result: Target[] = uris.map(uri => {
        const key = uri.toString();
        roots.set(key, uri);
        return { key, label: path.basename(uri.path) || uri.toString(), path: uri.fsPath, canWrite: repositories.some(repo => repo.rootUri.toString() === key) };
      });
      return result.length ? result : [{ key: 'global', label: translate(vscode.env.language, 'currentWindow'), path: translate(vscode.env.language, 'noRepository'), canWrite: false }];
    },
    config(target): Config {
      const config = vscode.workspace.getConfiguration('commitHelper', roots.get(target.key));
      return {
        types: config.get('types', CONVENTIONAL_TYPES), versions: config.get('versions', []),
        modules: config.get('modules', []), defaultVersion: config.get('defaultVersion', ''),
        template: config.get('template', CONVENTIONAL_TEMPLATE),
        rememberLastValues: config.get('rememberLastValues', true),
        fieldLayout: config.get('fieldLayout', null)
      };
    },
    recent: target => selections.recent(target.key),
    history: target => selections.history(target.key),
    save: (target, values) => selections.save(target.key, values),
    async pick<T extends string>(title: string, choices: Choice<T>[], placeholder?: string) {
      return (await vscode.window.showQuickPick(choices, { title, placeHolder: placeholder, ignoreFocusOut: true, matchOnDetail: true }))?.id;
    },
    input,
    read: target => api?.repositories.find(repo => repo.rootUri.toString() === target.key)?.inputBox.value,
    write(target, message) {
      const repository = api?.repositories.find(repo => repo.rootUri.toString() === target.key);
      if (!repository) throw new Error(translate(vscode.env.language, 'repositoryClosed'));
      repository.inputBox.value = message;
    },
    async commit(target, message) {
      if (!vscode.workspace.isTrusted) throw new Error(translate(vscode.env.language, 'commitTrust'));
      const repository = api?.repositories.find(repo => repo.rootUri.toString() === target.key);
      if (!repository) throw new Error(translate(vscode.env.language, 'repositoryClosed'));
      await repository.status();
      if (repository.state.mergeChanges.length || repository.state.rebaseCommit) throw new Error(translate(vscode.env.language, 'commitBlocked'));
      if (!repository.state.indexChanges.length) throw new Error(translate(vscode.env.language, 'noStagedChanges'));
      const draft = repository.inputBox.value;
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `CommitCraft · ${translate(vscode.env.language, 'commit')}` }, async () => {
        // Explicit options prevent smart staging, amend, empty commits, editor launch
        // and git.postCommitCommand (which may be configured to push).
        await repository.commit(message, { all: false, amend: false, empty: false, noVerify: false, useEditor: false, postCommitCommand: null });
      });
      // The built-in Git API clears its input after a successful commit. Keep a
      // pre-existing draft if no newer text has appeared while Git was running.
      if (draft && !repository.inputBox.value) repository.inputBox.value = draft;
    },
    copy: async message => { await vscode.env.clipboard.writeText(message); },
    confirm: async oldMessage => await vscode.window.showWarningMessage(translate(vscode.env.language, 'replacePrompt'), { modal: true, detail: oldMessage }, translate(vscode.env.language, 'replace')) === translate(vscode.env.language, 'replace'),
    info: message => { void vscode.window.showInformationMessage(message); },
    error: message => { void vscode.window.showErrorMessage(message); }
  };
}

export function activate(context: vscode.ExtensionContext): void {
  let running = false;
  const runWizard = async (sourceControl?: { rootUri?: vscode.Uri }) => {
    if (running) return;
    running = true;
    try { await generate(createServices(context), sourceControl?.rootUri?.toString()); }
    catch (error) { void vscode.window.showErrorMessage(translate(vscode.env.language, 'failed', error instanceof Error ? error.message : String(error))); }
    finally { running = false; }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('commitHelper.generate', runWizard),
    vscode.commands.registerCommand('commitHelper.quickGenerate', runWizard),
    vscode.commands.registerCommand('commitHelper.configureFields', async (sourceControl?: { rootUri?: vscode.Uri }) => {
      try {
        let resource = sourceControl?.rootUri;
        if (!resource && (vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
          const selected = await vscode.window.showQuickPick(vscode.workspace.workspaceFolders!.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })), { title: editorStrings(vscode.env.language).title });
          if (!selected) return;
          resource = selected.folder.uri;
        }
        const panel = await openFieldEditor(context, resource);
        context.subscriptions.push(panel);
      } catch (error) { void vscode.window.showErrorMessage(`CommitCraft: ${error instanceof Error ? error.message : String(error)}`); }
    })
  );
}
