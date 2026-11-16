const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHistoryStore } = require('../out/history');
const { generate } = require('../out/workflow');
const { DEFAULT_TEMPLATE } = require('../out/model');

function storageFixture() {
  const data = new Map();
  const storage = { get: key => data.has(key) ? JSON.parse(data.get(key)) : undefined,
    update: async (key, value) => data.set(key, JSON.stringify(value)) };
  return { data, storage, store: createHistoryStore(storage) };
}

test('accumulates custom types, versions and modules across sessions; deduplicates and promotes latest', async () => {
  const { storage, data, store } = storageFixture();
  const first = { type: '维护', version: '4.8.0', module: '测试模块' };
  const second = { type: '修复', version: '4.9.0', module: '地图' };
  await store.save('repo-a', first);
  await createHistoryStore(storage).save('repo-a', second);
  let reloaded = createHistoryStore(storage);
  assert.deepEqual(reloaded.history('repo-a'), { type: ['修复', '维护'], version: ['4.9.0', '4.8.0'], module: ['地图', '测试模块'] });
  await reloaded.save('repo-a', { ...first, version: ' 4.8.0 ' });
  reloaded = createHistoryStore(storage);
  assert.deepEqual(reloaded.history('repo-a'), { type: ['维护', '修复'], version: ['4.8.0', '4.9.0'], module: ['测试模块', '地图'] });
  assert.deepEqual(reloaded.recent('repo-a'), first);
  assert.equal(data.size, 1, 'single atomic record per repository');
  assert.deepEqual(reloaded.history('repo-b'), { type: [], version: [], module: [] });
  assert.equal(reloaded.recent('repo-b'), undefined);
});

test('imports 0.1.0 recent selections without losing them on the first new save', async () => {
  const { storage, store } = storageFixture();
  const legacy = { type: '样式', version: '4.8.0', module: '测试模块' };
  await storage.update('recent:repo-a', legacy);
  assert.deepEqual(store.recent('repo-a'), legacy);
  assert.deepEqual(store.history('repo-a').module, ['测试模块']);
  await store.save('repo-a', { type: '新增', version: '4.9.0', module: '地图' });
  assert.deepEqual(store.history('repo-a').version, ['4.9.0', '4.8.0']);
  assert.deepEqual(store.history('repo-a').module, ['地图', '测试模块']);
});

test('cancel, overwrite refusal and clipboard failure leave persistent candidates untouched', async () => {
  const { store, data } = storageFixture();
  const values = { type: '维护', version: '4.8.0', module: '测试模块' };
  const target = { key: 'repo-a', label: 'A', path: '/a', canWrite: true };
  await store.save(target.key, values);
  const before = data.get('selections:repo-a');
  const services = {
    targets: async () => [target], config: () => ({ types: [], versions: [], modules: [], defaultVersion: '', template: DEFAULT_TEMPLATE, rememberLastValues: true }),
    recent: t => store.recent(t.key), history: t => store.history(t.key), save: (t, v) => store.save(t.key, v),
    input: async field => ({ kind: 'value', value: field === 'description' ? '新功能' : '新值' }),
    pick: async () => 'write', read: () => '已有文字', confirm: async () => false,
    write: () => assert.fail('must not write'), copy: async () => { throw new Error('clipboard failed'); }, info() {}, error() {}
  };
  await generate({ ...services, input: async () => undefined });
  assert.equal(data.get('selections:repo-a'), before);
  await generate(services);
  assert.equal(data.get('selections:repo-a'), before);
  await assert.rejects(generate({ ...services, pick: async () => 'copy' }), /clipboard failed/);
  assert.equal(data.get('selections:repo-a'), before);
  await assert.rejects(store.save(target.key, { ...values, module: '\n' }));
  assert.equal(data.get('selections:repo-a'), before);
});
