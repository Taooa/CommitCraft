(() => {
  const vscode = acquireVsCodeApi();
  const fields = ['type', 'version', 'module', 'description'];
  const $ = id => document.getElementById(id);
  const controls = Object.fromEntries(fields.map(field => [field, $(field)]));
  Object.values(controls).forEach(control => { control.disabled = true; });
  $('shortcut-key').textContent = /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';
  const drafts = new Map();
  const touched = new Set();
  let model;
  let busy = true;
  let selecting = false;
  const typeIcons = { '新增': '＋', '修复': '↻', '样式': '◈' };
  const values = () => Object.fromEntries(fields.map(field => [field, controls[field].value]));
  function error(field, value) {
    if (!value.trim()) return '请填写此项';
    if (/[\r\n\u2028\u2029\x00-\x1f\x7f]/u.test(value)) return '请使用单行文字，不包含换行或控制字符';
    if (field !== 'description' && /[【】]/u.test(value)) return '此项不能包含【或】';
    return '';
  }
  function feedback(text = '', failed = false) { $('feedback').textContent = text; $('feedback').classList.toggle('error', failed); }
  function renderChips(field) {
    const container = $(field + '-options');
    container.replaceChildren();
    for (const value of model.options[field]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'chip'; button.dataset.value = value;
      button.textContent = field === 'type' && typeIcons[value] ? `${typeIcons[value]}  ${value}` : value;
      button.setAttribute('aria-label', value);
      button.setAttribute('aria-pressed', String(value === controls[field].value.trim()));
      button.disabled = busy;
      button.addEventListener('click', () => { controls[field].value = value; touched.add(field); feedback(); update(); });
      container.append(button);
    }
  }
  function update() {
    if (!model) return;
    const current = values();
    const valid = fields.every(field => !error(field, current[field])) && !model.templateError;
    fields.forEach(field => {
      const issue = touched.has(field) ? error(field, current[field]) : '';
      $(field + '-error').textContent = issue;
      controls[field].setAttribute('aria-invalid', String(Boolean(issue)));
      controls[field].disabled = busy;
      if (field !== 'description') for (const chip of $(field + '-options').children) {
        chip.setAttribute('aria-pressed', String(chip.dataset.value === current[field].trim())); chip.disabled = busy;
      }
    });
    const hasValues = fields.some(field => current[field].trim());
    const message = model.template.replace(/\{(type|version|module|description)\}/gu, (_, field) => current[field].trim() || ({ type: '类型', version: '版本', module: '模块', description: '具体功能' })[field]);
    $('preview-message').textContent = hasValues ? message : '填写上方信息，即可预览提交描述';
    $('preview-message').classList.toggle('empty', !valid);
    $('character-count').textContent = valid ? `${[...message].length} 字` : '待填写完整';
    $('template-error').textContent = model.templateError ?? '';
    $('copy').disabled = busy || !valid;
    $('write').disabled = busy || !valid || !model.target.canWrite;
    $('write').hidden = !model.target.canWrite;
    $('repository').disabled = busy;
    document.querySelector('main').setAttribute('aria-busy', String(busy));
  }
  function apply(next, preserve = false) {
    model = next;
    if (!preserve) {
      const draft = drafts.get(model.target.key) ?? model.values;
      fields.forEach(field => { controls[field].value = draft[field]; }); touched.clear();
    }
    $('repository').value = model.target.key;
    $('repo-path').textContent = model.target.path;
    $('repo-mode').textContent = model.target.canWrite ? 'Git 仓库' : '仅复制';
    $('shortcut-hint').textContent = model.target.canWrite ? '快速填入' : '快速复制';
    $('history-note').textContent = model.remember ? '用过的类型、版本和模块会自动保留' : '本次不读取或保存使用记录';
    ['type', 'version', 'module'].forEach(renderChips);
    update();
  }
  function submit(action) {
    if (!model || busy) return;
    fields.forEach(field => touched.add(field)); update();
    const invalid = fields.find(field => error(field, controls[field].value));
    if (invalid) { controls[invalid].focus(); return; }
    if (model.templateError || (action === 'write' && !model.target.canWrite)) return;
    busy = true; feedback('正在处理…'); update();
    vscode.postMessage({ kind: 'submit', key: model.target.key, action, values: values() });
  }
  fields.forEach(field => {
    controls[field].addEventListener('input', () => { touched.add(field); feedback(); update(); });
    controls[field].addEventListener('blur', () => { touched.add(field); update(); });
  });
  $('repository').addEventListener('change', () => {
    if (!model || busy) return;
    drafts.set(model.target.key, values()); selecting = true; busy = true; feedback(); update();
    vscode.postMessage({ kind: 'select', key: $('repository').value });
  });
  $('commit-form').addEventListener('submit', event => { event.preventDefault(); submit('write'); });
  $('copy').addEventListener('click', () => submit('copy'));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit(model?.target.canWrite ? 'write' : 'copy'); }
  });
  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    busy = false;
    if (message.kind === 'init') {
      $('repository').replaceChildren(...message.targets.map(target => { const option = document.createElement('option'); option.value = target.key; option.textContent = target.label; return option; }));
      apply(message.model); controls.description.focus();
    } else if (message.kind === 'model') { selecting = false; apply(message.model); }
    else if (message.kind === 'complete') { apply(message.model, true); feedback(message.message); }
    else if (message.kind === 'error') { if (selecting && model) $('repository').value = model.target.key; selecting = false; feedback(message.message, true); update(); }
  });
  vscode.postMessage({ kind: 'ready' });
})();
