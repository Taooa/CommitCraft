const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ComposerSession } = require('../out/composer-session');
const { DEFAULT_TEMPLATE } = require('../out/model');

const values = { type: '修复', version: '4.8.0', module: '测试模块', description: '修复测试' };
function fixture() {
  const messages = [], writes = [], saved = [];
  const targets = [{ key: 'a', label: 'A', path: '/a', canWrite: true }, { key: 'b', label: 'B', path: '/b', canWrite: false }];
  const services = {
    targets: async () => targets,
    config: () => ({ types: ['新增', '修复'], versions: [], modules: [], defaultVersion: '4.8.0', template: DEFAULT_TEMPLATE, rememberLastValues: true }),
    recent: () => undefined, history: () => ({ type: [], version: ['4.8.0'], module: ['测试模块'] }),
    read: () => '', write: (target, message) => writes.push([target.key, message]), copy: async message => writes.push(['clipboard', message]),
    confirm: async () => false, save: async (target, values) => saved.push([target.key, values]), info() {}, error() {}
  };
  const session = new ComposerSession(services, message => messages.push(message), 'a');
  return { session, services, messages, writes, saved };
}

test('form bootstraps the intended repo, defaults, and accumulated candidates', async () => {
  const { session, messages } = fixture();
  await session.handle({ kind: 'ready' });
  assert.equal(messages[0].kind, 'init');
  assert.equal(messages[0].model.target.key, 'a');
  assert.equal(messages[0].model.values.version, '4.8.0');
  assert.deepEqual(messages[0].model.options.module, ['测试模块']);
});

test('server validates payload and selected repository before changing Git or history', async () => {
  const { session, messages, writes, saved } = fixture();
  await session.handle({ kind: 'ready' });
  for (const message of [
    { kind: 'submit', key: 'b', action: 'write', values },
    { kind: 'submit', key: 'a', action: 'execute', values },
    { kind: 'submit', key: 'a', action: 'write', values: { ...values, version: 12 } },
    { kind: 'submit', key: 'a', action: 'write', values: { ...values, description: 'a\nb' } }
  ]) {
    await session.handle(message);
    assert.equal(messages.at(-1).kind, 'error');
  }
  assert.deepEqual(writes, []); assert.deepEqual(saved, []);
  await session.handle({ kind: 'submit', key: 'a', action: 'write', values });
  assert.deepEqual(writes, [['a', '【修复】【4.8.0】【测试模块】修复测试']]);
  assert.equal(saved.length, 1);
  assert.equal(messages.at(-1).success, true);
});

test('copy-only target rejects writes; cancelled overwrites preserve text and do not save', async () => {
  const { session, services, messages, writes, saved } = fixture();
  await session.handle({ kind: 'ready' });
  services.read = () => '已有信息';
  await session.handle({ kind: 'submit', key: 'a', action: 'write', values });
  assert.equal(messages.at(-1).success, false);
  assert.equal(saved.length, 0);
  await session.handle({ kind: 'select', key: 'b' });
  await session.handle({ kind: 'submit', key: 'b', action: 'write', values });
  assert.equal(messages.at(-1).kind, 'error');
  assert.equal(writes.length, 0);
  await session.handle({ kind: 'submit', key: 'b', action: 'copy', values });
  assert.deepEqual(writes, [['clipboard', '【修复】【4.8.0】【测试模块】修复测试']]);
});

test('duplicate clicks cannot generate concurrent submissions; errors allow retry', async () => {
  const { session, services, messages, saved } = fixture();
  await session.handle({ kind: 'ready' });
  let finish;
  services.copy = () => new Promise(resolve => { finish = resolve; });
  const pending = session.handle({ kind: 'submit', key: 'a', action: 'copy', values });
  await session.handle({ kind: 'submit', key: 'a', action: 'copy', values });
  await session.handle({ kind: 'select', key: 'b' });
  finish(); await pending;
  assert.equal(saved.length, 1);
  services.copy = async () => { throw new Error('复制失败'); };
  await session.handle({ kind: 'submit', key: 'a', action: 'copy', values });
  assert.equal(messages.at(-1).message, '复制失败');
  services.copy = async () => {};
  await session.handle({ kind: 'submit', key: 'a', action: 'copy', values });
  assert.equal(messages.at(-1).success, true);
});
