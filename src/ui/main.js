import './style.css';
import './readability.css';
import './agent.css';
import { createGrid, AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);
let rows = [], grid, selectedId = '', currentPreview = null, sourceNotes = '', status = null, reader = 'classifier', analyzedWith = 'classifier', sample = null;
const labels = { extra: 'Extra request', included: 'Within quote', admin: 'Correspondence', uncertain: 'Check meaning' };
const app = document.querySelector('#app');
app.innerHTML = `
  <header class="site-header"><a href="#" class="brand"><span class="brand-mark" aria-hidden="true">sr<span>·</span></span><span>Scope Receipt</span></a><nav aria-label="Review steps"><span class="nav-current">01 <b>Review the work</b></span><span>02 <b>Check the draft</b></span></nav><span class="environment"><span></span>Local workspace</span></header>
  <main>
    <section class="masthead"><div><p class="eyebrow">KEEP THE REQUEST WITH THE WORK</p><h1>The extra work<br>has a paper trail.</h1><p class="intro">A new size. Another version. One more sign.<br>Check what was asked before it becomes a line item.</p></div><div class="receipt-illustration" aria-hidden="true"><div class="receipt-top">SCOPE RECEIPT <span>019</span></div><div class="receipt-rule"></div><p>Original quote</p><strong>2 menu boards</strong><span class="receipt-dashed"></span><p>Additional requests</p><div class="receipt-small-lines"><span>Poster layouts</span><b>+ 2</b></div><div class="receipt-small-lines"><span>Window sign</span><b>+ 1</b></div><div class="receipt-small-lines"><span>Language variants</span><b>+ 3</b></div><span class="receipt-dashed"></span><em>Keep the source.</em></div></section>
    <section class="project-bar"><div><span class="tiny-label">CURRENT PROJECT</span><h2 id="project-title">Market Street Coffee</h2><p id="quote-summary"></p></div><div class="project-details"><span>REFERENCE</span><strong id="quote-reference">Q-019</strong><span class="currency">USD</span></div></section>
    <section class="project-editor" id="project-editor" hidden><form id="project-form"><label>Project name<input id="edit-project-name" type="text" maxlength="200" required></label><label>Quote reference<input id="edit-quote-reference" type="text" maxlength="100"></label><label>Agreed scope<input id="edit-quote-summary" type="text" maxlength="400"></label><button type="submit" class="button secondary">Save project</button></form></section>
    <div id="message" class="message" role="status" aria-live="polite" hidden></div>
    <section class="workspace"><aside class="notes-pane"><div class="section-heading"><span class="section-number">01</span><h3>The source notes</h3></div><p class="pane-intro">One note per line. Keep the request in the words it arrived in.</p><fieldset class="reader-switch"><legend class="tiny-label">READ WITH</legend><label><input type="radio" name="reader" value="agent"><span><b>AI reader</b><small id="agent-label">Local model via Ollama</small></span></label><label><input type="radio" name="reader" value="classifier" checked><span><b>Built-in classifier</b><small>No setup needed</small></span></label></fieldset><label for="notes" class="tiny-label">WORK LOG</label><textarea id="notes" spellcheck="false" maxlength="30000" aria-describedby="notes-help"></textarea><p id="notes-help" class="field-help">Notes stay in this local workspace. Use the sample to try the review.</p><button id="analyze" class="button primary">Read the notes <span aria-hidden="true">→</span></button><button id="sample-reset" class="text-button">Restore sample notes</button><details class="model-note"><summary>How the categories are suggested</summary><p>The AI reader sends the notes and the agreed scope to a language model running on this computer through Ollama. It returns each request with a quote from the note. Rules then check that the quote is really in the note and that a price is written there, not guessed. You still decide what to bill.</p><p>The built-in classifier compares English word patterns learned from authored examples. It has no access to your quote or client agreements. Its categories need your review.</p><p id="model-info"></p></details></aside>
    <div class="review-pane"><div class="review-heading"><div class="section-heading"><span class="section-number">02</span><h3>Review each request</h3></div><span id="note-count" class="mono"></span></div><div class="review-toolbar"><div class="category-filters" role="group" aria-label="Filter note categories"><button data-filter="all" aria-pressed="true">All notes</button><button data-filter="extra" aria-pressed="false">Extra requests <span id="extra-count"></span></button><button data-filter="uncertain" aria-pressed="false">Check meaning</button></div><div class="toolbar-tools"><input id="grid-search" type="search" placeholder="Search notes" aria-label="Search notes" autocomplete="off"><button id="select-extra" class="text-button">Select extra requests</button><button id="export-csv" class="text-button">Export CSV</button></div></div><p class="grid-help">Select work to include. Double-click a description, category, quantity or price to edit. Ctrl+Z undoes an edit.</p><div id="review-grid" aria-label="Work notes review table"></div><div class="source-inspector" id="source-inspector" aria-live="polite"></div><div class="review-bottom"><span id="selection-count">0 items selected</span><div><span>SELECTED WORK</span><strong id="selected-total">$0.00</strong><small>Before tax · USD</small></div></div></div></section>
    <section class="draft-builder"><div class="draft-heading"><span class="section-number">03</span><div><h3>Prepare the draft</h3><p>A line item should point back to a request you can show.</p></div></div><div class="draft-options"><label>Invoice date<input type="date" id="invoice-date" required></label><label class="review-confirm"><input id="review-confirm" type="checkbox"><span>I checked the selected work, quantities and prices against the source notes.</span></label><button id="prepare" class="button primary" disabled>Review invoice draft <span aria-hidden="true">↗</span></button></div></section>
    <section class="invoice-preview" id="invoice-preview" hidden aria-labelledby="preview-title"><div class="invoice-preview-heading"><div><p class="tiny-label">DRAFT · NOT SENT</p><h3 id="preview-title">The work and its source</h3><p id="preview-meta"></p></div><strong id="preview-total"></strong></div><div class="preview-lines" id="preview-lines"></div><div class="preview-actions"><button id="download-receipt" class="button secondary">Download scope receipt</button><button id="download-payload" class="button secondary">Download PayPal draft JSON</button><button id="sandbox-draft" class="button primary" disabled>Create sandbox draft</button></div><p id="sandbox-status" class="sandbox-status" role="status"></p><div id="sandbox-readback" class="sandbox-readback" aria-live="polite" hidden></div><p class="preview-limits">This draft covers the selected work only. Add tax, client details and any agreed discounts before an actual invoice.</p></section>
    <footer><span class="footer-brand">Scope Receipt</span><p>Read the request. Check the price. Keep the record.</p><span>Fictional sample · <b>nothing sent</b></span></footer>
  </main>`;

