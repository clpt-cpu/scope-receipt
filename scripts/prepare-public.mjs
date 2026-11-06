// Makes a local source snapshot for review. Never reads .env or .git and never publishes.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [
  '.env.example', '.gitignore', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'README.md',
  'MODEL-EVALUATION.json', 'package.json', 'package-lock.json', 'index.html',
  'vite.config.js', 'playwright.config.js', 'scripts/train.mjs',
  'scripts/prepare-public.mjs', 'docs/PAYPAL-SANDBOX.md', 'docs/DEMO-SCRIPT.md',
  'docs/images/review.png',
];

export function isPublicPath(path) {
  if (path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) return false;
  return files.includes(path) || /^(?:src|server)\/(?:[\w-]+\/)*[\w.-]+\.(?:mjs|js|json|css)$/.test(path)
    || /^test\/[\w.-]+\.test\.mjs$/.test(path) || /^test\/ui\/[\w.-]+\.spec\.js$/.test(path)
    || path === 'test/sandbox-harness.mjs';
}

// A bounded pre-publication check, not a proof that every kind of private data is absent.
// Findings contain locations and rule names only; never echo the matched text.
export function sensitiveTextFindings(text) {
  const findings = [];
  const add = (rule, index) => findings.push({ rule, line: text.slice(0, index).split('\n').length });
  for (const match of text.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi)) {
    if (!/(?:^|\.)(?:example\.(?:com|net|org)|test|invalid)$/.test(match[1].toLowerCase())) add('email', match.index);
  }
  for (const match of text.matchAll(/(?:^|[\s"'`(])(?:[A-Z]:[\\/]|\/(?:Users|home)\/)|file:\/\//gim)) add('local-path', match.index);
  for (const match of text.matchAll(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g)) add('credential-pattern', match.index);
  for (const match of text.matchAll(/^[ \t]*PAYPAL_CLIENT_(?:ID|SECRET)[ \t]*=[ \t]*(.+)$/gm)) {
    const value = match[1].trim().replace(/^(["'])(.*)\1$/, '$2');
    if (value && !value.startsWith('#')) add('configured-paypal-credential', match.index);
  }
  for (const match of text.matchAll(/\b(?:clientId|clientSecret|access_token|password|apiKey)["']?\s*[:=]\s*(["'])([^"'\r\n]+)\1/g)) {
    if (!/^(?:unit|fake|mock|test|dummy|example|your|placeholder)(?:[-_ ]|$)/i.test(match[2])) add('literal-credential', match.index);
  }
  for (const match of text.matchAll(/(?:\+81[- ]?|0)(?:[5789]0)[- ]?\d{4}[- ]?\d{4}\b/g)) add('possible-phone', match.index);
  return findings;
}

async function walk(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error('A source entry is a link; review it before preparing a public snapshot.');
    if (entry.isDirectory()) result.push(...await walk(join(directory, entry.name), `${name}/`));
    else result.push(name);
  }
  return result;
}

export async function preparePublic({ projectRoot = root, checkOnly = false } = {}) {
  const selected = [...files];
  for (const directory of ['src', 'server', 'test']) {
    const names = await walk(join(projectRoot, directory));
    selected.push(...names.map(name => `${directory}/${name}`).filter(isPublicPath));
  }
  const paths = [...new Set(selected)].sort();
  const content = new Map(), findings = [];
  for (const path of paths) {
    if (!isPublicPath(path)) throw new Error('The public file list contains an unexpected path.');
    const fullPath = resolve(projectRoot, path);
    const stat = await lstat(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular public source file: ${path}`);
    const bytes = await readFile(fullPath);
    if (!path.endsWith('.png')) findings.push(...sensitiveTextFindings(bytes.toString('utf8')).map(item => ({ file: path, ...item })));
    content.set(path, bytes);
  }
  if (findings.length) return { ok: false, filesChecked: paths.length, findings };
  const manifest = paths.map(path => ({ path, bytes: content.get(path).length, sha256: createHash('sha256').update(content.get(path)).digest('hex') }));
  if (checkOnly) return { ok: true, filesChecked: paths.length, findings: [], scope: 'selected public source only; no .env or git history' };
  const name = `scope-receipt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const target = resolve(projectRoot, 'release', name);
  // Every snapshot gets a new directory; never replace or recursively delete a previous one.
  await mkdir(target, { recursive: true });
  for (const [path, bytes] of content) {
    const destination = join(target, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  await writeFile(join(target, 'PUBLIC-MANIFEST.json'), `${JSON.stringify({ files: manifest }, null, 2)}\n`, { flag: 'wx' });
  return { ok: true, filesChecked: paths.length, directory: relative(projectRoot, target).replaceAll('\\', '/'), published: false, findings: [] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Only --check is supported.');
    const result = await preparePublic({ checkOnly: process.argv.includes('--check') });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error('Public preparation could not finish. Check that the required files exist and are regular files. No publication was attempted.');
    process.exitCode = 1;
  }
}
