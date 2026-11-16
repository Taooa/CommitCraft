import * as vscode from 'vscode';
import { readFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import { Config, CONVENTIONAL_TEMPLATE, CONVENTIONAL_TYPES } from './model';
import { FieldLayout } from './fields';
import { editorStrings, FieldEditorServices, FieldEditorSession, SaveScope } from './field-editor-session';

export function createFieldEditorServices(resource?: vscode.Uri): FieldEditorServices {
  const strings = editorStrings(vscode.env.language);
  const folder = resource ? vscode.workspace.getWorkspaceFolder(resource) : vscode.workspace.workspaceFolders?.[0];
  const scopedResource = folder?.uri ?? resource;
  const scopes: FieldEditorServices['scopes'] = [{ id: 'user', label: strings.user }];
  if (vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length) scopes.push({ id: 'workspace', label: strings.workspace });
  if (folder) scopes.push({ id: 'folder', label: `${strings.folder} · ${folder.name}` });
  function read(scope: SaveScope) {
    if (!scopes.some(item => item.id === scope)) throw new Error(strings.invalidScope);
    const config = vscode.workspace.getConfiguration('commitHelper', scopedResource);
    function value<T>(key: string, fallback: T): T {
      const inspection = config.inspect<T>(key);
      if (!inspection) return fallback;
      if (scope === 'folder' && inspection.workspaceFolderValue !== undefined) return inspection.workspaceFolderValue;
      if (scope !== 'user' && inspection.workspaceValue !== undefined) return inspection.workspaceValue;
      return inspection.globalValue ?? inspection.defaultValue ?? fallback;
    }
    const resolved: Config = { types: value('types', CONVENTIONAL_TYPES), versions: value('versions', []),
      modules: value('modules', []), defaultVersion: value('defaultVersion', ''),
      template: value('template', CONVENTIONAL_TEMPLATE), rememberLastValues: value('rememberLastValues', true),
      fieldLayout: value<FieldLayout | null>('fieldLayout', null) };
    return { config: resolved, revision: JSON.stringify(resolved), source: scopes.find(item => item.id === scope)!.label };
  }
  return { language: vscode.env.language, scopes, initialScope: folder ? 'folder' : scopes.some(scope => scope.id === 'workspace') ? 'workspace' : 'user', read,
    async write(scope, layout) {
      if (!scopes.some(item => item.id === scope)) throw new Error(strings.invalidScope);
      const target = scope === 'folder' ? vscode.ConfigurationTarget.WorkspaceFolder : scope === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await vscode.workspace.getConfiguration('commitHelper', scopedResource).update('fieldLayout', layout, target);
    }
  };
}

export async function openFieldEditor(context: vscode.ExtensionContext, resource?: vscode.Uri, suppliedServices?: FieldEditorServices): Promise<vscode.WebviewPanel> {
  const root = vscode.Uri.joinPath(context.extensionUri, 'resources');
  const services = suppliedServices ?? createFieldEditorServices(resource);
  const panel = vscode.window.createWebviewPanel('commitHelper.fields', `CommitCraft · ${editorStrings(services.language).title}`, vscode.ViewColumn.Active, {
    enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [root]
  });
  panel.iconPath = { light: vscode.Uri.joinPath(root, 'mark-light.svg'), dark: vscode.Uri.joinPath(root, 'mark.svg') };
  const session = new FieldEditorSession(services, message => { void panel.webview.postMessage(message); });
  const listener = panel.webview.onDidReceiveMessage(message => { void session.handle(message); });
  panel.onDidDispose(() => listener.dispose());
  try {
    const source = await readFile(vscode.Uri.joinPath(root, 'field-editor.html').fsPath, 'utf8');
    const replacements: Record<string, string> = { csp: panel.webview.cspSource, nonce: randomBytes(24).toString('hex'),
      css: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'field-editor.css')).toString(),
      js: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'field-editor.js')).toString() };
    panel.webview.html = source.replace(/\{\{(csp|nonce|css|js)\}\}/gu, (_, key: string) => replacements[key]);
    return panel;
  } catch (error) { panel.dispose(); throw error; }
}
