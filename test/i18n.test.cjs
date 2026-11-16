const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { translate, isChinese } = require('../out/i18n');
const { validateField, validateTemplate, formatMessage, DEFAULT_TEMPLATE } = require('../out/model');
const { generate } = require('../out/workflow');

test('English is the fallback; Chinese locales share the Chinese interface', () => {
  for (const language of [undefined, 'en', 'en-US', 'de', 'ja']) {
    assert.equal(isChinese(language), false);
    assert.equal(translate(language, 'module'), 'Module');
    assert.match(validateField('type', '', language), /required/);
    assert.match(validateTemplate('{type}', language), /exactly once/);
  }
  for (const language of ['zh', 'zh-cn', 'zh-tw', 'zh-Hans', 'ZH-hant']) {
    assert.equal(isChinese(language), true);
    assert.equal(translate(language, 'module'), '模块');
    assert.match(validateField('type', '', language), /必填/);
    assert.match(validateTemplate('{type}', language), /只包含一次/);
  }
  assert.equal(translate('en', 'written', 'repo-{0}'), 'Filled the Git commit input for repo-{0}.');
});

test('all manifest placeholders resolve to complete English and Chinese catalogs', () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
  const zh = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.zh.json'), 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  function visit(value) {
    if (typeof value === 'string' && /^%[^%]+%$/.test(value)) {
      const key = value.slice(1, -1);
      assert.ok(en[key], key); assert.ok(zh[key], key);
      assert.ok(!/[\u3400-\u9fff]/u.test(en[key]), 'English translation: ' + key);
    } else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(manifest);
  assert.equal(manifest.displayName, '%displayName%');
  for (const command of manifest.contributes.commands) assert.match(command.title, /^%/);
  for (const config of Object.values(manifest.contributes.configuration.properties)) assert.match(config.description, /^%/);
});

test('both languages translate flow/actions/feedback while preserving Chinese commit data', async () => {
  const values = { type: '修复', version: '4.8.0', module: '测试模块', description: '修复查询异常' };
  const expected = '【修复】【4.8.0】【测试模块】修复查询异常';
  for (const language of ['en', 'zh-cn', 'ja']) {
    const picks = [], feedback = [], saved = [];
    let output;
    const target = { key: 'a', label: 'repo', path: '/a', canWrite: true };
    const services = {
      language, targets: async () => [target, { ...target, key: 'b' }],
      config: () => ({ types: ['修复'], versions: [], modules: [], defaultVersion: '', template: DEFAULT_TEMPLATE, rememberLastValues: true }),
      recent: () => values, history: () => ({ type: ['修复'], version: ['4.8.0'], module: ['测试模块'] }),
      save: async (_target, values) => saved.push(values),
      input: async (field, _value, options) => {
        if (field !== 'description') assert.ok(options.includes(values[field]));
        return { kind: 'value', value: values[field] };
      },
      pick: async (title, choices) => { picks.push({ title, choices }); return picks.length === 1 ? 'a' : 'write'; },
      read: () => '', write: (_target, text) => { output = text; }, copy: async () => {}, confirm: async () => true,
      info: message => feedback.push(message), error: message => assert.fail(message)
    };
    await generate(services);
    assert.equal(output, expected);
    assert.equal(formatMessage(values, DEFAULT_TEMPLATE, language), expected);
    assert.deepEqual(saved[0], { type: '修复', version: '4.8.0', module: '测试模块' });
    assert.equal(picks[0].title, translate(language, 'selectTarget'));
    assert.equal(picks[1].title, translate(language, 'preview'));
    assert.equal(picks[1].choices[0].label, '$(git-commit) ' + translate(language, 'write'));
    assert.equal(feedback[0], translate(language, 'written', 'repo'));
  }
});