const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
const editProject = el('button', 'text-button edit-project-button', 'Edit project');
editProject.type = 'button'; editProject.id = 'edit-project';
$('.project-bar').append(editProject);
editProject.addEventListener('click', () => {
  $('#project-editor').hidden = !$('#project-editor').hidden;
  if (!$('#project-editor').hidden) {
    $('#edit-project-name').value = $('#project-title').textContent;
    $('#edit-quote-reference').value = $('#quote-reference').textContent;
    $('#edit-quote-summary').value = $('#quote-summary').textContent;
    $('#edit-project-name').focus();
  }
});
$('#project-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#edit-project-name').value.trim();
  if (!name) return;
  $('#project-title').textContent = name;
  $('#quote-reference').textContent = $('#edit-quote-reference').value.trim();
  $('#quote-summary').textContent = $('#edit-quote-summary').value.trim();
  $('#project-editor').hidden = true; invalidatePreview();
  notify('Project details updated. Review the selected work against your agreement.');
});
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
function rowTotal(row) {
  if (!/^[1-9]\d?$/.test(String(row.quantity)) || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(String(row.unitAmount))) return null;
  const [whole, fraction = ''] = String(row.unitAmount).split('.'); return (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * Number(row.quantity);
}
function notify(text, error = false) { const box = $('#message'); box.textContent = text; box.classList.toggle('error', error); box.hidden = false; }
async function api(path, data) {
  const response = await fetch(path, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {});
  const body = await response.json(); if (!response.ok) throw Object.assign(new Error(body.error || 'The request could not be completed.'), { retryable: body.retryable === true }); return body;
}
function invalidatePreview() { currentPreview = null; $('#invoice-preview').hidden = true; $('#review-confirm').checked = false; updateSelection(); }
function selectedRows() { return grid ? grid.getSelectedRows() : []; }
function updateSelection() {
  const selected = selectedRows(), totals = selected.map(rowTotal), valid = selected.length > 0 && totals.every(n => n !== null && n > 0);
  const sum = totals.some(n => n === null) ? null : totals.reduce((a, b) => a + b, 0);
  $('#selection-count').textContent = `${selected.length} ${selected.length === 1 ? 'item' : 'items'} selected`;
  $('#selected-total').textContent = sum === null ? 'Check amounts' : money(sum);
  grid?.setGridOption('pinnedBottomRowData', rows.length ? [{ id: 'selected-total', description: `Selected work · ${selected.length} ${selected.length === 1 ? 'request' : 'requests'}`, note: 'Before tax · USD', total: sum }] : []);
  $('#prepare').disabled = !valid || !$('#review-confirm').checked;
}
function inspect(row) {
  if (!row) return;
  selectedId = row.id;
  const box = $('#source-inspector'); box.replaceChildren();
  const head = el('div', 'source-inspector-heading'); head.append(el('span', 'tiny-label', `SOURCE ${row.id}`), el('span', `category-badge ${row.prediction.label}${row.overridden ? ' overridden' : ''}`, labels[row.prediction.label]));
  const quote = el('blockquote');
  if (row.evidence) quote.append(row.text.slice(0, row.evidence.start), el('mark', '', row.text.slice(row.evidence.start, row.evidence.end)), row.text.slice(row.evidence.end));
  else quote.textContent = row.text;
  const details = el('div', 'source-details');
  if (row.reader === 'agent') {
    if (row.reason) details.append(el('span', 'agent-reason', `AI reason · ${row.reason}`));
    const checks = el('ul', 'evidence-checks');
    const check = (ok, text) => { const item = el('li', ok ? 'ok' : 'warn', text); checks.append(item); };
    check(Boolean(row.evidence), row.evidence ? 'Quoted words found in the note' : 'Quoted words not found in the note');
    if (row.prediction.label === 'extra') {
      check(row.amountFromSource, row.amountFromSource ? `Price $${row.unitAmount} is written in the note` : 'Price left for you to enter');
      check(row.quantityFromSource, row.quantityFromSource ? 'Quantity is written in the note' : 'Quantity counted by the AI');
    }
    box.append(head, quote, checks, details);
  } else {
    details.append(el('span', '', row.prediction.signals.length ? `Matched terms · ${row.prediction.signals.join(', ')}` : 'No reliable category signal. Read this note yourself.'));
    box.append(head, quote, details);
  }
  details.append(el('span', 'mono', `Record ${row.sourceHash.slice(0, 12)}`));
  if (row.caution) box.append(el('p', 'source-caution', row.caution));
  else if (row.reader !== 'agent' && (!row.quantityFromSource || !row.amountFromSource)) box.append(el('p', 'source-caution', 'Quantity or price was not explicit in this note. Check and enter the agreed amount before including it.'));
}
function updateCounts() {
  const notes = new Set(rows.map(row => row.sourceHash + row.id.slice(0, 4))).size;
  $('#note-count').textContent = rows.length ? `${notes} NOTES${rows.length !== notes ? ` · ${rows.length} REQUESTS` : ''}` : '';
  $('#extra-count').textContent = rows.length ? rows.filter(row => row.prediction.label === 'extra').length : '';
}
const gridTheme = themeQuartz.withParams({ accentColor: '#a44e31', backgroundColor: '#fcfaf4', foregroundColor: '#3b342e', headerBackgroundColor: '#ebe7dc', headerTextColor: '#847568', borderColor: '#ddd5c5', fontFamily: '"Segoe UI", Arial, sans-serif', fontSize: 11, headerFontSize: 9, spacing: 5, wrapperBorderRadius: 0, rowBorder: true, columnBorder: false, selectedRowBackgroundColor: '#f2e4d3', oddRowBackgroundColor: '#faf7ee' });

const editable = p => !p.node.rowPinned;
// Spreadsheet-style formulas in an exported note would run when the CSV is opened, so they are written as plain text.
const csvSafe = value => { const text = value === null || value === undefined ? '' : String(value); return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text; };
function setupGrid() {
  grid = createGrid($('#review-grid'), {
    theme: gridTheme, rowData: [], getRowId: p => p.data.id, rowHeight: 59, headerHeight: 36, domLayout: 'autoHeight',
    rowSelection: { mode: 'multiRow', checkboxes: true, headerCheckbox: false, enableClickSelection: false },
    selectionColumnDef: { width: 38, minWidth: 38, maxWidth: 38, pinned: 'left' },
    defaultColDef: { sortable: true, resizable: true, suppressMovable: true, cellDataType: false },
    columnDefs: [
      { headerName: 'WORK / SOURCE', field: 'description', flex: 1, minWidth: 190, editable, wrapText: true, cellClass: 'description-cell',
        getQuickFilterText: p => `${p.data.description} ${p.data.text}`,
        cellRenderer: params => { const node = el('div', 'work-cell'); if (params.node.rowPinned) node.append(el('span', 'work-text', params.value), el('small', 'mono', params.data.note)); else node.append(el('span', 'work-text', params.value), el('small', 'mono', params.data.id)); return node; } },
      { headerName: 'SUGGESTED', colId: 'category', field: 'prediction.label', width: 132, minWidth: 112, editable, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: Object.keys(labels) },
        valueFormatter: p => labels[p.value] ?? '', getQuickFilterText: p => labels[p.value] ?? '',
        valueSetter: p => { if (!labels[p.newValue] || p.newValue === p.oldValue) return false; p.data.prediction = { ...p.data.prediction, label: p.newValue }; p.data.overridden = true; return true; },
        tooltipValueGetter: p => p.node.rowPinned ? null : p.data.reason ? `AI reason: ${p.data.reason}` : null,
        cellRenderer: params => params.node.rowPinned ? '' : el('span', `category-badge ${params.value}${params.data.overridden ? ' overridden' : ''}`, labels[params.value]) },
      { headerName: 'QTY', field: 'quantity', width: 72, minWidth: 60, editable, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 1, max: 99, precision: 0 },
        valueSetter: p => { p.data.quantity = p.newValue === null || p.newValue === undefined ? '' : String(p.newValue).trim(); return true; } },
      { headerName: 'USD / UNIT', field: 'unitAmount', width: 96, minWidth: 84, editable, cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 0, max: 9999999, precision: 2 },
        valueSetter: p => { const value = Number(p.newValue); p.data.unitAmount = p.newValue !== null && p.newValue !== '' && Number.isFinite(value) && value >= 0 ? value.toFixed(2) : String(p.newValue ?? '').trim(); return true; },
        valueFormatter: p => p.node.rowPinned ? '' : `$${p.value}` },
      { headerName: 'TOTAL', colId: 'lineTotal', width: 88, minWidth: 75, valueGetter: p => p.node.rowPinned ? p.data.total : rowTotal(p.data), valueFormatter: p => p.value === null ? 'Check' : money(p.value), cellClass: 'amount-cell' },
      { headerName: 'SOURCE NOTE', colId: 'source', field: 'text', hide: true },
      { headerName: 'AI QUOTE', colId: 'evidence', valueGetter: p => p.data?.evidence?.text ?? '', hide: true },
      { headerName: 'AI REASON', colId: 'reason', field: 'reason', hide: true },
    ],
    rowClassRules: { 'row-check': p => !p.node.rowPinned && Boolean(p.data?.caution), 'row-overridden': p => Boolean(p.data?.overridden) },
    getRowClass: p => p.node.rowPinned ? 'row-total' : '',
    undoRedoCellEditing: true, undoRedoCellEditingLimit: 25, tooltipShowDelay: 250,
    localeText: { noRowsToShow: 'Read the notes to fill this review table.' },
    onRowClicked: event => { if (!event.node.rowPinned) inspect(event.data); },
    onSelectionChanged: () => { if (currentPreview) invalidatePreview(); else updateSelection(); },
    onCellValueChanged: event => {
      if (event.column.getColId() === 'category') { updateCounts(); grid.onFilterChanged(); grid.redrawRows({ rowNodes: [event.node] }); }
      grid.refreshCells({ force: true, columns: ['lineTotal'] }); inspect(event.data); invalidatePreview();
    },
    suppressCellFocus: false, animateRows: false,
    isExternalFilterPresent: () => activeFilter !== 'all', doesExternalFilterPass: node => node.data.prediction.label === activeFilter,
  });
}
function exportCsv() {
  grid.exportDataAsCsv({ fileName: 'scope-review.csv', skipPinnedBottom: true, columnKeys: ['description', 'category', 'quantity', 'unitAmount', 'lineTotal', 'source', 'evidence', 'reason'],
    processCellCallback: p => { const id = p.column.getColId(); return csvSafe(id === 'category' ? labels[p.value] : id === 'lineTotal' ? (p.value === null ? '' : (p.value / 100).toFixed(2)) : p.value); } });
}
let activeFilter = 'all';
function clearReview(message) {
  rows = []; sourceNotes = ''; grid.setGridOption('rowData', []); updateCounts(); $('#source-inspector').replaceChildren(); invalidatePreview();
  if (message) notify(message);
}
async function analyze() {
  const button = $('#analyze'), useAgent = reader === 'agent', notes = $('#notes').value;
  button.disabled = true; button.textContent = useAgent ? `Reading with the AI reader…` : 'Reading notes…';
  document.querySelectorAll('input[name=reader]').forEach(input => { input.disabled = true; });
  if (useAgent) { grid.setGridOption('loading', true); notify(`${status?.agent?.label ?? 'The local model'} is reading ${notes.split(/\r?\n/).filter(line => line.trim()).length} notes against the agreed scope. Nothing leaves this computer.`); }
  try {
    const result = useAgent
      ? await api('/api/agent-read', { notes, projectName: $('#project-title').textContent, quote: $('#quote-reference').textContent, scope: $('#quote-summary').textContent })
      : await api('/api/analyze', { notes });
    rows = result.rows; sourceNotes = notes; analyzedWith = useAgent ? 'agent' : 'classifier'; grid.setGridOption('rowData', rows); activeFilter = 'all';
    document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === activeFilter)));
    grid.onFilterChanged(); updateCounts();
    inspect(rows.find(row => row.prediction.label === 'extra') || rows[0]); invalidatePreview();
    notify(useAgent
      ? `The AI reader proposed ${rows.length} requests in ${result.seconds} seconds. Rules checked every quote and price against the notes${result.duplicates ? ` and merged ${result.duplicates} repeated ${result.duplicates === 1 ? 'item' : 'items'}` : ''}. Review each request before billing.`
      : 'Categories are suggestions. Check the source note before selecting work to bill.');
  } catch (error) { notify(error.message, true); }
  finally {
    grid.setGridOption('loading', false); configureReaders();
    button.disabled = false; button.replaceChildren(document.createTextNode('Read the notes '), el('span', '', '→'));
  }
}
function configureReaders() {
  const agent = status?.agent ?? { enabled: false }, ready = Boolean(agent.enabled && agent.ready);
  const agentInput = document.querySelector('input[name=reader][value=agent]');
  agentInput.disabled = !ready;
  document.querySelector('input[name=reader][value=classifier]').disabled = false;
  $('#agent-label').textContent = ready ? agent.label : agent.enabled ? `${agent.label} is not running` : 'Off · start with npm run start:agent';
  if (!ready && reader === 'agent') reader = 'classifier';
  document.querySelectorAll('input[name=reader]').forEach(input => { input.checked = input.value === reader; });
}
document.querySelectorAll('input[name=reader]').forEach(input => input.addEventListener('change', () => {
  if (!input.checked) return;
  reader = input.value;
  if (sample && [sample.notes, sample.thread].includes($('#notes').value)) $('#notes').value = reader === 'agent' ? sample.thread : sample.notes;
  if (reader === 'classifier') analyze(); else clearReview('Press "Read the notes" to let the local AI reader propose line items.');
}));
$('#analyze').addEventListener('click', analyze);
$('#notes').addEventListener('input', () => { if (currentPreview) invalidatePreview(); $('#prepare').disabled = true; $('#review-confirm').checked = false; });
$('#select-extra').addEventListener('click', () => { grid.deselectAll(); grid.forEachNode(node => { if (node.data.prediction.label === 'extra') node.setSelected(true); }); updateSelection(); });
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); grid.onFilterChanged(); }));
$('#review-confirm').addEventListener('change', () => { if ($('#notes').value !== sourceNotes) { $('#prepare').disabled = true; notify('The source notes changed. Read them again before preparing a draft.', true); } else updateSelection(); });
$('#prepare').addEventListener('click', async () => {
  grid.stopEditing();
  if ($('#notes').value !== sourceNotes) { notify('The source notes changed. Read them again before preparing a draft.', true); return; }
  $('#prepare').disabled = true;
  try {
    currentPreview = await api('/api/preview', {
      projectName: $('#project-title').textContent, quote: $('#quote-reference').textContent, date: $('#invoice-date').value,
      notes: sourceNotes, allReviewed: $('#review-confirm').checked, reader: analyzedWith,
      selections: selectedRows().map(({ id, sourceHash, description, quantity, unitAmount, prediction }) => ({ id, sourceHash, description, quantity, unitAmount, category: prediction.label })),
    });
    renderPreview(); notify('Draft prepared locally. Nothing has been created in PayPal.'); $('#invoice-preview').scrollIntoView({ behavior: 'auto', block: 'start' });
  } catch (error) { notify(error.message, true); }
  finally { updateSelection(); }
});
// The operator's own calendar date: toISOString alone would show yesterday for half the day east of UTC.
$('#invoice-date').value = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
$('#invoice-date').addEventListener('change', () => { if (currentPreview) invalidatePreview(); });

