const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FieldEditorSession, editorStrings } = require('../out/field-editor-session');
const { legacyFields } = require('../out/fields');
const { DEFAULT_TEMPLATE } = require('../out/model');
function fixture(language = 'en') {
  const state = { config: { types: ['Fixed'], versions: [], modules: ['Users'], defaultVersion: '1.2.0', template: DEFAULT_TEMPLATE, rememberLastValues: true }, revision: '1', writes: [], messages: [] };
  const services = { language, scopes: [{ id: 'folder', label: 'Project' }], initialScope: 'folder',
    read: scope => { assert.equal(scope, 'folder'); return { config: state.config, revision: state.revision, source: 'Project' }; },
    write: async (scope, layout) => { state.writes.push({ scope, layout }); state.config = { ...state.config, fieldLayout: layout }; state.revision += '1'; }
  };
  return { state, services, session: new FieldEditorSession(services, message => state.messages.push(message)) };
}

test('preview and edits do not write settings until explicit save, which stores one atomic layout', async () => {
  const { session, state } = fixture(); await session.handle({ kind: 'ready' });
  const loaded = state.messages[0];
  assert.equal(loaded.original, true); assert.equal(loaded.automatic, true);
  const layout = { template: null, fields: loaded.fields.filter(field => field.id !== 'version') };
  await session.handle({ kind: 'preview', scope: 'folder', request: 10, layout });
  assert.equal(state.writes.length, 0);
  assert.equal(state.messages.at(-1).kind, 'preview'); assert.equal(state.messages.at(-1).request, 10);
  assert.ok(!state.messages.at(-1).text.includes('1.2.0'));
  await session.handle({ kind: 'save', scope: 'folder', layout });
  assert.equal(state.writes.length, 1); assert.equal(state.writes[0].layout.fields.length, 3);
  assert.equal(state.messages.at(-1).kind, 'saved');
});

test('validation and unknown scopes cannot write settings; reset returns to legacy mode', async () => {
  const { session, state } = fixture('zh-cn'); await session.handle({ kind: 'ready' });
  await session.handle({ kind: 'save', scope: 'user', layout: {} });
  assert.equal(state.writes.length, 0);
  await session.handle({ kind: 'save', scope: 'folder', layout: { fields: [], template: null } });
  assert.equal(state.writes.length, 0); assert.equal(state.messages.at(-1).kind, 'error');
  await session.handle({ kind: 'save', scope: 'folder', restore: true });
  assert.equal(state.writes[0].layout, null);
  assert.equal(state.messages.at(-1).message, editorStrings('zh-cn').saved);
});

test('external settings edits cause a conflict and preserve the external value until reload', async () => {
  const { session, state } = fixture(); await session.handle({ kind: 'ready' });
  const layout = { fields: legacyFields(state.config), template: null };
  state.revision = 'external';
  await session.handle({ kind: 'save', scope: 'folder', layout });
  assert.equal(state.writes.length, 0);
  assert.equal(state.messages.at(-1).message, editorStrings('en').conflict);
  await session.handle({ kind: 'load', scope: 'folder' });
  await session.handle({ kind: 'save', scope: 'folder', layout });
  assert.equal(state.writes.length, 1);
});

test('invalid stored layouts recover into editable original fields, and legacy custom templates remain visible', async () => {
  const { session, state } = fixture();
  state.config.fieldLayout = { fields: [], template: null };
  await session.handle({ kind: 'ready' });
  assert.ok(state.messages[0].warning); assert.equal(state.messages[0].fields.length, 4);
  state.config.fieldLayout = null; state.config.template = '{type}({module}): {description} [{version}]';
  await session.handle({ kind: 'load', scope: 'folder' });
  assert.equal(state.messages.at(-1).automatic, false);
  assert.equal(state.messages.at(-1).template, state.config.template);
  state.config.fieldLayout = {};
  await session.handle({ kind: 'load', scope: 'folder' });
  assert.equal(state.messages.at(-1).warning, '');
  assert.equal(state.messages.at(-1).original, true);
  assert.equal(state.messages.at(-1).fields.length, 4);
  assert.equal(state.messages.at(-1).template, state.config.template);
});

test('save failures are reported and English/Chinese editor catalogs have matching complete keys', async () => {
  const { session, services, state } = fixture(); await session.handle({ kind: 'ready' });
  services.write = async () => { throw new Error('write denied'); };
  await session.handle({ kind: 'save', scope: 'folder', restore: true });
  assert.match(state.messages.at(-1).message, /write denied/);
  assert.deepEqual(Object.keys(editorStrings('en')).sort(), Object.keys(editorStrings('zh-cn')).sort());
});

test('both rules are supplied from three-field base settings and only the chosen saved layout takes effect', async () => {
  const { CONVENTIONAL_TEMPLATE, CONVENTIONAL_TYPES } = require('../out/model');
  for (const language of ['en', 'zh-cn']) {
    const { session, state } = fixture(language);
    state.config.template = CONVENTIONAL_TEMPLATE; state.config.types = CONVENTIONAL_TYPES;
    await session.handle({ kind: 'ready' });
    const loaded = state.messages[0];
    assert.equal(loaded.fields.length, 3);
    assert.equal(loaded.labels.version, language === 'en' ? 'Product version' : '产品版本');
    const layout = { fields: loaded.versionedDefaults, template: null };
    await session.handle({ kind:'preview', scope:'folder', layout, request:1 });
    assert.equal(state.writes.length, 0);
    assert.equal(state.messages.at(-1).text, '【新增】【1.0.0】【Users】' + (language === 'en' ? 'Description' : '具体功能'));
    await session.handle({kind:'save',scope:'folder',layout});
    assert.deepEqual(state.config.fieldLayout.fields.map(field=>field.id), ['type','version','module','description']);
    await session.handle({kind:'load',scope:'folder'});
    assert.equal(state.messages.at(-1).fields.length, 4);
    await session.handle({kind:'save',scope:'folder',layout:{fields:loaded.conventionalDefaults,template:null}});
    assert.equal(state.config.fieldLayout.fields.length,3);
    assert.deepEqual(state.config.fieldLayout.fields[0].options,CONVENTIONAL_TYPES);
  }
});
