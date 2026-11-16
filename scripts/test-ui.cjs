const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { ComposerSession } = require('../out/composer-session');
const { DEFAULT_TEMPLATE } = require('../out/model');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'previews');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!['', 'composer.css', 'composer.js', 'mark.svg', 'mark-light.svg'].includes(name)) { res.writeHead(404).end(); return; }
  if (!name) {
    const source = fs.readFileSync(path.join(root, 'resources', 'composer.html'), 'utf8');
    const substitutions = { csp: "'self'", nonce: 'browser-test', css: '/composer.css', js: '/composer.js', logo: '/mark.svg', logoLight: '/mark-light.svg' };
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(source.replace(/\{\{(csp|nonce|css|js|logo|logoLight)\}\}/g, (_, key) => substitutions[key]));
  } else {
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : 'image/svg+xml');
    res.end(fs.readFileSync(path.join(root, 'resources', name)));
  }
});

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.UI_BROWSER_EXECUTABLE || undefined });
    const page = await browser.newPage({ viewport: { width: 1040, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [], copies = [], writes = [], saves = [];
    page.on('pageerror', error => errors.push(error.message));
    const targets = [{ key: 'a', label: 'micro-front-end', path: 'E:\\projects\\micro-front-end', canWrite: true }, { key: 'b', label: '独立工作区', path: 'E:\\projects\\notes', canWrite: false }];
    const services = {
      language: 'zh-cn',
      targets: async () => targets,
      config: () => ({ types: ['新增', '修复', '样式'], versions: ['4.8.0', '4.9.0'], modules: ['图上调阅', '测试模块', '用户管理'], defaultVersion: '4.8.0', template: DEFAULT_TEMPLATE, rememberLastValues: true }),
      recent: () => ({ type: '修复', version: '4.8.0', module: '图上调阅' }),
      history: () => ({ type: ['修复'], version: ['4.8.0'], module: ['图上调阅'] }),
      read: () => '', write: (_target, text) => writes.push(text), copy: async text => copies.push(text), confirm: async () => false,
      save: async (_target, values) => saves.push(values), info() {}, error() {}
    };
    const session = new ComposerSession(services, message => { void page.evaluate(message => window.postMessage(message, '*'), message); }, 'a');
    await page.exposeBinding('bridge', (_, message) => session.handle(message));
    await page.addInitScript(() => { window.acquireVsCodeApi = () => ({ postMessage: message => window.bridge(message) }); });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.locator('#repository:not([disabled])').waitFor();
    assert.equal(await page.locator('.logo-dark').isVisible(), true);
    assert.equal(await page.locator('.logo-light').isVisible(), false);
    assert.equal(await page.locator('#write').isDisabled(), true);
    await page.locator('#description').fill('切换实时视频时关闭录像查询面板');
    assert.equal(await page.locator('#preview-message').textContent(), '【修复】【4.8.0】【图上调阅】切换实时视频时关闭录像查询面板');
    await page.locator('#module-options').getByRole('button', { name: '测试模块', exact: true }).click();
    await page.locator('#version-options').getByRole('button', { name: '4.9.0', exact: true }).click();
    await page.locator('#copy').click();
    await page.getByText('提交信息已复制。', { exact: true }).waitFor();
    assert.deepEqual(copies, ['【修复】【4.9.0】【测试模块】切换实时视频时关闭录像查询面板']);
    await page.locator('#write').click();
    await page.getByText('已填入 micro-front-end 的 Git 提交输入框。', { exact: true }).waitFor();
    await page.locator('#description').press('Control+Enter');
    await page.getByText('已填入 micro-front-end 的 Git 提交输入框。', { exact: true }).waitFor();
    assert.equal(writes.length, 2, 'keyboard shortcut submits once');
    assert.deepEqual(writes, [copies[0], copies[0]]);
    await page.screenshot({ path: path.join(output, 'composer-dark.png'), fullPage: true });
    await page.locator('#repository').selectOption('b');
    await page.locator('#repo-mode').getByText('仅复制', { exact: true }).waitFor();
    assert.equal(await page.locator('#write').isHidden(), true);
    await page.locator('#description').fill('仅复制工作区的草稿');
    await page.locator('#repository').selectOption('a');
    await page.locator('#repo-mode').getByText('Git 仓库', { exact: true }).waitFor();
    assert.equal(await page.locator('#description').inputValue(), '切换实时视频时关闭录像查询面板');
    assert.equal(await page.locator('#version').inputValue(), '4.9.0');
    await page.locator('#description').fill('<script>alert(1)</script>');
    assert.ok((await page.locator('#preview-message').textContent()).includes('<script>'));
    assert.equal(await page.locator('#preview-message script').count(), 0);
    await page.locator('#description').fill('错误\n换行');
    assert.equal(await page.locator('#copy').isDisabled(), true);
    await page.locator('#description').fill('切换实时视频时关闭录像查询面板');
    await page.evaluate(() => { document.body.className = 'vscode-light'; document.documentElement.style.setProperty('--vscode-editor-background', '#ffffff'); document.documentElement.style.setProperty('--vscode-editor-foreground', '#26333d'); document.documentElement.style.setProperty('--vscode-descriptionForeground', '#687681'); document.documentElement.style.setProperty('--vscode-widget-border', '#d9e0e5'); document.documentElement.style.setProperty('--vscode-input-background', '#f7f9fa'); document.documentElement.style.setProperty('--vscode-sideBar-background', '#f6f8f9'); });
    await page.screenshot({ path: path.join(output, 'composer-light.png'), fullPage: true });
    assert.equal(await page.locator('.logo-light').isVisible(), true);
    assert.equal(await page.locator('.logo-dark').isVisible(), false);
    assert.equal(await page.locator('.logo-light').evaluate(image => image.complete && image.naturalWidth > 0), true);
    await page.evaluate(() => { document.body.className = 'vscode-high-contrast'; });
    assert.equal(await page.locator('.logo-dark').isVisible(), true);
    await page.evaluate(() => { document.body.className = 'vscode-high-contrast-light'; });
    assert.equal(await page.locator('.logo-light').isVisible(), true);
    await page.evaluate(() => { document.body.className = 'vscode-light'; });
    await page.setViewportSize({ width: 390, height: 920 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'narrow layout fits');
    await page.screenshot({ path: path.join(output, 'composer-narrow.png'), fullPage: true });
    assert.equal(saves.length, 3);
    assert.deepEqual(errors, []);
    console.log('PASS: form preview, history chips, copy/write, repo drafts, copy-only mode, validation, safe text rendering, narrow layout.');
    console.log('Previews: ' + output);
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
