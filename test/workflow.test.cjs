const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generate } = require('../out/workflow');
const { DEFAULT_TEMPLATE, formatMessage, validateField, validateTemplate } = require('../out/model');

const example = { type: '修复', version: '4.8.0', module: '图上调阅', description: '切换实时视频时关闭录像查询面板' };
const message = '【修复】【4.8.0】【图上调阅】切换实时视频时关闭录像查询面板';
function fixture(overrides = {}) {
  const target = { key: 'repo-a', label: '仓库 A', path: '/a', canWrite: true };
  const state = { text: '', copied: [], saved: [], errors: [], picks: [], inputs: [], confirms: [] };
  const services = {
    targets: async () => [target],
    config: () => ({ types: ['新增', '修复', '样式'], versions: [], modules: [], defaultVersion: '', template: DEFAULT_TEMPLATE, rememberLastValues: true }),
    recent: () => undefined,
    history: () => ({ type: [], version: [], module: [] }),
    save: async (target, values) => state.saved.push({ target, values }),
    pick: async (title, choices) => { state.picks.push({ title, choices }); return choices[0].id; },
    input: async (field, value, options, step) => { state.inputs.push({ field, value, options, step }); return { kind: 'value', value: example[field] }; },
    read: () => state.text,
    write: (_target, text) => { state.text = text; },
    copy: async text => state.copied.push(text),
    confirm: async text => { state.confirms.push(text); return true; },
    info() {}, error: text => state.errors.push(text), ...overrides
  };
  return { target, state, services };
}

test('matches user example exactly, trims edges, preserves literal placeholder input', () => {
  assert.equal(formatMessage(example), message);
  assert.equal(formatMessage({ ...example, type: ' 修复 ' }), message);
  assert.equal(formatMessage({ ...example, description: '{type} 修复（切换）【面板】' }), '【修复】【4.8.0】【图上调阅】{type} 修复（切换）【面板】');
  assert.equal(formatMessage(example, '{version} / {module} / {type}: {description}'), '4.8.0 / 图上调阅 / 修复: 切换实时视频时关闭录像查询面板');
});

test('rejects blank fields, multiline/control text, ambiguous field boundaries and invalid templates', () => {
  for (const field of Object.keys(example)) {
    for (const value of [' ', 'a\nb', 'a\rb', 'a\u2028b', 'a\u0000b']) assert.ok(validateField(field, value));
  }
  assert.ok(validateField('module', '【面板】'));
  assert.equal(validateField('module', '地图、视频'), undefined);
  for (const template of ['', '{type}{version}{module}', DEFAULT_TEMPLATE + '{type}', DEFAULT_TEMPLATE + '{unknown}', DEFAULT_TEMPLATE + '\n']) {
    assert.ok(validateTemplate(template));
    assert.throws(() => formatMessage(example, template));
  }
});

test('writes exact message and only remembers non-description fields after success', async () => {
  const { services, state } = fixture();
  await generate(services);
  assert.equal(state.text, message);
  assert.deepEqual(state.saved[0].values, { type: '修复', version: '4.8.0', module: '图上调阅' });
});

test('cancellation at every field and preview preserves original text and recent state', async () => {
  for (let stop = 0; stop <= 4; stop++) {
    const { services, state } = fixture();
    state.text = '原提交';
    let count = 0;
    services.input = async field => count++ === stop ? undefined : { kind: 'value', value: example[field] };
    if (stop === 4) services.pick = async () => undefined;
    await generate(services);
    assert.equal(state.text, '原提交');
    assert.equal(state.saved.length, 0);
  }
});

test('refusing overwrite preserves existing text; accepting prompts for concurrent edits again', async () => {
  const { services, state } = fixture();
  state.text = '原提交';
  services.confirm = async () => false;
  await generate(services);
  assert.equal(state.text, '原提交');
  assert.equal(state.saved.length, 0);
  services.confirm = async text => {
    state.confirms.push(text);
    if (state.confirms.length === 1) state.text = '外部新编辑';
    return true;
  };
  await generate(services);
  assert.deepEqual(state.confirms, ['原提交', '外部新编辑']);
  assert.equal(state.text, message);
});

