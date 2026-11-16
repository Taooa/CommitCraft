const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLayout, formatFields, validateLayout, validateFieldValue, legacyFields, fieldLabel } = require('../out/fields');
const { DEFAULT_TEMPLATE } = require('../out/model');
const { generate } = require('../out/workflow');
const { createHistoryStore } = require('../out/history');
const base = () => ({ types: ['Fixed'], versions: ['1.2.0'], modules: ['Users'], defaultVersion: '1.2.0', template: DEFAULT_TEMPLATE, rememberLastValues: true });
const clone = value => JSON.parse(JSON.stringify(value));
const extra = () => ({ id: 'issue', label: 'Issue number', input: 'suggest', enabled: true, required: false, remember: true, options: ['ABC-12'], defaultValue: '', prefix: '【', suffix: '】' });

test('versioned rule uses Chinese types and the exact version list without mutating existing settings', () => {
  const { versionedFields, VERSIONED_TYPES, VERSIONED_VERSIONS } = require('../out/fields');
  const config = base(), before = clone(config);
  const fields = versionedFields(config);
  assert.deepEqual(fields.map(field => field.id), ['type','version','module','description']);
  assert.deepEqual(fields[0].options, ['新增','修复','文档','格式','重构','优化','测试','构建','集成','维护','回退']);
  assert.deepEqual(fields[1].options, ['1.0.0','1.5.0','2.0.0','2.5.0','3.0.0','3.5.0','4.0.0','4.5.0']);
  assert.equal(fields[1].defaultValue, '1.0.0');
  assert.ok(fields.every(field => field.enabled && field.required));
  assert.deepEqual(fields[2].options, config.modules);
  const layout = resolveLayout({...config, fieldLayout:{fields, template:null}});
  assert.equal(formatFields({type:'修复',version:'4.5.0',module:'用户登录',description:'修复登录失败'},layout), '【修复】【4.5.0】【用户登录】修复登录失败');
  fields[0].options.pop(); fields[1].options.pop();
  assert.equal(VERSIONED_TYPES.length, 11); assert.equal(VERSIONED_VERSIONS.length, 8);
  assert.deepEqual(config, before);
});

test('Conventional Commits defaults support all suggested types, optional scope and breaking markers', () => {
  const { CONVENTIONAL_TEMPLATE, CONVENTIONAL_TYPES } = require('../out/model');
  const config = { ...base(), types: CONVENTIONAL_TYPES, template: CONVENTIONAL_TEMPLATE };
  const layout = resolveLayout(config);
  assert.deepEqual(layout.fields.map(field => field.id), ['type', 'module', 'description']);
  assert.equal(layout.fields[1].required, false);
  assert.deepEqual(layout.fields[0].options, CONVENTIONAL_TYPES);
  for (const type of CONVENTIONAL_TYPES) {
    assert.equal(formatFields({ type, module: 'auth', description: '更新登录逻辑' }, layout), `${type}(auth): 更新登录逻辑`);
    assert.equal(formatFields({ type, module: '', description: 'Update login' }, layout), `${type}: Update login`);
  }
  assert.equal(formatFields({ type: 'feat!', module: 'api', description: 'Change response structure' }, layout), 'feat(api)!: Change response structure');
  assert.equal(formatFields({ type: 'feat!', module: '', description: 'Change API' }, layout), 'feat!: Change API');
  assert.throws(() => formatFields({ type: '修复', module: '', description: 'Fix' }, layout), /type/);
  assert.throws(() => formatFields({ type: 'fix', module: 'auth): spoof', description: 'Fix' }, layout), /scope/);
});

