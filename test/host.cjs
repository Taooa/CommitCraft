const vscode = require('vscode');
const assert = require('node:assert/strict');
const { createServices } = require('../out/extension');
const { generate } = require('../out/workflow');
const { translate, isChinese } = require('../out/i18n');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createFieldEditorServices, openFieldEditor } = require('../out/field-editor');
const { FieldEditorSession, editorStrings } = require('../out/field-editor-session');
const { legacyFields } = require('../out/fields');

exports.run = async function () {
  const extension = vscode.extensions.getExtension('local-tools.vscode-commit-helper');
  assert.ok(extension, 'extension discovered');
  await extension.activate();
  assert.ok(extension.isActive, 'extension activated');
  assert.ok((await vscode.commands.getCommands(true)).includes('commitHelper.generate'), 'command registered');
  assert.ok((await vscode.commands.getCommands(true)).includes('commitHelper.quickGenerate'), 'native wizard command retained');
  assert.ok((await vscode.commands.getCommands(true)).includes('commitHelper.configureFields'), 'field editor command registered');
  const memory = new Map();
  const context = { workspaceState: { get: key => memory.get(key), update: async (key, value) => memory.set(key, value) } };
  const services = createServices(context);
  assert.equal(services.language, vscode.env.language);
  assert.equal(isChinese(vscode.env.language), isChinese(process.env.COMMITCRAFT_TEST_LOCALE || 'en'), 'host display language matches requested locale');
  const manifest = extension.packageJSON;
  assert.equal(manifest.displayName, isChinese(vscode.env.language) ? 'CommitCraft — Git 提交信息助手' : 'CommitCraft — Git Commit Message Builder');
  const localizedTitle = manifest.contributes.commands[0].title;
  assert.equal(typeof localizedTitle === 'object' ? localizedTitle.value : localizedTitle, isChinese(vscode.env.language) ? '编写提交信息' : 'Compose Commit Message');
  const settingDescription = manifest.contributes.configuration.properties['commitHelper.types'].description;
  assert.match(settingDescription, isChinese(vscode.env.language) ? /类型候选/ : /Suggested commit types/);
  async function driveInput(field, value, options, step, cancel = false, next = false, definition, total) {
    const pending = services.input(field, value, options, step, definition, total);
    await new Promise(resolve => setTimeout(resolve, 200));
    if (next) await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
    await vscode.commands.executeCommand(cancel ? 'workbench.action.closeQuickOpen' : 'workbench.action.acceptSelectedQuickOpenItem');
    let timer;
    try {
      return await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Quick Pick interaction timed out')), 3000); })]);
    } finally { clearTimeout(timer); await vscode.commands.executeCommand('workbench.action.closeQuickOpen'); }
  }
  assert.deepEqual(await driveInput('type', '自定义类型', ['新增', '修复'], 1), { kind: 'value', value: '自定义类型' }, 'native Quick Pick accepts custom value');
  assert.deepEqual(await driveInput('type', '修复', ['新增', '修复'], 1), { kind: 'value', value: '修复' }, 'native Quick Pick accepts prefilled candidate');
  assert.deepEqual(await driveInput('version', '4.9.0', ['4.9.0', '4.8.0'], 2, false, true), { kind: 'value', value: '4.8.0' }, 'older candidate is visible and selectable with the latest default');
  assert.equal(await driveInput('module', '', [], 3, true), undefined, 'native Quick Pick cancellation');
  const targets = await services.targets();
  await vscode.workspace.getConfiguration('commitHelper').update('template', '【{type}】【{version}】【{module}】{description}', vscode.ConfigurationTarget.Workspace);
  assert.ok(targets[0].canWrite, 'real built-in Git repository detected');
  const git = vscode.extensions.getExtension('vscode.git').exports.getAPI(1);
  const repo = git.repositories.find(item => item.rootUri.toString() === targets[0].key);
  assert.ok(repo, 'correct target repository');
  const example = { type: '修复', version: '4.8.0', module: '图上调阅', description: '切换实时视频时关闭录像查询面板' };
  const expected = '【修复】【4.8.0】【图上调阅】切换实时视频时关闭录像查询面板';
  const errors = [];
  let previewTitle;
  const automated = { ...services, targets: async () => targets,
    input: async field => ({ kind: 'value', value: example[field] }),
    pick: async title => { previewTitle = title; return 'write'; }, info() {}, error: message => errors.push(message) };
  await generate(automated, targets[0].key);
  assert.equal(repo.inputBox.value, expected, 'real Git input updated');
  assert.equal(previewTitle, translate(vscode.env.language, 'preview'), 'runtime follows actual host locale');
  assert.equal(services.recent(targets[0]).version, '4.8.0', 'recent values saved');
  await services.save(targets[0], { type: '维护', version: '4.9.0', module: '测试模块' });
  const reloaded = createServices(context);
  assert.deepEqual(reloaded.history(targets[0]).version, ['4.9.0', '4.8.0'], 'all used versions survive service recreation');
  assert.deepEqual(reloaded.history(targets[0]).module, ['测试模块', '图上调阅'], 'all used modules retained');
  repo.inputBox.value = '保留原提交';
  await generate({ ...automated, confirm: async () => false });
  assert.equal(repo.inputBox.value, '保留原提交', 'declined overwrite preserved');
  await generate({ ...automated, input: async () => undefined });
  assert.equal(repo.inputBox.value, '保留原提交', 'cancel preserved');
  const oldClipboard = await vscode.env.clipboard.readText();
  try {
    await generate({ ...automated, pick: async () => 'copy' });
    assert.equal(await vscode.env.clipboard.readText(), expected, 'real system clipboard');
    assert.equal(repo.inputBox.value, '保留原提交', 'copy does not write Git');
  } finally { await vscode.env.clipboard.writeText(oldClipboard); }
  assert.deepEqual(errors, []);
  const tabsBefore = vscode.window.tabGroups.all.flatMap(group => group.tabs).length;
  const original = repo.inputBox.value;
  const primary = vscode.commands.executeCommand('commitHelper.generate', { rootUri: repo.rootUri });
  await new Promise(resolve => setTimeout(resolve, 600));
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  let timeout;
  try {
    await Promise.race([primary, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('primary wizard did not cancel')), 3000); })]);
  } finally { clearTimeout(timeout); }
  assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).length, tabsBefore, 'main command opens no form editor');
  assert.equal(repo.inputBox.value, original, 'main command cancellation preserves Git input');
  // All commit mutations are restricted to the runner's disposable repository.
  const testRoot = repo.rootUri.fsPath;
  assert.equal(path.basename(testRoot), 'repository');
  assert.ok(path.basename(path.dirname(testRoot)).startsWith('commit-helper-test-'));
  const runGit = (...args) => execFileSync('git', ['-C', testRoot, ...args], { encoding: 'utf8' }).trim();
  runGit('config', 'user.name', 'CommitCraft Test');
  runGit('config', 'user.email', 'commitcraft-test@example.invalid');
  runGit('config', 'commit.gpgSign', 'false');
  runGit('config', 'core.hooksPath', '.git/hooks');
  fs.writeFileSync(path.join(testRoot, 'tracked.txt'), 'initial\n');
  runGit('add', 'tracked.txt');
  runGit('commit', '-m', 'Test fixture');
  // A configured push must not be executed by direct commit.
  const gitSettings = vscode.workspace.getConfiguration('git', repo.rootUri);
  await gitSettings.update('postCommitCommand', 'push', vscode.ConfigurationTarget.WorkspaceFolder);
  await gitSettings.update('enableSmartCommit', true, vscode.ConfigurationTarget.WorkspaceFolder);
  fs.writeFileSync(path.join(testRoot, 'untracked.txt'), 'leave untracked\n');
  fs.writeFileSync(path.join(testRoot, 'tracked.txt'), 'working-only\n');
  const initialHead = runGit('rev-parse', 'HEAD');
  await assert.rejects(services.commit(targets[0], expected), error => error.message.includes(translate(vscode.env.language, 'noStagedChanges')));
  assert.equal(runGit('rev-parse', 'HEAD'), initialHead, 'empty index never commits despite smart commit setting');
  fs.writeFileSync(path.join(testRoot, 'tracked.txt'), 'staged snapshot\n');
  runGit('add', 'tracked.txt');
  fs.writeFileSync(path.join(testRoot, 'tracked.txt'), 'staged snapshot\nunstaged edit\n');
  repo.inputBox.value = 'Keep this draft';
  const commitNotices = [], commitErrors = [];
  await generate({ ...automated, pick: async (_title, choices) => {
    assert.ok(choices.some(item => item.id === 'commit'));
    return 'commit';
  }, info: message => commitNotices.push(message), error: message => commitErrors.push(message) }, targets[0].key);
  assert.deepEqual(commitErrors, []);
  assert.equal(runGit('log', '-1', '--format=%B'), expected, 'real commit uses complete generated message');
  assert.equal(runGit('show', 'HEAD:tracked.txt'), 'staged snapshot', 'only the staged snapshot is committed');
  assert.ok(fs.readFileSync(path.join(testRoot, 'tracked.txt'), 'utf8').includes('unstaged edit'));
  assert.equal(runGit('ls-tree', '-r', '--name-only', 'HEAD'), 'tracked.txt', 'untracked files are not included');
  assert.equal(repo.inputBox.value, 'Keep this draft', 'direct commit preserves unrelated Git input draft');
  assert.equal(commitNotices[0], translate(vscode.env.language, 'committed', targets[0].label));
  assert.equal(runGit('diff', '--name-only'), 'tracked.txt', 'unstaged modification remains unstaged');
  const committedHead = runGit('rev-parse', 'HEAD');
  const hook = path.join(testRoot, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho "CommitCraft test hook rejected" >&2\nexit 1\n', { mode: 0o755 });
  runGit('add', 'tracked.txt');
  await assert.rejects(services.commit(targets[0], 'Must fail: hooks are honored'));
  assert.equal(runGit('rev-parse', 'HEAD'), committedHead, 'hook failure does not create a commit');
  assert.equal(runGit('diff', '--cached', '--name-only'), 'tracked.txt', 'hook failure retains staged content');
  assert.equal(repo.inputBox.value, 'Keep this draft');
  fs.unlinkSync(hook);
  const fieldServices = createFieldEditorServices(repo.rootUri);
  const editorMessages = [];
  const editor = new FieldEditorSession(fieldServices, message => editorMessages.push(message));
  await editor.handle({ kind: 'ready' });
  assert.equal(editorMessages[0].scope, 'folder');
  assert.equal(editorMessages[0].fields.length, 4);
  const fields = legacyFields(services.config(targets[0]));
  const issue = { id: 'issue', label: isChinese(vscode.env.language) ? '需求编号' : 'Issue number', input: 'suggest', enabled: true, required: false, remember: true, options: ['ABC-12'], defaultValue: '', prefix: '【', suffix: '】' };
  const layout = { template: null, fields: [issue, fields[0], { ...fields[2], enabled: false }, fields[3]] };
  await editor.handle({ kind: 'save', scope: 'folder', layout });
  assert.equal(editorMessages.at(-1).kind, 'saved');
  const diskSettings = JSON.parse(fs.readFileSync(path.join(testRoot, '.vscode', 'settings.json'), 'utf8'));
  assert.equal(diskSettings['commitHelper.fieldLayout'].fields[0].id, 'issue', 'layout saved to actual project settings');
  assert.equal(fieldServices.read('user').config.fieldLayout, null, 'saving project does not modify user settings');
  assert.equal(await driveInput('issue', '', [], 1, false, false, issue, 3).then(result => result.value), '', 'optional native field can skip with Enter');
  assert.deepEqual(await driveInput('issue', 'ABC-12', ['ABC-12'], 1, false, false, issue, 3), { kind: 'value', value: 'ABC-12' });
  const filled = [];
  const dynamicErrors = [];
  await generate({ ...services, targets: async () => targets,
    input: async (id, value, options, step, definition, total) => {
      filled.push({ id, step, total });
      return { kind: 'value', value: { issue: 'ABC-12', type: 'Fixed', description: 'Handle expired sessions' }[id] };
    }, pick: async () => 'commit', info() {}, error: message => dynamicErrors.push(message)
  }, targets[0].key);
  assert.deepEqual(dynamicErrors, []);
  assert.deepEqual(filled.map(item => item.id), ['issue', 'type', 'description']);
  assert.ok(filled.every(item => item.total === 3));
  assert.equal(runGit('log', '-1', '--format=%B'), '【ABC-12】【Fixed】Handle expired sessions', 'custom layout creates real commit with no deleted/disabled fields');
  assert.equal(services.recent(targets[0]).issue, 'ABC-12');
  assert.ok(services.history(targets[0]).version.includes('4.8.0'), 'disabled and deleted legacy fields retain history');
  let initialized;
  const loadedPage = new Promise(resolve => { initialized = resolve; });
  const panel = await openFieldEditor({ ...context, extensionUri: vscode.Uri.file(path.resolve(__dirname, '..')) }, repo.rootUri, {
    ...fieldServices, read: scope => { initialized(); return fieldServices.read(scope); }
  });
  let pageTimer;
  try {
    assert.equal(panel.title, 'CommitCraft · ' + editorStrings(vscode.env.language).title);
    assert.ok(panel.webview.html.includes('Content-Security-Policy'));
    assert.ok(!panel.webview.html.includes('{{js}}'));
    await Promise.race([loadedPage, new Promise((_, reject) => { pageTimer = setTimeout(() => reject(new Error('configuration webview failed to initialize')), 10000); })]);
  } finally { clearTimeout(pageTimer); panel.dispose(); }
  await editor.handle({ kind: 'save', scope: 'folder', restore: true });
  assert.equal(services.config(targets[0]).fieldLayout, null, 'restore original fields uses legacy configuration again');
  const { CONVENTIONAL_TEMPLATE, CONVENTIONAL_TYPES } = require('../out/model');
  await vscode.workspace.getConfiguration('commitHelper').update('template', CONVENTIONAL_TEMPLATE, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration('commitHelper').update('types', CONVENTIONAL_TYPES, vscode.ConfigurationTarget.Workspace);
  fs.appendFileSync(path.join(testRoot, 'tracked.txt'), '\nConventional change\n');
  runGit('add', 'tracked.txt');
  const conventionalSteps = [];
  await generate({ ...services, targets: async () => targets,
    input: async (id, value, options, step, definition, total) => {
      conventionalSteps.push(id); assert.equal(total, 3);
      if (id === 'module') assert.equal(definition.required, false);
      return {kind:'value',value:id==='type'?'feat!':id==='module'?'api':'Change response structure'};
    }, pick: async () => 'commit', info(){}, error: reason => assert.fail(reason)
  }, targets[0].key);
  assert.deepEqual(conventionalSteps, ['type','module','description']);
  assert.equal(runGit('log','-1','--format=%B'), 'feat(api)!: Change response structure');
  console.log('PASS [' + vscode.env.language + ']: localized metadata/wizard, staged-only commit/hooks/drafts, actual project field settings, dynamic native input/skip/history/commit, editor Webview and legacy reset.');
};
