// Reads work notes with a language model served by a local Ollama. Nothing leaves this computer.
// The model only proposes; src/domain/agent-review.mjs checks every proposal against the notes before anyone sees it.

export const AGENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array', maxItems: 300,
      items: {
        type: 'object', additionalProperties: false,
        required: ['note', 'category', 'evidence', 'description', 'quantity', 'unit_price', 'reason'],
        properties: {
          note: { type: 'integer' },
          category: { type: 'string', enum: ['extra', 'included', 'admin', 'unclear'] },
          evidence: { type: 'string' },
          description: { type: 'string' },
          quantity: { type: 'integer' },
          unit_price: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

export const AGENT_INSTRUCTIONS = `You review a freelancer's work log for one client project. Find each piece of work in the notes and decide whether the agreed scope already covers it.

Categories:
- extra: the client asks for a new deliverable that the agreed scope does not include.
- included: work that the agreed scope already covers, including its revision round.
- admin: scheduling, status updates, sending files or waiting. Nothing to bill.
- unclear: vague feedback, or a request whose meaning or size cannot be decided from the note.

Rules:
- Return at least one item for every note. When one note asks for several separate deliverables, return one item for each deliverable. Never list the same request twice, and keep a deliverable's count and price in the same item as the deliverable.
- evidence: copy the shortest exact phrase from that note that shows the request, including any stated price. Copy it character for character.
- description: a short invoice line name, such as "Poster layout".
- quantity: how many units are requested. Count listed items, for example "Spanish and French" is 2. Use 1 when no count is given.
- unit_price: the price of one unit exactly as the note states it, digits only, such as "45" or "45.50". Use "" when the note states no price for this item. Never estimate a price.
- reason: one short sentence that refers to the agreed scope.`;

export function agentPrompt({ projectName = '', quote = '', scope = '', lines }) {
  return [`Project: ${projectName}`, `Quote: ${quote || 'not given'}`, `Agreed scope: ${scope || 'not given'}`, '', 'Notes:', ...lines.map((text, index) => `${index + 1}. ${text}`)].join('\n');
}

export class OllamaAgent {
  constructor({ model, host = 'http://127.0.0.1:11434', fetchImpl = globalThis.fetch, timeoutMs = 180_000 }) {
    const url = new URL(host);
    // Work notes are client material, so the reader may only talk to a model on this computer.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('The AI reader only connects to Ollama on this computer.');
    Object.assign(this, { model, host: url.origin, fetchImpl, timeoutMs });
  }
  label() { return `${this.model} via local Ollama`; }
  async available() {
    try {
      const response = await this.fetchImpl(`${this.host}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return false;
      const { models = [] } = await response.json();
      return models.some(item => item.name === this.model || item.model === this.model);
    } catch { return false; }
  }
  async read({ projectName, quote, scope, lines }) {
    const request = {
      model: this.model, stream: false, format: AGENT_SCHEMA, keep_alive: '5m',
      // Thinking models such as gemma4 otherwise spend the whole token budget reasoning before the JSON starts.
      think: false, options: { temperature: 0, seed: 7, num_ctx: 8192, num_predict: 4096 },
      messages: [{ role: 'system', content: AGENT_INSTRUCTIONS }, { role: 'user', content: agentPrompt({ projectName, quote, scope, lines }) }],
    };
    const post = body => this.fetchImpl(`${this.host}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs), body: JSON.stringify(body) });
    let response;
    try {
      response = await post(request);
      if (response.status === 400 && /think/i.test(await response.clone().text())) { delete request.think; response = await post(request); }
    } catch (error) {
      throw new Error(error?.name === 'TimeoutError' ? 'The AI reader took too long. Try fewer notes, or use the built-in classifier.' : 'The local AI reader could not be reached. Start Ollama, or use the built-in classifier.');
    }
    if (!response.ok) throw new Error(`The local AI reader returned HTTP ${response.status}. Check that the model ${this.model} is installed.`);
    const body = await response.json();
    try { return JSON.parse(body?.message?.content ?? '').items; } catch { throw new Error('The AI reader returned an answer that could not be read. Try again, or use the built-in classifier.'); }
  }
}
