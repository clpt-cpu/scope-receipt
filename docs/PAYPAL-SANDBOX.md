# Test a PayPal sandbox draft

First real sandbox check (2026-11-07, JST): with a newly created sandbox app, one **Create sandbox draft** returned an invoice ID in status DRAFT. Reading that invoice back from the sandbox Invoicing API showed USD, three lines (2 × 45.00, 1 × 80.00, 3 × 30.00) and a total of USD 260.00, and the Developer Dashboard's API Calls list showed one successful `POST /v2/invoicing/invoices` (201). Timeout and retry behavior against the real service has not been exercised. Automated tests simulate PayPal's responses, including those failure paths. Follow this guide to repeat the check with your own sandbox. The app only creates sandbox drafts; it cannot send an invoice or collect a payment.

## Get sandbox access

1. Sign in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) with your own PayPal account. If you need an account, complete PayPal's sign-up and any required verification yourself. The [REST getting-started guide](https://developer.paypal.com/api/rest/) says a Business account is needed to test integrations outside the US. The [Invoicing quick start](https://developer.paypal.com/api/invoicing/) requires a business account with Invoicing enabled.
2. In **Apps & Credentials**, keep the environment set to **Sandbox**. Select a sandbox REST app, or use **Create App** and name it `Scope Receipt`. Associate it with a sandbox **Business** seller account, not a live account. PayPal documents default personal and business sandbox accounts on first dashboard access; see [Sandbox accounts](https://developer.paypal.com/sandbox-testing/accounts).
3. Obtain that app's **Client ID** and **Secret**. Keep both local. The sandbox account's email/password are separate from these two API values.

Observed on 2026-11-07: **Create App** opened a panel with **App Name**, a **Type** choice (**Merchant**, selected by default, or Platform) and a **Sandbox Account** list holding the default sandbox Business account. PayPal asked for a fresh sign-in on the first attempt. In the new app's **Features** list, **Invoicing** was off; it was turned on with **Save Changes** before the first draft, so a draft without that step was not tried. Dashboard layouts change; do not invent a setting if it is absent, and check PayPal's current instructions or support.

## Configure locally

Install dependencies with `npm ci`. Copy `.env.example` to `.env` using your editor or file manager. Fill in the two existing empty credential values and set `ALLOW_SANDBOX_DRAFTS` to `1`. Use sandbox credentials only, and never send the file to a repository, chat or video. The values remain server-side; no browser payment SDK is needed.

```sh
npm run build
npm run start:sandbox
```

The startup output must say `PayPal sandbox drafts: enabled by environment`. Open `http://127.0.0.1:4318`. `npm start` does not load `.env`; use `start:sandbox` for that file. Stop an earlier instance with Ctrl+C in its own terminal before starting another one. If the port is occupied by an unrelated process, do not stop it; set `SCOPE_RECEIPT_PORT` to a free local port instead.

## Make and inspect one draft

1. Restore the fictional sample if needed. Choose **Select extra requests**. Check the three selected lines: 2 × USD 45.00, 1 × USD 80.00 and 3 × USD 30.00, total USD 260.00.
2. Read the original notes and confirm the review checkbox. Choose **Review invoice draft**, then **Create sandbox draft** once.
3. A usable result has a PayPal invoice ID and status DRAFT. The app compares USD 260.00 if PayPal returns a total. A missing or different total requires a check on PayPal's side.
4. In the Developer Dashboard, use **Testing Tools > Sandbox Accounts** and the relevant Business account's **View/Edit Account** to obtain its sandbox-site login. Sign into [the sandbox test site](https://www.sandbox.paypal.com/) with that generated test account, not your real PayPal credentials. Find its invoice area and the same invoice ID. The exact invoice menu label has not been verified.
5. Confirm DRAFT, the three quantities/prices, USD currency and USD 260.00. Do not send the draft. There is no recipient in the current payload.

Record the date, app result and dashboard match without exposing credentials or real account details. That evidence, rather than a simulated test, is the gate for calling the PayPal integration verified.

## If it fails

| App result | Next step |
|---|---|
| Sandbox sign-in failed | Check that both credentials belong to the same Sandbox app; restart after editing the file. |
| PayPal refused this draft | Note only the HTTP status, error name, issue code and field path. `auto_populate_invoicer` is used to fill the seller details; the real sandbox accepted it in the 2026-11-07 check. |
| Draft may or may not exist | Keep the same page and preview. A retry uses the same request ID, as documented in [PayPal's Invoicing troubleshooting guide](https://developer.paypal.com/invoicing/troubleshooting). Inspect the sandbox before creating a different preview. |
| Preview expired, page reloaded or server restarted | Check the sandbox first: the previous request ID is held only in server memory, for ten minutes. A new preview gets another ID. |
| Could not be confirmed; preview locked | Inspect the sandbox by hand before trying a new review. Do not call it a successful integration. |

Do not include raw HTTP headers, access tokens, full logs or the `.env` file in a bug report. This local prototype does not provide authenticated public hosting or durable invoice storage.

## Access for judges

The repository provides a runnable local build and these instructions for obtaining a free sandbox. Review and JSON export work without credentials. Testing PayPal requires the judge's own sandbox Business app. No shared account, secret or owner login is published. If the organizers require a different access route, agree one with them before submission; no private delivery of credentials has been set up.
