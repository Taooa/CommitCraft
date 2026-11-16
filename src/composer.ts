import * as vscode from 'vscode';
import { readFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import { ComposerSession } from './composer-session';
import type { Services } from './workflow';

export async function openComposer(context: vscode.ExtensionContext, services: Services, contextKey?: string): Promise<vscode.WebviewPanel> {
  const root = vscode.Uri.joinPath(context.extensionUri, 'resources');
  const panel = vscode.window.createWebviewPanel('commitHelper.composer', 'CommitCraft', vscode.ViewColumn.Active, {
    enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [root]
  });
  panel.iconPath = { light: vscode.Uri.joinPath(root, 'mark-light.svg'), dark: vscode.Uri.joinPath(root, 'mark.svg') };
  const session = new ComposerSession(services, message => { void panel.webview.postMessage(message); }, contextKey);
  const listener = panel.webview.onDidReceiveMessage(message => { void session.handle(message); });
  panel.onDidDispose(() => listener.dispose());
  try {
    const source = await readFile(vscode.Uri.joinPath(root, 'composer.html').fsPath, 'utf8');
    const replacements: Record<string, string> = {
      csp: panel.webview.cspSource, nonce: randomBytes(24).toString('hex'),
      css: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'composer.css')).toString(),
      js: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'composer.js')).toString(),
      logo: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'mark.svg')).toString(),
      logoLight: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'mark-light.svg')).toString()
    };
    panel.webview.html = source.replace(/\{\{(csp|nonce|css|js|logo|logoLight)\}\}/gu, (_, key: string) => replacements[key]);
    return panel;
  } catch (error) { panel.dispose(); throw error; }
}