test('Conventional flow ignores incompatible old type suggestions without deleting their history', async () => {
  const { CONVENTIONAL_TEMPLATE, CONVENTIONAL_TYPES } = require('../out/model');
  let message, saved; const calls = [];
  await generate({ targets: async () => [{key:'repo',label:'Repo',path:'/repo',canWrite:true}],
    config: () => ({...base(),types:CONVENTIONAL_TYPES,template:CONVENTIONAL_TEMPLATE}),
    recent: () => ({type:'修复',version:'1.2.0'}), history: () => ({type:['修复','fix'],version:['1.2.0']}),
    input: async (id,value,options,step,definition,total) => {calls.push({id,value,options,total});return {kind:'value',value:id==='type'?'fix':id==='module'?'':'修复登录失败'};},
    pick:async()=> 'write',read:()=>'',write:(_target,value)=>{message=value;},save:async(_target,value)=>{saved=value;},
    copy:async()=>{},confirm:async()=>true,info(){},error:reason=>assert.fail(reason)
  });
  assert.deepEqual(calls.map(call=>call.id),['type','module','description']);
  assert.equal(calls[0].value,''); assert.ok(!calls[0].options.includes('修复'));
  assert.equal(message,'fix: 修复登录失败'); assert.deepEqual(saved,{type:'fix',module:''});
});

test('legacy defaults/templates and automatic layouts reproduce existing output', () => {
  const config = base();
  const values = { type: 'Fixed', version: '1.2.0', module: 'Users', description: 'Fix login' };
  assert.equal(formatFields(values, resolveLayout(config)), '【Fixed】【1.2.0】【Users】Fix login');
  config.template = '{type}({module}): {description} [{version}]';
  assert.equal(formatFields(values, resolveLayout(config)), 'Fixed(Users): Fix login [1.2.0]');
  assert.equal(fieldLabel(legacyFields(config)[0], 'en'), 'Type');
  assert.equal(fieldLabel(legacyFields(config)[0], 'zh-cn'), '类型');
});

test('an empty settings object preserves legacy candidates, defaults and template', () => {
  const config = base();
  config.fieldLayout = {};
  config.template = '{type}({module}): {description} [{version}]';
  const layout = resolveLayout(config);
  assert.deepEqual(layout.fields, legacyFields(config));
  assert.equal(formatFields({ type: 'Fixed', module: 'Users', description: 'Fix login', version: '1.2.0' }, layout), 'Fixed(Users): Fix login [1.2.0]');
});

test('remove/disable/reorder/add fields and omit empty optional segments', () => {
  const config = base(), defaults = legacyFields(config);
  config.fieldLayout = { template: null, fields: [extra(), { ...defaults[2], required: false }, defaults[0], defaults[3], { ...defaults[1], enabled: false }] };
  const resolved = resolveLayout(config);
  assert.equal(formatFields({ issue: '', module: '', type: 'Fixed', description: 'Fix login', version: 'SHOULD NOT APPEAR' }, resolved), '【Fixed】Fix login');
  assert.equal(formatFields({ issue: 'ABC-12', module: 'Users', type: 'Fixed', description: '{issue}' }, resolved), '【ABC-12】【Users】【Fixed】{issue}');
  config.fieldLayout.fields = config.fieldLayout.fields.filter(field => field.id !== 'version');
  assert.ok(!resolveLayout(config).template.includes('{version}'));
  assert.match(validateFieldValue(extra(), '\n'), /single line/);
});

test('custom template validates enabled IDs and drops configured wrappers for skipped fields', () => {
  const config = base(), defaults = legacyFields(config);
  config.fieldLayout = { fields: [defaults[0], extra(), defaults[3], { ...defaults[1], enabled: false }], template: '{type}【{issue}】【{version}】: {description}' };
  assert.equal(formatFields({ type: 'Fixed', issue: '', description: 'Fix login' }, resolveLayout(config)), 'Fixed: Fix login');
  config.fieldLayout.template = '{unknown}{type}{description}';
  assert.throws(() => resolveLayout(config), /unknown/);
  config.fieldLayout.template = '{type}{issue}';
  assert.throws(() => resolveLayout(config), /description/);
  config.fieldLayout.template = '{type}{type}{issue}{description}';
  assert.throws(() => resolveLayout(config), /exactly once/);
});

