const DRAFT_KEY = "workpilot_current_invoice_draft";
const SAVED_KEY = "workpilot_saved_invoices";
const SETTINGS_KEY = "workpilot_company_settings";
const CONTACTS_KEY = "workpilot_contacts";

let currentDraft = null;
let companySettings = null;
let renderTimer = null;

const offerDocument = document.getElementById("offerDocument");
const addPositionBtn = document.getElementById("addPositionBtn");
const saveOfferBtn = document.getElementById("saveOfferBtn");
const editorNotice = document.getElementById("editorNotice");
const printBtn = document.getElementById("printBtn");

function euro(value) {
const number = Number(value) || 0;
return number.toLocaleString("de-DE", {
style: "currency",
currency: "EUR"
});
}

function parseMoney(value) {
if (!value) return 0;

return Number(
String(value)
.replace("€", "")
.replace(/\./g, "")
.replace(",", ".")
.trim()
) || 0;
}

function getSavedJson(key, fallback) {
try {
return JSON.parse(localStorage.getItem(key)) || fallback;
} catch {
return fallback;
}
}

function loadData() {
currentDraft = getSavedJson(DRAFT_KEY, null);
companySettings = getSavedJson(SETTINGS_KEY, {});

if (!currentDraft) {
window.location.href = "/invoice-create";
return;
}

if (!currentDraft.positions || !Array.isArray(currentDraft.positions)) {
currentDraft.positions = [];
}

if (currentDraft.positions.length === 0) {
currentDraft.positions.push(createEmptyPosition());
}
}

function createEmptyPosition() {
return {
description: "",
quantity: "",
unit: "",
unitPrice: "",
total: ""
};
}

function escapeHtml(value) {
return String(value || "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;");
}

function calculateTotalsRaw() {
const net = currentDraft.positions.reduce((sum, position) => {
return sum + parseMoney(position.total);
}, 0);

const vatRate = Number(companySettings.vatRate || 19);
const vat = net * (vatRate / 100);
const gross = net + vat;

return { net, vat, gross, vatRate };
}

function createOfferPage({ isFirstPage, isLastPage }) {
const company = companySettings || {};
const draft = currentDraft;
const totals = calculateTotalsRaw();

const page = document.createElement("section");
page.className = "offerPage";

page.innerHTML = `
${isFirstPage ? `
<div class="offerTop">
<div>
<div class="senderSmall">
${escapeHtml(company.companyName || "Absender")} · ${escapeHtml(company.street || "")} · ${escapeHtml(company.city || "")}
</div>

<div class="recipientBlock">
<div>${escapeHtml(draft.recipientName)}</div>
<div>${escapeHtml(draft.recipientStreet)}</div>
<div>${escapeHtml(draft.recipientCity)}</div>
</div>
</div>

<div class="offerMeta">
<div class="metaCompany">${escapeHtml(company.companyName || "Ihre Firma")}</div>
<div>${escapeHtml(company.street || "")}</div>
<div>${escapeHtml(company.city || "")}</div>

<div class="metaSpacer"></div>

<div><strong>Rechnungsnummer:</strong> <span id="invoiceNumber"></span></div>

<div><strong>Rechnungsdatum:</strong> <span id="invoiceDate"></span></div>

<div><strong>Fällig bis:</strong> <span id="dueDate"></span></div>
</div>
</div>
` : `
<div class="followPageHeader">
Rechnung ${escapeHtml(draft.invoiceNumber)} · ${escapeHtml(draft.recipientName || "")}
</div>
`}

<div class="offerContent">
${isFirstPage ? `
<h2 class="offerTitle">Rechnung</h2>
<p class="editableText introText" contenteditable="true">${escapeHtml(draft.introText || "")}</p>
` : ""}

<table class="offerTable">
<thead>
<tr>
<th>Pos.</th>
<th>Beschreibung</th>
<th>Menge</th>
<th>Einheit</th>
<th>Einzelpreis</th>
<th>Gesamtpreis</th>
<th></th>
</tr>
</thead>
<tbody class="positionsBody"></tbody>
</table>

${isLastPage ? `
<div class="sumWrap">
<div class="sumBox">
<div class="sumRow">
<span>Nettopreis</span>
<strong>${euro(totals.net)}</strong>
</div>
<div class="sumRow">
<span>zzgl. Umsatzsteuer ${totals.vatRate} %</span>
<strong>${euro(totals.vat)}</strong>
</div>
<div class="sumRow total">
<span>Rechnungsbetrag</span>
<strong>${euro(totals.gross)}</strong>
</div>
</div>
</div>

<p class="paymentTerm">Zahlungsziel: ${escapeHtml(company.paymentTerm || "14 Tage")}.</p>

<p class="editableText closingText" contenteditable="true">${escapeHtml(draft.closingText || "")}</p>

<p class="signature">
Mit freundlichen Grüßen<br />
${escapeHtml(company.ownerName || company.companyName || "")}
</p>
` : ""}
</div>

<footer class="offerFooter">
<div>
<strong>${escapeHtml(company.companyName || "")}</strong><br />
<span>${escapeHtml(company.ownerName || "")}</span><br />
<span>${company.taxId ? "USt-ID: " + escapeHtml(company.taxId) : ""}</span>
</div>

<div>
<strong>Konto:</strong><br />
<span>${escapeHtml(company.bankName || "")}</span><br />
<span>${company.iban ? "IBAN: " + escapeHtml(company.iban) : ""}</span><br />
<span>${company.bic ? "BIC: " + escapeHtml(company.bic) : ""}</span>
</div>

<div>
<strong>Kontakt:</strong><br />
<span>${company.email ? "E-Mail: " + escapeHtml(company.email) : ""}</span><br />
<span>${company.website ? "Internet: " + escapeHtml(company.website) : ""}</span><br />
<span>${company.phone ? "Telefon: " + escapeHtml(company.phone) : ""}</span>
</div>
</footer>
`;

return page;
}

