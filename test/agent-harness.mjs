// The real application and the real Ollama client, with only Ollama's side of the network replaced by a recorded answer.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server/app.mjs';
import { OllamaAgent } from '../server/agent.mjs';

const model = JSON.parse(await readFile(new URL('../src/model/model.json', import.meta.url), 'utf8'));
const { items } = JSON.parse(await readFile(new URL('./fixtures/gemma4-sample-thread.json', import.meta.url), 'utf8'));
const fetchImpl = async url => {
  if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'gemma4:12b-it-qat' }] });
  await new Promise(resolve => setTimeout(resolve, 300));
  return Response.json({ message: { role: 'assistant', content: JSON.stringify({ items }) } });
};
const app = createApp({ model, agent: new OllamaAgent({ model: 'gemma4:12b-it-qat', fetchImpl }), log: () => {} });
createServer(app).listen(4321, '127.0.0.1', () => console.log('AI reader harness on 4321'));
