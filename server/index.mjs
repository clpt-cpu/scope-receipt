import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.mjs';
import { PayPalSandboxClient } from './paypal.mjs';
import { OllamaAgent } from './agent.mjs';

const model = JSON.parse(await readFile(new URL('../src/model/model.json', import.meta.url), 'utf8'));
const configured = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
const paypalClient = configured ? new PayPalSandboxClient({ clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET }) : null;
const allowSandbox = process.env.ALLOW_SANDBOX_DRAFTS === '1';
const agentModel = process.env.SCOPE_AGENT_MODEL || (process.argv.includes('--agent') ? 'gemma4:12b-it-qat' : '');
const agent = agentModel ? new OllamaAgent({ model: agentModel, host: process.env.SCOPE_AGENT_OLLAMA_URL || undefined }) : null;
const isDev = process.argv.includes('--dev');
const port = Number(process.env.SCOPE_RECEIPT_PORT || 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid application port.');
let vite;
if (isDev) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({ server: { middlewareMode: true, host: '127.0.0.1', hmr: false }, appType: 'spa' });
}
const server = createServer(createApp({ model, paypalClient, allowSandbox, agent, devMiddleware: vite?.middlewares }));
server.listen(port, '127.0.0.1', () => {
  console.log(`Scope Receipt: http://127.0.0.1:${port}`);
  console.log(`PayPal sandbox drafts: ${configured && allowSandbox ? 'enabled by environment' : 'disabled'}. Sending and payment operations are not implemented.`);
  console.log(`AI reader: ${agent ? agent.label() : 'off (built-in classifier only)'}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await vite?.close(); process.exit(0); }));
