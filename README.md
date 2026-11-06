# Scope Receipt

Scope Receipt reads a client thread with an AI model running on your own computer, proposes each piece of extra work with the exact words it came from, and turns the work you approve into a PayPal sandbox invoice draft that it then reads back from PayPal to check.

**Version 0.2 runs locally. The AI reader uses a local model through Ollama; a built-in classifier works with no setup. PayPal sandbox draft creation is off by default. A real sandbox draft was created and read back on 2026-11-07.**

![Scope Receipt: the local AI reader's requests, checked by rules and reviewed in AG Grid Community, with the quoted words highlighted (fictional sample)](docs/images/review.png)

For judges: follow [Run](#run), then [The AI reader](#the-ai-reader), then [PayPal sandbox setup](docs/PAYPAL-SANDBOX.md) to test with your own sandbox. No paid service, cloud AI key or public hosting is needed.

## The problem

Small service jobs grow one message at a time: "could you also do two posters?", "one more sign", "the menu in three more languages". By invoice time those requests are mixed with the original quote, revisions that were included, and everyday correspondence. Freelancers either forget to bill them or bill without being able to show where each line came from. Scope Receipt keeps every proposed line tied to the client's own words, and leaves the decision and the price with the person who agreed them.

## Run

Use Node.js 22.12 or newer. The checked environment uses Node 22.23.4.

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4318`. This starts the built-in classifier only. For the AI reader, see below. For source editing, `npm run dev` serves the same application with Vite middleware. The production server serves only `dist/`, and listens on the loopback interface.

## The AI reader

1. Install [Ollama](https://ollama.com) and download the model: `ollama pull gemma4:12b-it-qat` (about 7 GB; it ran fully on a 12 GB GPU in our check).
2. Start the application with `npm run start:agent`. It loads `.env` if one exists, so the same command also enables the PayPal sandbox when that is configured.
3. Open `http://127.0.0.1:4318`. **AI reader** is selected and the sample client messages are loaded. Press **Read the notes**.

What happens:

- The server sends the numbered notes and the agreed scope to Ollama at `127.0.0.1:11434` with a JSON schema, temperature 0 and thinking turned off. The model returns each request with its category, a quote from the note, a line name, a quantity, the stated unit price and a one-sentence reason. Only loopback Ollama addresses are accepted, so notes stay on this computer.
- Rules in `src/domain/agent-review.mjs` then decide what reaches the review table. A quote that is not in the note turns the row into **Check meaning** with no price. A price must be written in that note: a budget, a limit, a discount, two different amounts or a price the model invented leaves the price empty with the reason shown. An amount for several items needs per-item wording such as "each" or "per language", or it is left for the operator. Items that quote the same words are dropped, and items with the same line name are combined into one line marked for checking, so one request is not billed twice. A note the model skipped falls back to the built-in classifier and says so.
- The table shows every request with its source note. The inspector highlights the quoted words and lists which checks passed: quote found, price written in the note, quantity written or counted by the AI. Nothing is selected or sent automatically.

On the sample thread the AI reader splits one message into a sidewalk sign (extra) and a typo fix (included), counts "Spanish, French and Korean" as 3, and leaves the sign's "$80 budget" for the operator to price. With $80 entered, the three extra requests total **USD 260.00**.

Observed on 2026-11-07 with `gemma4:12b-it-qat`, Ollama 0.40.11 and an RTX 4070 12 GB: six runs on the sample thread, and three more after the last prompt change, gave the same nine rows, in about 11 seconds each once the model was loaded (the first read, including loading, took up to 26 seconds). A second authored thread gave the same result in three of three runs after the combining rule was added. These are a few authored English threads, not an accuracy measurement. Accuracy on real client messages has not been measured, and other models were not tested. To try another Ollama model, set `SCOPE_AGENT_MODEL`.

## Try the sample with the built-in classifier

Select **Built-in classifier**, or start with `npm start`.

1. Read the eight fictional work notes for a coffee shop print update.
2. Inspect an extra request. Its original note and record fingerprint appear below the table.
3. Choose **Select extra requests**. Three selected requests total **USD 260.00**.
4. Check the descriptions, quantities and unit prices. Double-click an editable table cell to change it.
5. Confirm that the selected work was reviewed, then prepare the draft.
6. Download the source-linked Markdown receipt or the PayPal JSON draft.

Editing a source note, quantity, price, date or project detail invalidates the previous review. Missing or ambiguous prices require manual input. A price covering several items is not silently treated as a per-item price.

A price is read from a note only when it is the one clear amount there. `$1,200` and `two extra posters at $40 each` are read in full. A note with two different amounts, a budget or limit, a discount, refund, credit or deposit, an amount with more than two decimals, or a quantity outside 1 to 99 is left at zero with the reason shown, and the draft stays blocked until the operator enters the agreed figures.

**Edit project** changes the project name, quote reference and agreed-scope reminder. The AI reader receives the agreed scope; the classifier does not. In both cases the operator checks the agreement. Data stays in process/page memory unless explicitly downloaded. There is no account, customer contact, analytics service or cloud model call.

## The review table

AG Grid Community is the review workspace:

- Row selection with a pinned **Selected work** row that totals the selected requests.
- Editable line names, a category select editor (an operator's correction is marked on the badge and carried into the draft), and number editors for quantity (1 to 99) and unit price.
- Undo and redo of cell edits with Ctrl+Z and Ctrl+Y.
- Category filters, a quick search across line names and source notes, row highlighting for requests that need checking, and the AI's reason as a tooltip on the category.
- **Export CSV** with the source note, the AI's quote and its reason for each row. Cells that begin like a spreadsheet formula are written as text.

## The built-in classifier

The model is a multinomial Naive Bayes text classifier using word and word-pair features. It suggests **Extra request**, **Within quote**, **Correspondence**, or abstains with **Check meaning**. It does not select billable work automatically. Proposing billable work is the costly mistake, so **Extra request** needs stronger evidence than the other two; those thresholds were chosen by hand from a small set of sentences.

Training data contains **81 authored synthetic English examples**. Three further authored lists check it, and `MODEL-EVALUATION.json` holds every result:

- A holdout of 12 examples: 12/12 as labelled.
- A harder list of 21: 21 as labelled, none wrongly proposed as billable. These sentences shaped the added examples, so this is a regression list, not a blind test.
- A fresh list of 24, written after the model and thresholds were frozen: 18 as labelled (3 of those are vague notes that should abstain), 5 more abstained, 1 vague note read as "Within quote", none wrongly proposed as billable and no extra request missed.

All of this is small and synthetic, and written by the same author, so none of it estimates accuracy on real client records. English phrasing outside the examples, indirect requests and contractual nuance remain limitations.

```sh
npm run train
```

This deterministically recreates `src/model/model.json` and `MODEL-EVALUATION.json`. Training does not download data or contact a model provider.

## PayPal connection

The adapter targets only `https://api-m.sandbox.paypal.com`:

- `POST /v1/oauth2/token` obtains a short-lived token in server memory.
- `POST /v2/invoicing/invoices` creates a draft, with an idempotency reference.
- `GET /v2/invoicing/invoices/{id}` reads the draft back. The page then compares PayPal's copy with the review: the draft ID, DRAFT status, currency, total, number of items, and each line's name, quantity and unit price, matched to its source by the `Source N-04a · …` reference in the item description.

There is no send, charge, capture, refund or live-production endpoint. A local preview must be reviewed before the server can request a draft. A consumed preview is locked against a duplicate request. When PayPal's answer is lost, the application says the draft may or may not exist instead of reporting one, and a retry sends the same `PayPal-Request-Id`, which PayPal documents as returning the original result rather than creating a second invoice. An answer that makes no sense locks the preview for a manual check.

A refusal is reported differently from an unknown outcome. When sign-in fails, or PayPal answers 400, 401, 403, 404, 405, 415 or 422, the application treats the operation as refused: the page shows PayPal's status, error name, field paths, issue codes and debug reference, the server logs the same line, and the preview stays usable. A timeout, an unreadable reply or another unsuccessful response leaves the outcome uncertain; retrying that same open preview reuses its request ID. An unexpected successful response locks the preview for manual inspection. A failed readback says so and leaves the draft unchanged.

[PayPal's Invoicing troubleshooting guide](https://developer.paypal.com/invoicing/troubleshooting) documents retrying with the original request ID after a timeout or server error. That behavior is simulated in the tests; actual sandbox behavior remains unverified. Preview references live only in server memory and expire after ten minutes. After expiry, a reload or a server restart, inspect the sandbox before preparing another draft; a new preview gets a new request ID. Do not treat the in-memory guard as durable billing storage.

The operator prepares their own sandbox before setting `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `ALLOW_SANDBOX_DRAFTS=1`. Either set them in the process environment and use `npm start`, or copy `.env.example` to `.env`, fill it in and use `npm run start:sandbox` (classifier only) or `npm run start:agent` (with the AI reader). `npm start` does not load an `.env` file. `.env` is ignored by git. Credentials must never be added to the browser bundle or committed. See [PayPal sandbox setup](docs/PAYPAL-SANDBOX.md) for the exact sequence and acceptance checks.

Real sandbox checks on 2026-11-07: a classifier draft was created and read back with a separate script, and later an AI-reader draft was created and read back by the application itself, with all three lines matching (see [PayPal sandbox setup](docs/PAYPAL-SANDBOX.md)). The demo video records one more run of that same path. Timeout and retry behavior against the real service, other merchant settings and the judging setup remain unverified. The current server is for a local workspace. Authentication is required before any future public deployment that enables sandbox mutations.

Official reference: [PayPal Invoicing API v2](https://developer.paypal.com/api/invoicing/v2). Tax, recipient details, discounts and accounting treatment are not calculated by this prototype.

## Validation

```sh
npm test
npm run build
npm run test:ui
```

For the browser tests, install Chromium once with `npx playwright install chromium` if it is not already available. The unit tests cover exact decimal arithmetic, unchanged source records, manual confirmation, ambiguous amounts, local HTTP behavior, the sandbox adapter with injected responses, the readback comparison, the Ollama client's request, and the rules that check the AI reader's answers, using a recorded `gemma4:12b-it-qat` answer in `test/fixtures/`. Browser checks rebuild the application and run three local servers with headless Chromium: one with sandbox credentials explicitly empty; one with the real application and adapter and only PayPal's network answers replaced, which exercises success, readback, a differing total, a missing total, a refusal and an unknown outcome; and one with the real Ollama client and only Ollama's answer replaced, which exercises the AI reader, the evidence highlight, a budget left for the operator, undo and redo, a category correction, search and CSV export. No automated check reaches PayPal or a model.

## Preparing source for publication

```sh
npm run check:public
npm run prepare:public
```

These commands check an explicit set of source files for common credential patterns, email addresses, phone numbers and local file paths. The second command copies that set into a new `release/scope-receipt-.../` folder and adds a SHA-256 file manifest. It copies neither `.env` nor git history, owner notes, logs, build output or installed dependencies, and makes no network request or publication. Pattern checks do not establish that every kind of private data is absent. Images and claims in the README also require human review.

## Development and licensing

Codex and Claude drafted the code, design, synthetic training data, fictional notes and tests. No real users, clients or transaction data were used. No field performance, saved time or revenue increase is claimed.

The table uses **AG Grid Community 36.2.0**, under its MIT license. No Enterprise package or paid feature is used. The AI model is not included in this repository: Ollama downloads it separately under the model's own terms. The original application code is under the MIT license. Versions are pinned in `package-lock.json`; see [third-party notices](THIRD-PARTY-NOTICES.md).

The hackathon's [AG Grid sponsor page](https://paypalaihackathon.devpost.com/details/aggrid) asks for AG Studio dashboards and the Studio Agent Framework, beyond AG Grid on its own. This application uses AG Grid Community, not AG Studio, so its fit to that sponsor brief is limited. Final eligibility and award decisions belong to the organizers.

The source is public at <https://github.com/clpt-cpu/scope-receipt>.
