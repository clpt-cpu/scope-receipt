# Scope Receipt — 2 minute 40 second demo

Status: script only. The real PayPal footage has not been recorded. Record the sandbox section only after an actual draft has been created and independently inspected. Do not substitute the test harness for PayPal or narrate the conditional lines before verification.

Use a desktop window at about 1440 × 1050 or 1920 × 1080. Keep the UI at a readable scale. Narration is about 270 words; the remaining time is for deliberate clicks and showing the result. Aim for 2:40 and keep the exported video below 3:00. English captions can carry the same script. No webcam or music is needed.

| Time | Show | English narration |
|---|---|---|
| 0:00–0:15 | App with the fictional eight-note sample | “Small service jobs grow one message at a time. By invoice time, extra work is mixed with the original quote and everyday correspondence. Scope Receipt keeps the request beside the proposed charge.” |
| 0:15–0:38 | Open the Extra requests filter, click the window-sign note and show the original wording | “A local text classifier suggests categories, including a check-meaning option. It does not read the contract or decide what is billable. I inspect the original note here. The source stays attached to the row.” |
| 0:38–1:02 | Select the three extra requests. Edit the poster quantity from 2 to 3, then restore 2 | “AG Grid is the review workspace. I select the work and can edit the description, quantity and price. Changing two posters to three updates the total. I restore the agreed quantity. These three requests now total 260 dollars.” |
| 1:02–1:22 | Check the review box, open the preview, download the Markdown receipt | “Only after I confirm the review can I prepare the invoice. The receipt preserves the original notes and their fingerprints. Ambiguous prices require manual input, and changing the source or amounts invalidates confirmation.” |
| 1:22–1:45 | **REAL SANDBOX ONLY:** Create sandbox draft; hold on the returned ID and comparison | **Say only after success:** “Now the reviewed lines go to PayPal's real sandbox Invoicing API. PayPal has returned this invoice ID. It is a draft, and no invoice has been sent. The API credentials stay on the server.” |
| 1:45–2:10 | **REAL SANDBOX ONLY:** matching draft in PayPal; show just ID, DRAFT and the three lines/total | **Say only after the dashboard match:** “Here is the same draft in PayPal: two layouts at 45 dollars, one sign at 80, and three language versions at 30. The total is 260 dollars. This is a sandbox test, with fictional work.” |
| 2:10–2:28 | Return to app preview; keep total and source references visible | “The model was trained on 81 authored English examples. Its small synthetic checks do not measure real client accuracy. A person must approve the scope and the price. Sending, tax and customer details are outside this prototype.” |
| 2:28–2:40 | README title, source link and local setup; add final repository URL in an end card | “The source and local run instructions are open. Scope Receipt connects a reviewed request to a PayPal invoice draft, while keeping its original wording within reach.” |

If the response omits a total, show the app's honest warning and verify the total in PayPal before continuing. If the sandbox fails, stop the recording and resolve it; a JSON export or mock result does not demonstrate the real integration. If any displayed value differs, change the narration to the actual observed result.

Capture only the app and a cropped sandbox invoice area. Do not capture account setup, dashboard credentials, `.env`, terminal environment output, browser profiles, real names/contact details or other tabs. Make masks opaque and check every frame around cuts. Do not add PayPal or sponsor artwork to an end card; the video requirement restricts unapproved third-party trademarks and copyrighted material. Use only necessary app/invoice footage and verify the organizer's permission for any visible brand marks before publishing.
