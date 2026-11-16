(() => {
  const api = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  let strings = {}, fields = [], defaults = [], labels = {}, scope, restore = false, original = true;
  let dirty = false, busy = true, valid = false, request = 0, timer;
  let defaultsTemplate = '', defaultsAutomatic = true;
  let conventionalDefaults = [], versionedDefaults = [];
  const clone = value => JSON.parse(JSON.stringify(value));
  function text(key) { return strings[key] || key; }
  function say(message = '', failed = false) { $('feedback').textContent = message; $('feedback').className = failed ? 'error' : ''; }
  function snapshot() { return { fields: clone(fields), template: $('automatic').checked ? null : $('template').value }; }
  function controls() {
    $('template-section').hidden = false;
    $('template').readOnly = $('automatic').checked;
    if ($('automatic').checked) $('template').value = fields.filter(field => field.enabled).map(field => `${field.prefix}{${field.id}}${field.suffix}`).join('');
    $('save').disabled = busy || !dirty || !valid;
    $('scope').disabled = busy;
    $('add').disabled = busy;
    $('conventional').disabled = busy;
    $('versioned').disabled = busy;
    $('reload').disabled = busy;
    $('reset').disabled = busy;
    $('status').textContent = dirty ? text('dirty') : '';
    document.querySelector('main').setAttribute('aria-busy', String(busy));
    document.querySelectorAll('#fields input,#fields select,#fields textarea,#fields button,#automatic,#template').forEach(control => { control.disabled = busy || control.dataset.edge === 'true'; });
  }
  function preview() {
    clearTimeout(timer); valid = false; controls();
    const current = ++request;
    timer = setTimeout(() => api.postMessage({ kind: 'preview', scope, request: current, layout: snapshot(), restore }), 120);
  }
  function changed() { dirty = true; original = false; restore = false; say(); $('mode').textContent = text('customized'); preview(); }
  function make(tag, className, content) { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node; }
  function inputControl(field, key, parent, multiline = false) {
    const label = make('label', 'control'); label.append(make('span', '', text(key)));
    const input = make(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    input.value = multiline ? field[key].join('\n') : field[key];
    input.setAttribute('aria-label', text(key)); input.dataset.property = key;
    input.addEventListener('input', () => { field[key] = multiline ? input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean) : input.value; changed(); });
    label.append(input); parent.append(label); return input;
  }
  function render() {
    const container = $('fields'); container.replaceChildren();
    fields.forEach((field, index) => {
      const card = make('section', 'field-card' + (field.enabled ? '' : ' inactive')); card.dataset.id = field.id;
      const head = make('div', 'card-head'); head.append(make('span', 'order', String(index + 1).padStart(2, '0')));
      const name = make('input', 'field-name'); name.type = 'text'; name.value = field.label || labels[field.id] || ''; name.placeholder = text('newField'); name.setAttribute('aria-label', text('label'));
      name.addEventListener('input', () => { field.label = name.value; changed(); }); head.append(name);
      for (const [key, symbol, offset] of [['up', '↑', -1], ['down', '↓', 1], ['remove', '×', 0]]) {
        const button = make('button', '', symbol); button.type = 'button'; button.setAttribute('aria-label', text(key)); button.title = text(key);
        if (offset && (index + offset < 0 || index + offset >= fields.length)) button.dataset.edge = 'true';
        button.addEventListener('click', () => {
          if (!offset) fields.splice(index, 1);
          else { const moved = fields.splice(index, 1)[0]; fields.splice(index + offset, 0, moved); }
          changed(); render();
        }); head.append(button);
      }
      card.append(head);
      const id = make('p', 'stable-id'); id.append(document.createTextNode(text('id') + ': '), make('code', '', field.id)); card.append(id);
      const body = make('div', 'card-body'); const checks = make('div', 'checks');
      for (const key of ['enabled', 'required', 'remember']) {
        const label = make('label', 'check'), checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = field[key]; checkbox.dataset.property = key;
        checkbox.addEventListener('change', () => { field[key] = checkbox.checked; card.classList.toggle('inactive', !field.enabled); changed(); });
        label.append(checkbox, make('span', '', text(key))); checks.append(label);
      }
      body.append(checks);
      const modeLabel = make('label', 'control'); modeLabel.append(make('span', '', text('input')));
      const mode = make('select'); mode.setAttribute('aria-label', text('input'));
      for (const option of ['suggest', 'text']) { const node = make('option', '', text(option)); node.value = option; mode.append(node); }
      mode.value = field.input; mode.addEventListener('change', () => { field.input = mode.value; changed(); }); modeLabel.append(mode); body.append(modeLabel);
      inputControl(field, 'defaultValue', body);
      inputControl(field, 'options', body, true);
      const format = make('div', 'format-row'); inputControl(field, 'prefix', format); inputControl(field, 'suffix', format); body.append(format);
      card.append(body); container.append(card);
    });
    controls();
  }
  $('add').addEventListener('click', () => {
    fields.push({ id: 'field_' + crypto.randomUUID().replaceAll('-', ''), label: text('newField'), input: 'suggest', enabled: true, required: false, remember: true, options: [], defaultValue: '', prefix: '【', suffix: '】' });
    changed(); render(); const last = $('fields').lastElementChild; last.scrollIntoView({ block: 'nearest' }); last.querySelector('.field-name').focus();
  });
  $('automatic').addEventListener('change', () => {
    $('template-section').hidden = $('automatic').checked;
    $('auto-hint').hidden = !$('automatic').checked;
    if (!$('automatic').checked && !$('template').value) $('template').value = fields.filter(field => field.enabled).map(field => `${field.prefix}{${field.id}}${field.suffix}`).join('');
    changed();
  });
  $('template').addEventListener('input', changed);
  $('conventional').addEventListener('click', () => {
    fields = clone(conventionalDefaults); $('automatic').checked = true;
    changed(); render();
  });
  $('versioned').addEventListener('click', () => {
    fields = clone(versionedDefaults); $('automatic').checked = true;
    changed(); render();
  });
  $('save').addEventListener('click', () => { if (busy || !dirty || !valid) return; clearTimeout(timer); busy = true; say(); controls(); api.postMessage({ kind: 'save', scope, layout: snapshot(), restore }); });
  $('reload').addEventListener('click', () => { if (busy) return; clearTimeout(timer); ++request; busy = true; controls(); api.postMessage({ kind: 'load', scope }); });
  $('reset').addEventListener('click', () => {
    fields = clone(defaults); $('template').value = defaultsTemplate; $('automatic').checked = defaultsAutomatic; $('template-section').hidden = defaultsAutomatic; $('auto-hint').hidden = !defaultsAutomatic;
    dirty = true; restore = true; original = true; say(text('resetHint')); $('mode').textContent = text('legacy'); render(); preview();
  });
  $('scope').addEventListener('change', () => {
    if (dirty) { $('scope').value = scope; say(text('switchDirty'), true); return; }
    const next = $('scope').value; clearTimeout(timer); ++request; busy = true; controls(); api.postMessage({ kind: 'load', scope: next });
  });
  window.addEventListener('message', event => {
    const message = event.data; if (!message || typeof message !== 'object') return;
    if (message.kind === 'loaded') {
      clearTimeout(timer); ++request; strings = message.strings; labels = message.labels; scope = message.scope; fields = clone(message.fields); defaults = clone(message.defaults); original = message.original;
      defaultsTemplate = message.defaultsTemplate; defaultsAutomatic = message.defaultsAutomatic;
      conventionalDefaults = clone(message.conventionalDefaults);
      versionedDefaults = clone(message.versionedDefaults);
      restore = original; dirty = Boolean(message.warning); busy = false;
      document.documentElement.lang = strings.title === '配置提交字段' ? 'zh-CN' : 'en';
      document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = text(node.dataset.i18n); });
      $('scope').replaceChildren(...message.scopes.map(item => { const node = make('option', '', item.label); node.value = item.id; return node; })); $('scope').value = scope;
      $('mode').textContent = text(original ? 'legacy' : 'customized');
      const automatic = message.automatic;
      $('automatic').checked = automatic; $('template').value = message.template ?? ''; $('template-section').hidden = automatic; $('auto-hint').hidden = !automatic;
      say(message.warning || '', Boolean(message.warning)); render(); preview();
    } else if (message.kind === 'preview' || message.kind === 'previewError') {
      if (message.request !== request) return;
      valid = message.kind === 'preview'; $('preview').textContent = valid ? message.text : ''; $('validation').textContent = valid ? '' : message.message; controls();
    } else if (message.kind === 'saved') { busy = false; dirty = false; say(message.message); controls(); }
    else if (message.kind === 'error') { busy = false; say(message.message, true); controls(); }
  });
  api.postMessage({ kind: 'ready' });
})();