test('invalid IDs, duplicate fields, missing required fields and malformed configs fail before mutation', () => {
  const valid = { fields: legacyFields(base()), template: null };
  const invalid = [null, {}, { ...valid, fields: [] }, { ...valid, fields: Array(31).fill(extra()) },
    { ...valid, fields: [extra(), extra()] },
    ...['__proto__', 'constructor', 'a-b', '1id'].map(id => ({ ...valid, fields: [{ ...valid.fields[0], id }] })),
    ...['enabled', 'required', 'remember'].map(key => ({ ...valid, fields: [{ ...valid.fields[0], [key]: 'yes' }] })),
    { ...valid, fields: [{ ...extra(), label: '' }] },
    { ...valid, fields: [{ ...extra(), required: true, prefix: '{' }] },
    { ...valid, fields: [{ ...extra(), required: true, options: ['line\nbreak'] }] },
    { ...valid, fields: valid.fields.map(field => ({ ...field, required: false })) },
    { ...valid, fields: valid.fields.map(field => ({ ...field, enabled: false })) }
  ];
  for (const layout of invalid) assert.throws(() => validateLayout(layout));
});

test('custom field history survives renaming, skipping, deactivation and recreation of storage service', async () => {
  const memory = new Map();
  const storage = { get: key => memory.has(key) ? JSON.parse(memory.get(key)) : undefined, update: async (key, value) => memory.set(key, JSON.stringify(value)) };
  let store = createHistoryStore(storage);
  await store.save('a', { type: 'Fixed', version: '1.2.0', module: 'Users' });
  await store.save('a', { issue: 'ABC-12', type: 'Added' });
  store = createHistoryStore(storage);
  assert.deepEqual(store.history('a').issue, ['ABC-12']);
  assert.equal(store.recent('a').version, '1.2.0');
  await store.save('a', { issue: '' });
  assert.deepEqual(store.history('a').issue, ['ABC-12']);
  assert.equal(store.recent('a').issue, '');
  assert.deepEqual(store.history('b'), { type: [], version: [], module: [] });
});

test('dynamic wizard follows configured order/count, validates/skips and saves only remembered enabled fields', async () => {
  const config = base(), defaults = legacyFields(config);
  config.fieldLayout = { fields: [extra(), defaults[0], { ...defaults[2], required: false }, defaults[3]], template: null };
  let written, saved, stepCalls = [];
  const services = {
    targets: async () => [{ key: 'a', label: 'Repo', path: '/a', canWrite: true }], config: () => config,
    recent: () => ({ version: 'OLD', issue: 'ABC-12' }), history: () => ({ issue: ['ABC-12'], type: [], module: [], version: [] }),
    input: async (id, value, options, step, definition, total) => { stepCalls.push({ id, value, options, step, definition, total }); return { kind: 'value', value: { issue: '', type: 'Fixed', module: '', description: 'Fix login' }[id] }; },
    pick: async () => 'write', read: () => '', write: (_target, message) => { written = message; }, save: async (_target, value) => { saved = value; },
    copy: async () => {}, confirm: async () => true, info() {}, error: message => assert.fail(message)
  };
  await generate(services);
  assert.deepEqual(stepCalls.map(call => call.id), ['issue', 'type', 'module', 'description']);
  assert.deepEqual(stepCalls.map(call => call.step), [1, 2, 3, 4]);
  assert.ok(stepCalls.every(call => call.total === 4));
  assert.equal(stepCalls[0].value, 'ABC-12');
  assert.equal(written, '【Fixed】Fix login');
  assert.deepEqual(saved, { issue: '', type: 'Fixed', module: '' });
  config.fieldLayout.fields[0].label = 'Ticket';
  stepCalls = []; await generate(services);
  assert.equal(stepCalls[0].value, 'ABC-12', 'renaming label keeps ID-based history');
});
