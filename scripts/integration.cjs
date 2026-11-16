const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const code = process.env.VSCODE_EXECUTABLE;
const locale = process.env.COMMITCRAFT_TEST_LOCALE || 'en';
if (!code) throw new Error('设置 VSCODE_EXECUTABLE 为 Code.exe 的绝对路径，再运行 npm run test:integration。');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-helper-test-'));
try {
  const repo = path.join(temporary, 'repository');
  fs.mkdirSync(repo);
  const git = spawnSync('git', ['init', repo], { encoding: 'utf8' });
  if (git.status !== 0) throw new Error(git.stderr);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.COMMITCRAFT_TEST_LANGUAGE_PACK) {
    const languagePack = path.resolve(process.env.COMMITCRAFT_TEST_LANGUAGE_PACK);
    fs.mkdirSync(path.join(temporary, 'extensions'), { recursive: true });
    const installedPack = path.join(temporary, 'extensions', path.basename(languagePack));
    fs.cpSync(languagePack, installedPack, { recursive: true });
    // Seed the isolated locale cache before startup; copying a pack alone only
    // discovers it after the first launch, too late to select that launch's locale.
    const manifest = JSON.parse(fs.readFileSync(path.join(installedPack, 'package.json'), 'utf8'));
    const cache = {};
    for (const localization of manifest.contributes.localizations) {
      cache[localization.languageId] = {
        hash: createHash('md5').update(manifest.publisher + '.' + manifest.name + manifest.version).digest('hex'),
        extensions: [{ extensionIdentifier: { id: manifest.publisher + '.' + manifest.name }, version: manifest.version }],
        translations: Object.fromEntries(localization.translations.map(item => [item.id, path.resolve(installedPack, item.path)]))
      };
    }
    fs.mkdirSync(path.join(temporary, 'profile'), { recursive: true });
    fs.writeFileSync(path.join(temporary, 'profile', 'languagepacks.json'), JSON.stringify(cache));
  }
  const result = spawnSync(code, [repo, '--extensionDevelopmentPath=' + root,
    '--locale=' + locale,
    '--extensionTestsPath=' + path.join(root, 'test', 'host.cjs'),
    '--user-data-dir=' + path.join(temporary, 'profile'),
    '--extensions-dir=' + path.join(temporary, 'extensions'), '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-workspace-trust', '--new-window'],
    { env, stdio: 'inherit', timeout: 120000 });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  // VS Code may retain profile handles briefly; preserve temporary diagnostics if locked.
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('commit-helper-test-')) {
    throw new Error('拒绝清理测试临时目录以外的路径：' + resolved);
  }
  try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { console.log('测试临时目录：' + resolved); }
}