function createPositionRow(position, index) {
const row = document.createElement("tr");

row.innerHTML = `
<td>
<input class="posInput" value="${index + 1}" readonly />
</td>
<td>
<textarea class="descInput" data-index="${index}" data-field="description">${escapeHtml(position.description || "")}</textarea>
</td>
<td>
<input class="qtyInput" data-index="${index}" data-field="quantity" value="${escapeHtml(position.quantity || "")}" placeholder="1" />
</td>
<td>
<input class="unitInput" data-index="${index}" data-field="unit" value="${escapeHtml(position.unit || "")}" placeholder="Stk." />
</td>
<td>
<input class="priceInput" data-index="${index}" data-field="unitPrice" value="${escapeHtml(position.unitPrice || "")}" placeholder="0,00" />
</td>
<td>
<input class="totalInput" data-index="${index}" data-field="total" value="${escapeHtml(position.total || "")}" placeholder="0,00" />
</td>
<td>
<button type="button" class="iconBtn" title="Position löschen" data-delete="${index}">-</button>
</td>
`;

return row;
}

function renderDocument() {
const pagesData = [[]];

currentDraft.positions.forEach((position, index) => {
pagesData[pagesData.length - 1].push(index);

renderPagesFromData(pagesData, false);

const pages = offerDocument.querySelectorAll(".offerPage");
const lastPage = pages[pages.length - 1];

if (pageHasOverflow(lastPage)) {
pagesData[pagesData.length - 1].pop();
pagesData.push([index]);

renderPagesFromData(pagesData, false);
}
});

renderPagesFromData(pagesData, true);

const finalPages = offerDocument.querySelectorAll(".offerPage");
const finalLastPage = finalPages[finalPages.length - 1];

if (pageHasOverflow(finalLastPage)) {
pagesData.push([]);
renderPagesFromData(pagesData, true);
}

bindEvents();
}

