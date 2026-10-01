import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileIdeUrl } from '../ui/scripts/main.js';

// Execute the exact page published by the installer, on the origin selected by
// Remote's launch redirect. No installation IDs are cached in the extension.
const installer = fs.readFileSync(new URL('./install.sh', import.meta.url), 'utf8');
const html = installer.split("<<'REMOTE_OPEN_HTML'\n")[1].split('\nREMOTE_OPEN_HTML')[0];
const script = html.split('<script>')[1].split('</script>')[0];
function openFile(url) {
  let destination;
  const message = { textContent: '' };
  vm.runInNewContext(script, {
    URL,
    location: { href: url.href, origin: url.origin, host: url.host, replace: value => { destination = value; } },
    document: { querySelector: () => message },
  });
  return { destination: destination && new URL(destination), message: message.textContent };
}

test('file links preserve paths and positions on the current installation subdomain', () => {
  const launch = new URL(fileIdeUrl({
    cwd: '/var/lib/remote/projects/example/workspace/src',
    path: '/workspace/src/a #ü%.ts', line: 12, column: 3,
  }, 'https://remote.example.test'));
  for (const id of ['abcdef123456', '654321fedcba']) {
    // Mirror the gateway's host redirect and launch-prefix removal.
    const landing = new URL(launch.pathname.replace('/apps/example/code-server', '') + launch.search,
      `https://${id}.apps.remote.example.test`);
    const { destination } = openFile(landing);
    assert.equal(destination.origin, landing.origin);
    assert.equal(destination.pathname, '/');
    assert.equal(destination.searchParams.get('folder'), '/workspace/src');
    assert.deepEqual(JSON.parse(destination.searchParams.get('payload')), [
      ['openFile', `vscode-remote://${landing.host}/workspace/src/a%20%23%C3%BC%25.ts:12:3`],
      ['gotoLineMode', 'true'],
    ]);
  }
});

test('files without positions open on the app origin and keep a non-default port', () => {
  const { destination } = openFile(new URL('https://abcdef123456.apps.remote.test:8443/_static/remote-open.html?file=%2Fworkspace%2FREADME.md'));
  assert.equal(destination.origin, 'https://abcdef123456.apps.remote.test:8443');
  assert.deepEqual(JSON.parse(destination.searchParams.get('payload')), [
    ['openFile', 'vscode-remote://abcdef123456.apps.remote.test:8443/workspace/README.md'],
  ]);
});

test('invalid file or folder cannot redirect away from the application', () => {
  for (const query of ['file=/etc/passwd', 'file=https://evil.test/a', 'file=/workspace/a&folder=//evil.test', '']) {
    const result = openFile(new URL(`https://abcdef123456.apps.remote.test/_static/remote-open.html?${query}`));
    assert.equal(result.destination, undefined);
    assert.equal(result.message, 'Invalid workspace file.');
  }
});