function renderPreview() {
  const { review } = currentPreview; $('#invoice-preview').hidden = false;
  $('#preview-total').textContent = `USD ${review.total}`; $('#preview-meta').textContent = `${review.quote} · ${review.date} · ${review.lines.length} selected requests`;
  const container = $('#preview-lines'); container.replaceChildren();
  review.lines.forEach(line => { const row = el('div', 'preview-line'); const text = el('div'); text.append(el('span', '', line.description), el('small', 'mono', `${line.id} · ${line.quantity} × $${line.unitAmount}`)); row.append(text, el('strong', '', `$${line.lineAmount}`)); container.append(row); });
  $('#sandbox-readback').hidden = true; $('#sandbox-readback').replaceChildren();
  $('#sandbox-draft').disabled = !currentPreview.sandboxAvailable;
  $('#sandbox-status').textContent = currentPreview.sandboxAvailable ? 'The owner has enabled sandbox testing. This action creates a draft only; it does not send an invoice.' : 'PayPal sandbox is not connected. Draft creation is disabled. The JSON and receipt are available for review.';
}
function download(content, filename, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = el('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('#download-receipt').addEventListener('click', () => { if (currentPreview) download(currentPreview.markdown, 'scope-receipt.md', 'text/markdown;charset=utf-8'); });
$('#download-payload').addEventListener('click', () => { if (currentPreview) download(JSON.stringify(currentPreview.review.payload, null, 2), 'paypal-invoice-draft.json', 'application/json'); });
$('#sandbox-draft').addEventListener('click', async () => {
  if (!currentPreview?.sandboxAvailable) return;
  $('#sandbox-draft').disabled = true;
  try {
    const receipt = await api('/api/sandbox-draft', { previewId: currentPreview.previewId, reviewDigest: currentPreview.review.digest, confirmDraft: true });
    const comparison = receipt.totalMatches === null ? ' PayPal did not return a total to compare.' : ` PayPal's total, USD ${receipt.reviewedTotal}, matches this review.`;
    $('#sandbox-status').textContent = receipt.totalMatches === false
      ? `Sandbox draft ${receipt.id} created, but PayPal shows ${receipt.currency} ${receipt.total} and this review says USD ${receipt.reviewedTotal}. Check it in the sandbox before using it. No invoice was sent.`
      : `Sandbox draft ${receipt.id} created.${comparison} Its status is DRAFT. No invoice was sent.`;
    $('#sandbox-status').classList.toggle('caution', receipt.totalMatches === false);
    currentPreview.sandboxAvailable = false;
    await readBack();
  } catch (error) { $('#sandbox-status').textContent = error.message; currentPreview.sandboxAvailable = error.retryable; $('#sandbox-draft').disabled = !error.retryable; }
});
async function readBack() {
  const box = $('#sandbox-readback'), preview = currentPreview; box.hidden = false; box.replaceChildren(el('p', 'tiny-label', 'READING THE DRAFT BACK FROM PAYPAL…'));
  try { renderReadback(await api('/api/sandbox-readback', { previewId: preview.previewId })); }
  catch (error) {
    const retry = el('button', 'text-button', 'Read back again'); retry.type = 'button'; retry.addEventListener('click', readBack);
    box.replaceChildren(el('p', 'source-caution', error.message), retry);
  }
}
function renderReadback(result) {
  const box = $('#sandbox-readback'), matching = result.lines.filter(line => line.matches).length;
  const head = el('div', 'readback-heading');
  head.append(el('span', 'tiny-label', 'READ BACK FROM PAYPAL'), el('strong', result.allMatch ? 'ok' : 'warn', result.allMatch ? `All ${result.lines.length} lines match the review` : `PayPal's copy differs from the review · ${matching} of ${result.lines.length} lines match`));
  const list = el('div', 'readback-lines');
  result.lines.forEach(line => {
    const row = el('div', `readback-line ${line.matches ? 'ok' : 'warn'}`);
    row.append(el('span', 'mono', line.id), el('span', '', line.paypal ? line.paypal.name : 'Missing in PayPal'), el('span', 'mono', line.paypal ? `${line.paypal.quantity} × $${line.paypal.unitAmount}` : '—'), el('b', '', line.matches ? '✓' : '!'));
    list.append(row);
  });
  box.replaceChildren(head, el('p', 'mono readback-meta', `${result.id} · status ${result.status} · ${result.currency} ${result.total}`), list);
}
async function restoreSample() {
  try {
    sample = await api('/api/sample'); $('#project-title').textContent = sample.name; $('#quote-summary').textContent = sample.quoteSummary; $('#quote-reference').textContent = sample.quote;
    $('#notes').value = reader === 'agent' ? sample.thread : sample.notes;
  } catch { notify('The local application server could not be reached.', true); return; }
  if (reader === 'agent') clearReview('Sample client messages loaded. Press "Read the notes" to let the local AI reader propose line items.'); else await analyze();
}
$('#sample-reset').addEventListener('click', restoreSample);
$('#grid-search').addEventListener('input', event => grid.setGridOption('quickFilterText', event.target.value));
$('#export-csv').addEventListener('click', () => { if (rows.length) exportCsv(); });
setupGrid();
try {
  status = await api('/api/status');
  $('#model-info').textContent = `Built-in classifier: ${status.model.trainingExamples} authored training examples. Accuracy on client records has not been measured for either reader.`;
  if (status.agent?.enabled && status.agent.ready) reader = 'agent';
} catch { /* The sample request below reports connection failure. */ }
configureReaders();
await restoreSample();