function renderPagesFromData(pagesData, includeSummary) {
offerDocument.innerHTML = "";

pagesData.forEach((pageRows, pageIndex) => {
const isFirstPage = pageIndex === 0;
const isLastPage = includeSummary && pageIndex === pagesData.length - 1;

const page = createOfferPage({
isFirstPage,
isLastPage
});

const body = page.querySelector(".positionsBody");

pageRows.forEach((positionIndex) => {
body.appendChild(
createPositionRow(currentDraft.positions[positionIndex], positionIndex)
);
});

if (pageRows.length === 0) {
const table = page.querySelector(".offerTable");
if (table) table.style.display = "none";
}

offerDocument.appendChild(page);
});

offerDocument.querySelectorAll("textarea.descInput").forEach((textarea) => {
autoResizeTextarea(textarea);
});
}

function scheduleRender() {
clearTimeout(renderTimer);

renderTimer = setTimeout(() => {
persistDraft();
renderDocument();
}, 350);
}

function pageHasOverflow(page) {
const content = page.querySelector(".offerContent");

if (!content) return page.scrollHeight > page.clientHeight;

return (
page.scrollHeight > page.clientHeight ||
content.scrollHeight > content.clientHeight
);
}

function handlePositionInput(event) {
const index = Number(event.target.dataset.index);
const field = event.target.dataset.field;

currentDraft.positions[index][field] = event.target.value;

if (field === "quantity" || field === "unitPrice") {
updateRowTotal(index);
}

persistDraft();
renderDocument();
}

function autoResizeTextarea(textarea) {
textarea.style.height = "34px";
textarea.style.height = textarea.scrollHeight + "px";
}



function updateRowTotal(index) {
const position = currentDraft.positions[index];

const quantity = parseMoney(position.quantity);
const unitPrice = parseMoney(position.unitPrice);

if (!quantity || !unitPrice) return;

const total = quantity * unitPrice;
position.total = total.toFixed(2).replace(".", ",");
}

function deletePosition(event) {
const index = Number(event.target.dataset.delete);

currentDraft.positions.splice(index, 1);

if (currentDraft.positions.length === 0) {
currentDraft.positions.push(createEmptyPosition());
}

persistDraft();
renderDocument();
}

function addPosition() {
currentDraft.positions.push(createEmptyPosition());
persistDraft();
renderDocument();
}

function persistDraft() {
const intro = offerDocument.querySelector(".introText");
const closing = offerDocument.querySelector(".closingText");

if (intro) currentDraft.introText = intro.textContent.trim();
if (closing) currentDraft.closingText = closing.textContent.trim();

localStorage.setItem(DRAFT_KEY, JSON.stringify(currentDraft));
}

function saveOffer() {
persistDraft();

const savedOffers = getSavedJson(SAVED_KEY, []);

const saved = {
...currentDraft,
companySettings,
savedAt: new Date().toISOString()
};

const existingIndex = savedOffers.findIndex(
(offer) => offer.id === currentDraft.id
);

if (existingIndex !== -1) {
savedOffers[existingIndex] = saved;
} else {
savedOffers.unshift(saved);
}

localStorage.setItem(SAVED_KEY, JSON.stringify(savedOffers));

showToast("Rechnung wurde gespeichert.");
}

function bindEvents() {
offerDocument.querySelectorAll("textarea.descInput").forEach((textarea) => {
autoResizeTextarea(textarea);

textarea.addEventListener("input", (event) => {
const index = Number(event.target.dataset.index);
const field = event.target.dataset.field;

autoResizeTextarea(event.target);

currentDraft.positions[index][field] = event.target.value;

scheduleRender();
});

textarea.addEventListener("blur", handlePositionInput);
});

offerDocument.querySelectorAll("input[data-field]").forEach((field) => {
field.addEventListener("change", handlePositionInput);
});

offerDocument.querySelectorAll("[data-delete]").forEach((button) => {
button.addEventListener("click", deletePosition);
});

offerDocument.querySelectorAll(".introText, .closingText").forEach((text) => {
text.addEventListener("blur", persistDraft);
});
}

function init() {
loadData();
renderDocument();

addPositionBtn.addEventListener("click", addPosition);
saveOfferBtn.addEventListener("click", saveOffer);
printBtn.addEventListener("click", () => window.print());
}

document.addEventListener("DOMContentLoaded", init);
