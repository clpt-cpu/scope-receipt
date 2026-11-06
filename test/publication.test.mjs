import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicPath, sensitiveTextFindings } from '../scripts/prepare-public.mjs';

test('the public file policy includes runnable source and excludes credentials, history and owner notes', () => {
  for (const path of ['.env.example', 'package-lock.json', 'src/ui/main.js', 'server/app.mjs', 'test/ui/review.spec.js', 'docs/PAYPAL-SANDBOX.md']) assert.equal(isPublicPath(path), true, path);
  for (const path of ['.env', '.env.local', '.git/config', '../private.json', 'src/../../private.json', 'docs/SANDBOX-STEPS.ja.md', 'work/STATE.md', 'release/old/README.md', 'test-results/trace.zip']) assert.equal(isPublicPath(path), false, path);
});

test('the publication check flags private-looking fixtures without returning their contents', () => {
  const examples = [
    ['personal-name', '@', 'mail-provider.example.edu'].join(''),
    ['C:', '\\', 'Users', '\\', 'fixture', '\\', 'private.txt'].join(''),
    ['PAYPAL_CLIENT_SECRET=', 'A'.repeat(70)].join(''),
    ['clientSecret', ': ', '"', 'A'.repeat(70), '"'].join(''),
    ['ghp_', 'a'.repeat(30)].join(''),
    ['090', '1234', '5678'].join('-'),
  ];
  for (const text of examples) {
    const findings = sensitiveTextFindings(text);
    assert.ok(findings.length > 0);
    assert.ok(findings.every(item => Object.keys(item).sort().join() === 'line,rule'));
    assert.ok(!JSON.stringify(findings).includes(text));
  }
});

test('blank environment variables, reserved fictional addresses and explicit test keys remain usable', () => {
  assert.deepEqual(sensitiveTextFindings('PAYPAL_CLIENT_ID=\nPAYPAL_CLIENT_SECRET=\nclientSecret: "fake-secret"\nclientId: "unit-client"\ncustomer@example.invalid\ncustomer@personal.example.com\nhttps://developer.paypal.com/'), []);
});
