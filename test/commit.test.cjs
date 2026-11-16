const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generate } = require('../out/workflow');
const { deliver } = require('../out/submission');
const { DEFAULT_TEMPLATE } = require('../out/model');
const { translate } = require('../out/i18n');
const values = { type: 'Fixed', version: '1.2.0', module: 'Authentication', description: 'Handle expired sessions' };
const message = '【Fixed】【1.2.0】【Authentication】Handle expired sessions';

function fixture(language = 'en') {
  const state = { actions: [], commits: [], saved: [], notices: [], errors: [], inputs: 0 };
  const target = { key: 'repo-a', label: 'project', path: '/project', canWrite: true };
  const services = {
    language, targets: async () => [target],
    config: () => ({ types: ['Fixed'], versions: [], modules: [], defaultVersion: '', template: DEFAULT_TEMPLATE, rememberLastValues: true }),
    recent: () => undefined, history: () => ({ type: [], version: [], module: [] }),
    input: async field => { state.inputs++; return { kind: 'value', value: values[field] }; },
    pick: async (_title, choices) => { state.actions.push(choices); return 'commit'; },
    commit: async (chosen, text) => state.commits.push({ key: chosen.key, text }),
    save: async (chosen, selected) => state.saved.push({ key: chosen.key, selected }),
    read: () => assert.fail('direct commit must not overwrite input'),
    write: () => assert.fail('direct commit must not fill input'), copy: async () => assert.fail('must not copy'),
    confirm: async () => assert.fail('no extra confirmation for explicitly chosen commit'),
    info: text => state.notices.push(text), error: text => state.errors.push(text)
  };
  return { services, target, state };
}

test('explicit commit action commits selected target and saves only after success, in both languages', async () => {
  for (const language of ['en', 'zh-cn']) {
    const { services, state } = fixture(language);
    await generate(services);
    assert.deepEqual(state.actions[0].map(item => item.id), ['write', 'commit', 'copy', 'edit']);
    assert.ok(state.actions[0][1].detail.includes(translate(language, 'commitDetail', 'project')));
    assert.deepEqual(state.commits, [{ key: 'repo-a', text: message }]);
    assert.deepEqual(state.saved[0].selected, { type: 'Fixed', version: '1.2.0', module: 'Authentication' });
    assert.equal(state.notices[0], translate(language, 'committed', 'project'));
  }
});

test('commit failure keeps entered values in preview and permits retry without recording success early', async () => {
  const { services, state } = fixture();
  let calls = 0;
  services.commit = async () => { if (++calls === 1) throw new Error('hook rejected'); };
  services.pick = async (_title, choices) => {
    state.actions.push(choices);
    if (state.actions.length === 2) {
      assert.equal(state.saved.length, 0); assert.equal(state.notices.length, 0);
      assert.equal(choices[1].detail.split('\n')[0], message);
    }
    return 'commit';
  };
  await generate(services);
  assert.equal(state.inputs, 4);
  assert.equal(calls, 2); assert.equal(state.saved.length, 1);
  assert.match(state.errors[0], /hook rejected/);
});

test('failed commit can be copied or cancelled; copy-only mode never exposes commit', async () => {
  for (const fallback of ['copy', undefined]) {
    const { services, state } = fixture();
    let picks = 0, copied;
    services.pick = async () => ++picks === 1 ? 'commit' : fallback;
    services.commit = async () => { throw new Error('No staged changes'); };
    services.copy = async text => { copied = text; };
    await generate(services);
    assert.equal(copied, fallback ? message : undefined);
    assert.equal(state.saved.length, fallback ? 1 : 0);
  }
  const { services, target, state } = fixture();
  services.targets = async () => [{ ...target, canWrite: false }];
  services.pick = async (_title, choices) => { assert.deepEqual(choices.map(item => item.id), ['copy', 'edit']); return undefined; };
  await generate(services);
  assert.equal(state.commits.length, 0);
});

test('commit capability is required, and history failure reports that the commit already succeeded', async () => {
  const { services, target, state } = fixture();
  await assert.rejects(deliver({ ...services, commit: undefined }, target, values, DEFAULT_TEMPLATE, 'commit', true), /unavailable/);
  assert.equal(state.saved.length, 0);
  services.save = async () => { throw new Error('storage failed'); };
  await deliver(services, target, values, DEFAULT_TEMPLATE, 'commit', true);
  assert.equal(state.commits.length, 1);
  assert.equal(state.notices[0], translate('en', 'committedHistoryFailed'));
});
