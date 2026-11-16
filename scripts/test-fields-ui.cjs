const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { FieldEditorSession, editorStrings } = require('../out/field-editor-session');
const { DEFAULT_TEMPLATE } = require('../out/model');
const { generate } = require('../out/workflow');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'previews');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!['', 'field-editor.css', 'field-editor.js'].includes(name)) { res.writeHead(404).end(); return; }
  if (!name) {
    const source = fs.readFileSync(path.join(root, 'resources', 'field-editor.html'), 'utf8');
    const substitutions = { csp: "'self'", nonce: 'browser-test', css: '/field-editor.css', js: '/field-editor.js' };
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(source.replace(/\{\{(csp|nonce|css|js)\}\}/g, (_, key) => substitutions[key]));
  } else {
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'application/javascript');
    res.end(fs.readFileSync(path.join(root, 'resources', name)));
  }
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.UI_BROWSER_EXECUTABLE || undefined });
    for (const language of ['en', 'zh-cn']) {
      const strings = editorStrings(language);
      const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
      const errors = [], writes = [];
      page.on('pageerror', error => errors.push(error.message));
      let config = { types: ['Fixed', 'Added'], versions: ['1.2.0'], modules: ['Authentication'], defaultVersion: '1.2.0', template: DEFAULT_TEMPLATE, rememberLastValues: true };
      const session = new FieldEditorSession({ language, initialScope: 'folder', scopes: [{ id: 'folder', label: 'Project' }, { id: 'user', label: strings.user }],
        read: () => ({ config, revision: JSON.stringify(config), source: 'Project' }),
        write: async (scope, layout) => { writes.push({ scope, layout }); config = { ...config, fieldLayout: layout }; }
      }, message => { void page.evaluate(message => window.postMessage(message, '*'), message); });
      await page.exposeBinding('bridge', (_, message) => session.handle(message));
      await page.addInitScript(() => { window.acquireVsCodeApi = () => ({ postMessage: message => window.bridge(message) }); });
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.getByRole('heading', { name: strings.title }).waitFor();
      await page.locator('#add:not([disabled])').waitFor();
      assert.equal(await page.locator('.field-card').count(), 4);
      const card = id => page.locator(`.field-card[data-id="${id}"]`);
      assert.equal(await card('type').locator('.field-name').inputValue(), language === 'en' ? 'Type' : '类型');
      assert.equal(await card('type').locator('[data-property="options"]').inputValue(), 'Fixed\nAdded');
      assert.equal(await page.locator('#template').isVisible(), true);
      assert.equal(await page.locator('#template').inputValue(), DEFAULT_TEMPLATE);
      assert.equal(await page.locator('#template').getAttribute('readonly'), '');
      await page.locator('#automatic').uncheck();
      assert.equal(await page.locator('#template').getAttribute('readonly'), null);
      await page.locator('#automatic').check();
      await card('version').getByRole('button', { name: strings.remove, exact: true }).click();
      assert.ok(!(await page.locator('#template').inputValue()).includes('{version}'));
      await card('module').locator('[data-property="enabled"]').uncheck();
      await page.locator('#add').click();
      const added = page.locator('.field-card').last();
      const id = await added.getAttribute('data-id');
      await added.getByRole('textbox', { name: strings.label, exact: true }).fill(language === 'en' ? 'Issue number' : '需求编号');
      await added.locator('[data-property="options"]').fill('ABC-12\nABC-13');
      await added.locator('[data-property="defaultValue"]').fill('ABC-12');
      for (let step = 0; step < 3; step++) await card(id).getByRole('button', { name: strings.up, exact: true }).click();
      await page.locator('#save:not([disabled])').waitFor();
      assert.equal(writes.length, 0, 'edits and previews do not save');
      assert.ok((await page.locator('#preview').textContent()).startsWith('【ABC-12】【Fixed】'));
      await page.locator('#save').click();
      await page.locator('#feedback').getByText(strings.saved, { exact: true }).waitFor();
      assert.equal(writes.length, 1);
      assert.equal(config.fieldLayout.fields[0].id, id);
      assert.ok(!config.fieldLayout.fields.some(field => field.id === 'version'));
      assert.equal(config.fieldLayout.fields.find(field => field.id === 'module').enabled, false);
      let result;
      await generate({ language, targets: async () => [{ key: 'a', label: 'Demo', path: '/demo', canWrite: true }], config: () => config,
        recent: () => undefined, history: () => ({}), save: async () => {},
        input: async field => ({ kind: 'value', value: field === 'description' ? 'Handle expired sessions' : field === id ? 'ABC-12' : 'Fixed' }),
        pick: async () => 'write', read: () => '', write: (_target, text) => { result = text; }, info() {}, error: text => assert.fail(text), copy: async () => {}, confirm: async () => true
      });
      assert.equal(result, '【ABC-12】【Fixed】Handle expired sessions', 'saved UI config drives the native wizard');
      await card(id).getByRole('textbox', { name: strings.label, exact: true }).fill('<script>alert(1)</script>');
      assert.equal(await card(id).locator('script').count(), 0);
      await card(id).getByRole('textbox', { name: strings.label, exact: true }).fill(language === 'en' ? 'Issue number' : '需求编号');
      await page.locator('#save:not([disabled])').waitFor();
      await page.locator('#scope').selectOption('user');
      assert.equal(await page.locator('#scope').inputValue(), 'folder', 'dirty scope switch requires explicit save/reload');
      await page.locator('#save').click(); await page.locator('#feedback').getByText(strings.saved, { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `fields-${language}-dark.png`), fullPage: true });
      await page.evaluate(() => { document.body.className = 'vscode-light'; document.documentElement.style.setProperty('--vscode-editor-background', '#fff'); document.documentElement.style.setProperty('--vscode-editor-foreground', '#243244'); document.documentElement.style.setProperty('--vscode-descriptionForeground', '#5c6878'); document.documentElement.style.setProperty('--vscode-widget-border', '#d2dae5'); document.documentElement.style.setProperty('--vscode-input-background', '#fff'); document.documentElement.style.setProperty('--vscode-sideBar-background', '#f6f8fa'); });
      await page.screenshot({ path: path.join(output, `fields-${language}-light.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: path.join(output, `fields-${language}-narrow.png`), fullPage: true });
      await page.locator('#reset').click();
      await page.locator('#save:not([disabled])').waitFor();
      await page.locator('#save').click(); await page.locator('#feedback').getByText(strings.saved, { exact: true }).waitFor();
      assert.equal(config.fieldLayout, null, 'reset restores legacy mode and preserves legacy candidate settings');
      await page.locator('#conventional').click();
      await page.locator('#save:not([disabled])').waitFor();
      assert.equal(await page.locator('.field-card').count(), 3);
      assert.equal(await page.locator('#template').inputValue(), '{type}({module}): {description}');
      assert.equal(await card('module').locator('[data-property="required"]').isChecked(), false);
      assert.match(await card('type').locator('[data-property="options"]').inputValue(), /^feat\nfix\ndocs/);
      await page.locator('#save').click(); await page.locator('#feedback').getByText(strings.saved, {exact:true}).waitFor();
      assert.equal(config.fieldLayout.fields.length, 3);
      assert.ok((await page.locator('#preview').textContent()).startsWith('feat(Authentication): '));
      const writesBeforeRule2 = writes.length;
      await page.locator('#versioned').click();
      await page.locator('#save:not([disabled])').waitFor();
      assert.equal(writes.length, writesBeforeRule2, 'preset does not save until requested');
      assert.deepEqual(await page.locator('.field-card').evaluateAll(nodes => nodes.map(node => node.dataset.id)), ['type','version','module','description']);
      assert.equal(await card('version').locator('.field-name').inputValue(), language === 'en' ? 'Product version' : '产品版本');
      assert.equal(await card('version').locator('[data-property="options"]').inputValue(), '1.0.0\n1.5.0\n2.0.0\n2.5.0\n3.0.0\n3.5.0\n4.0.0\n4.5.0');
      assert.equal(await card('type').locator('[data-property="options"]').inputValue(), '新增\n修复\n文档\n格式\n重构\n优化\n测试\n构建\n集成\n维护\n回退');
      assert.equal(await card('version').locator('[data-property="defaultValue"]').inputValue(), '1.0.0');
      assert.equal(await page.locator('#template').inputValue(), DEFAULT_TEMPLATE);
      await page.locator('#save').click(); await page.locator('#feedback').getByText(strings.saved, {exact:true}).waitFor();
      assert.equal(config.fieldLayout.fields.length, 4);
      assert.ok((await page.locator('#preview').textContent()).startsWith('【新增】【1.0.0】【Authentication】'));
      await generate({ language, targets: async () => [{key:'a',label:'Demo',path:'/demo',canWrite:true}], config:()=>config,
        recent:()=>undefined,history:()=>({}),save:async()=>{},input:async id=>({kind:'value',value:{type:'修复',version:'4.5.0',module:'用户登录',description:'修复登录失败'}[id]}),
        pick:async()=> 'write',read:()=>'',write:(_target,text)=>{result=text;},info(){},error:reason=>assert.fail(reason),copy:async()=>{},confirm:async()=>true });
      assert.equal(result,'【修复】【4.5.0】【用户登录】修复登录失败');
      await page.screenshot({path:path.join(output, `rules-${language}-versioned.png`),fullPage:true});
      await page.locator('#conventional').click(); await page.locator('#save:not([disabled])').waitFor();
      assert.equal(await page.locator('.field-card').count(),3);
      await page.locator('#save').click(); await page.locator('#feedback').getByText(strings.saved,{exact:true}).waitFor();
      assert.equal(config.fieldLayout.fields.length,3);
      assert.deepEqual(errors, []);
      console.log('PASS [' + language + ']: add/edit/delete/disable/reorder, preview, explicit save, dynamic wizard output, dirty-scope protection, safe text, dark/light/narrow layouts and reset.');
      await page.close();
    }
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
