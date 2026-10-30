let DRAFT_KEY = null;
let SETTINGS_KEY = null;
const requestPoints = document.getElementById("requestPoints");
const addRequestPointBtn = document.getElementById("addRequestPointBtn");

function generateId(prefix = "id") {
return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const offerCreateForm = document.getElementById("offerCreateForm");
const createNotice = document.getElementById("createNotice");

function getContactIdFromUrl() {
const params = new URLSearchParams(window.location.search);
return params.get("contactId");
}

async function apiGetContact(contactId) {
const response = await fetch(`/api/contacts/${contactId}`);
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakt konnte nicht geladen werden.");
}

return result.contact;
}

function formatDate(date) {
return date.toLocaleDateString("de-DE", {
day: "2-digit",
month: "2-digit",
year: "numeric"
});
}

function addDays(date, days) {
const copy = new Date(date);
copy.setDate(copy.getDate() + Number(days));
return copy;
}

function createOfferNumber() {
const now = new Date();
const year = now.getFullYear();
const random = Math.floor(1000 + Math.random() * 9000);
return `WP-${year}-${random}`;
}

function escapeField(value) {
return String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function parseDecimal(value) {
const text = String(value ?? "").trim().replace(/\s/g, "");
if (!text) return 0;
const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
const number = Number(normalized);
return Number.isFinite(number) ? number : 0;
}
function createRequestPoint(value = {}) {
const position = typeof value === "string" ? {description: value} : value;
const wrapper = document.createElement("div");
wrapper.className = "requestPoint";
wrapper.innerHTML = `
<div class="wpPositionGrid">
<label>Beschreibung<textarea class="requestPointInput" placeholder="Leistung oder Artikel" rows="2">${escapeField(position.description || "")}</textarea></label>
<label>Menge<input class="requestQty" inputmode="decimal" value="${escapeField(position.quantity ?? "1")}" /></label>
<label>Einheit<input class="requestUnit" value="${escapeField(position.unit || "Stk.")}" /></label>
<label>Einzelpreis (€)<input class="requestPrice" inputmode="decimal" value="${escapeField(position.unitPrice ?? "")}" /></label>
<label>Gesamt (€)<output class="requestTotal">0,00 €</output></label>
<button type="button" class="btn btnSecondary requestPointRemove" aria-label="Position entfernen">Entfernen</button>
</div>`;
wrapper.querySelector(".requestPointRemove").addEventListener("click", () => {
if (requestPoints.children.length > 1) wrapper.remove();
updateCreateTotals();
});
wrapper.addEventListener("input", updateCreateTotals);
requestPoints.appendChild(wrapper);
updateCreateTotals();
}
function collectRequestPoints() {
return [...requestPoints.querySelectorAll(".requestPoint")].map((row, index) => {
const quantity = parseDecimal(row.querySelector(".requestQty").value);
const unitPrice = parseDecimal(row.querySelector(".requestPrice").value);
return {pos:index + 1, description:row.querySelector(".requestPointInput").value.trim(),
quantity:row.querySelector(".requestQty").value.trim(), unit:row.querySelector(".requestUnit").value.trim(),
unitPrice:row.querySelector(".requestPrice").value.trim(), total:(quantity * unitPrice).toFixed(2)};
}).filter(item => item.description);
}
function updateCreateTotals() {
let sum = 0;
requestPoints.querySelectorAll(".requestPoint").forEach(row => {
const total = parseDecimal(row.querySelector(".requestQty").value) * parseDecimal(row.querySelector(".requestPrice").value);
row.querySelector(".requestTotal").textContent = total.toLocaleString("de-DE", {style:"currency",currency:"EUR"});
sum += total;
});
const output = document.getElementById("offerCreateNet");
if (output) output.textContent = sum.toLocaleString("de-DE", {style:"currency",currency:"EUR"});
}
function createPositionDescription(text, trade) {
const tradeLabels = {
maler: "Ausführung der Malerarbeiten gemäß Anfrage",
elektro: "Ausführung der Elektroarbeiten gemäß Anfrage",
sanitaer: "Ausführung der Sanitär-/Heizungsarbeiten gemäß Anfrage",
abriss: "Ausführung der Abrissarbeiten gemäß Anfrage",
kfz: "Ausführung der KFZ-Arbeiten gemäß Anfrage",
allgemein: "Ausführung der Arbeiten gemäß Anfrage"
};

const base = tradeLabels[trade] || tradeLabels.allgemein;

return `${base}: ${text}`;
}

function createOfferDraft(event) {
event.preventDefault();
if (!DRAFT_KEY || !SETTINGS_KEY) { showToast("Bitte melde dich an, um ein Angebot zu erstellen."); return; }

const today = new Date();
const validDays = document.getElementById("validDays").value;
const offerId = crypto.randomUUID();

if (!collectRequestPoints().length) { showToast("Bitte mindestens eine Position beschreiben."); return; }

const draft = {
id: offerId,
createdAt: new Date().toISOString(),
contactId: getContactIdFromUrl(),
status: "open",

recipientName: document.getElementById("recipientName").value.trim(),
recipientStreet: document.getElementById("recipientStreet").value.trim(),
recipientCity: document.getElementById("recipientCity").value.trim(),
recipientEmail: document.getElementById("recipientEmail").value.trim(),
requestPoints: collectRequestPoints().map(p => p.description),
offerNumber: createOfferNumber(),
offerDate: formatDate(today),
validUntil: formatDate(addDays(today, validDays)),
introText: document.getElementById("offerIntro").value.trim(),
closingText: document.getElementById("offerClosing").value.trim(),
template: document.getElementById("offerTemplate").value,
positions: collectRequestPoints(),
companySettings: JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
};

console.log("CONTACT ID:", getContactIdFromUrl());
console.log("DRAFT:", draft);

localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

showToast("Angebot wird vorbereitet.");

setTimeout(() => {
window.location.href = "/offer-editor";
}, 500);
}

async function preloadContact() {
const contactId = getContactIdFromUrl();

if (!contactId) return;

try {
const contact = await apiGetContact(contactId);

document.getElementById("recipientName").value =
contact.name || "";

document.getElementById("recipientStreet").value =
contact.street || "";

document.getElementById("recipientCity").value =
contact.city || "";

document.getElementById("recipientEmail").value =
contact.email || "";

} catch (error) {
console.error(error);
}
}

offerCreateForm.addEventListener("submit", createOfferDraft);
(async () => {
 try {
  const response = await fetch("/api/workspace-context", {cache:"no-store"});
  const context = await response.json();
  if (!response.ok || !context.ok || !context.companyId || !context.userId) throw new Error("Firmenkontext fehlt");
  DRAFT_KEY = `workpilot_current_offer_draft:${context.companyId}:${context.userId}`;
  SETTINGS_KEY = `workpilot_company_settings:${context.companyId}:${context.userId}`;
 } catch (error) {
  console.error(error); offerCreateForm.querySelector('[type="submit"]').disabled = true;
  showToast("Bitte melde dich zuerst an.");
 }
})();

createRequestPoint();

addRequestPointBtn.addEventListener("click", () => {
createRequestPoint();
});

document.addEventListener("DOMContentLoaded", preloadContact);

// Visuelle Dokumentvorschau: keine Server-/PDF-Funktion, nur der lokale Entwurf.
function renderOfferLivePreview() {
 const byId = id => document.getElementById(id);
 const recipient = [byId('recipientName').value,byId('recipientStreet').value,byId('recipientCity').value].filter(Boolean).join('\n');
 byId('previewRecipient').textContent = recipient || 'Kunde / Empfänger';
 byId('previewIntro').textContent = byId('offerIntro').value;
 byId('previewClosing').textContent = byId('offerClosing').value;
 byId('offerLivePaper').dataset.template = byId('offerTemplate').value;
 byId('previewDate').textContent = new Date().toLocaleDateString('de-DE');
 const tbody = byId('previewPositions'); tbody.replaceChildren();
 let sum = 0;
 collectRequestPoints().forEach((point,i) => {
  const qty = parseDecimal(point.quantity), price = parseDecimal(point.unitPrice), total = qty * price; sum += total;
  const tr = document.createElement('tr');
  [i+1,point.description,point.quantity,point.unit,price.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}),total.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})].forEach(v => {const td=document.createElement('td');td.textContent=String(v);tr.appendChild(td);});
  tbody.appendChild(tr);
 });
 if (!tbody.children.length) {const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=6;td.textContent='Noch keine Positionen';tr.appendChild(td);tbody.appendChild(tr);}
 byId('previewTotal').textContent=sum.toLocaleString('de-DE',{style:'currency',currency:'EUR'});
}
document.getElementById('offerDateDisplay').value = new Date().toLocaleDateString('de-DE');
document.getElementById('scrollToPreview').addEventListener('click', () => document.getElementById('offerLivePaper').scrollIntoView({behavior:'smooth',block:'center'}));
document.getElementById('offerCreateForm').addEventListener('input',renderOfferLivePreview);
document.getElementById('offerCreateForm').addEventListener('change',renderOfferLivePreview);
const wpOriginalUpdateCreateTotals = updateCreateTotals;
updateCreateTotals = function(){wpOriginalUpdateCreateTotals();renderOfferLivePreview();};
renderOfferLivePreview();