test('explicit multi-repo selection writes and saves only the selected repository', async () => {
  const { services, target, state } = fixture();
  const second = { ...target, key: 'repo-b', label: '仓库 B' };
  services.targets = async () => [target, second];
  services.pick = async (_title, choices) => choices.some(item => item.id === 'repo-b') ? 'repo-b' : 'write';
  services.read = chosen => { assert.equal(chosen.key, 'repo-b'); return ''; };
  services.write = (chosen, text) => { assert.equal(chosen.key, 'repo-b'); state.text = text; };
  await generate(services);
  assert.equal(state.text, message);
  assert.equal(state.saved[0].target.key, 'repo-b');
});

test('SCM context selects exact repo without a second selector', async () => {
  const { services, target, state } = fixture();
  services.targets = async () => [target, { ...target, key: 'repo-b' }];
  await generate(services, 'repo-b');
  assert.equal(state.picks.length, 1);
  assert.equal(state.saved[0].target.key, 'repo-b');
});

test('without Git, exposes copy and edit only; clipboard failure never records success', async () => {
  const { services, target, state } = fixture();
  services.targets = async () => [{ ...target, canWrite: false }];
  await generate(services);
  assert.deepEqual(state.copied, [message]);
  assert.deepEqual(state.picks[0].choices.map(item => item.id), ['copy', 'edit']);
  assert.equal(state.text, '');
  state.saved = [];
  services.copy = async () => { throw new Error('clipboard denied'); };
  await assert.rejects(generate(services), /clipboard denied/);
  assert.equal(state.saved.length, 0);
});

test('back and preview edit preserve values and only output after confirmation', async () => {
  const { services, state } = fixture();
  let back = false;
  let edit = false;
  services.input = async (field, value) => {
    if (field === 'module' && !back) { back = true; return { kind: 'back' }; }
    if (edit) assert.equal(value, example[field]);
    return { kind: 'value', value: example[field] };
  };
  services.pick = async () => { if (!edit) { edit = true; return 'edit'; } return 'write'; };
  await generate(services);
  assert.ok(back);
  assert.equal(state.text, message);
});

test('recent/defaults are scoped to selected target and remember can be disabled', async () => {
  const { services, state } = fixture();
  services.recent = target => { assert.equal(target.key, 'repo-a'); return { type: '样式', version: '2.0', module: '地图' }; };
  await generate(services);
  assert.deepEqual(state.inputs.slice(0, 3).map(item => item.value), ['样式', '2.0', '地图']);
  const originalConfig = services.config;
  services.config = target => ({ ...originalConfig(target), defaultVersion: '1.0', rememberLastValues: false });
  state.inputs = []; state.saved = [];
  services.recent = () => { throw new Error('should not load history'); };
  services.history = () => { throw new Error('should not load candidates'); };
  await generate(services);
  assert.equal(state.inputs[1].value, '1.0');
  assert.equal(state.saved.length, 0);
});

test('merges all used values with configured candidates, newest first without duplicates', async () => {
  const { services, state } = fixture();
  services.recent = () => ({ type: '维护', version: '4.9.0', module: '地图' });
  services.history = () => ({ type: ['维护', '修复'], version: ['4.9.0', '4.8.0'], module: ['地图', '测试模块'] });
  const config = services.config;
  services.config = () => ({ ...config(), versions: ['4.8.0', '5.0.0'], modules: ['测试模块', '用户管理'] });
  await generate(services);
  assert.deepEqual(state.inputs[0].options, ['维护', '修复', '新增', '样式']);
  assert.deepEqual(state.inputs[1].options, ['4.9.0', '4.8.0', '5.0.0']);
  assert.deepEqual(state.inputs[2].options, ['地图', '测试模块', '用户管理']);
  assert.deepEqual(state.inputs[3].options, []);
});

test('closed repository and invalid config fail without changing text', async () => {
  const { services, state } = fixture({ read: () => undefined });
  await generate(services);
  assert.match(state.errors[0], /closed/);
  assert.equal(state.saved.length, 0);
  services.config = () => ({ template: '{bad}' });
  state.inputs = [];
  await generate(services);
  assert.match(state.errors[1], /commitHelper.template/);
  assert.equal(state.inputs.length, 0);
});
