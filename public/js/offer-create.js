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
<span class="wpRowNumber" aria-label="Positionsnummer"></span>
<label class="wpCellDescription"><textarea class="requestPointInput" placeholder="Leistung oder Artikel" rows="1">${escapeField(position.description || "")}</textarea></label>
<label class="wpCellQty">Menge<input class="requestQty" inputmode="decimal" value="${escapeField(position.quantity ?? "1")}" /></label>
<label class="wpCellUnit">Einheit<input class="requestUnit" value="${escapeField(position.unit || "Stk.")}" /></label>
<label class="wpCellPrice">Einzelpreis (€)<input class="requestPrice" inputmode="decimal" value="${escapeField(position.unitPrice ?? "")}" /></label>
<label class="wpCellTotal">Gesamt (€)<output class="requestTotal">0,00 €</output></label>
<button type="button" class="btn btnSecondary requestPointRemove" aria-label="Position entfernen"><span data-icon="trash-2" aria-hidden="true"></span></button>
</div>`;
wrapper.querySelector(".requestPointRemove").addEventListener("click", () => {
if (requestPoints.children.length > 1) wrapper.remove();
renumberOfferRows();
updateCreateTotals();
});
wrapper.addEventListener("input", updateCreateTotals);
requestPoints.appendChild(wrapper);
if (window.wpRenderIcons) window.wpRenderIcons(wrapper);
renumberOfferRows();
updateCreateTotals();
}
function renumberOfferRows() { requestPoints.querySelectorAll(".wpRowNumber").forEach((el,i) => el.textContent = String(i+1)); }
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
const discount = Math.min(100,Math.max(0,parseDecimal(document.getElementById("offerDiscount")?.value)));
const grand = document.getElementById("offerCreateGrand"); if(grand) grand.textContent=(sum*(1-discount/100)).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
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

let editingOfferId = new URLSearchParams(location.search).get("id");
let editingOffer = null;
let isSavingOffer = false;

function buildOfferPayload() {
 const today = new Date();
 const dateText = document.getElementById("offerDateDisplay").value || formatDate(today);
 const days = Number(document.getElementById("validDays").value) || 14;
 const points = collectRequestPoints();
 return {
  ...(editingOffer || {}),
  id: editingOfferId || crypto.randomUUID(),
  createdAt: editingOffer?.createdAt || today.toISOString(),
  contactId: customerSelect.value || getContactIdFromUrl() || editingOffer?.contactId || null,
  status: editingOffer?.status || "open",
  recipientName: document.getElementById("recipientName").value.trim(),
  recipientStreet: document.getElementById("recipientStreet").value.trim(),
  recipientCity: document.getElementById("recipientCity").value.trim(),
  recipientEmail: document.getElementById("recipientEmail").value.trim(),
  requestPoints: points.map(p => p.description),
  offerNumber: editingOffer?.offerNumber || createOfferNumber(),
  offerDate: dateText,
  validUntil: formatDate(addDays(today, days)),
  introText: document.getElementById("offerIntro").value.trim(),
  closingText: document.getElementById("offerClosing").value.trim(),
  subject: document.getElementById("offerSubject").value.trim(),
  discountPercent: Math.min(100,Math.max(0,parseDecimal(document.getElementById("offerDiscount").value))),
  footerMode: document.getElementById("footerMode").value,
  template: document.getElementById("offerTemplate").value,
  currency: document.getElementById("offerCurrency").value,
  taxMode: document.getElementById("offerTax").value,
  positions: points,
  companySettings: JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
 };
}

async function createOfferDraft(event) {
 event.preventDefault();
 if(isSavingOffer) return;
 if (!DRAFT_KEY || !SETTINGS_KEY) { showToast("Bitte melde dich an, um ein Angebot zu erstellen."); return; }
 const points=collectRequestPoints();
 if (!points.length || points.some(p => !p.description)) {showToast("Bitte mindestens eine Position ausfüllen.");return;}
 if (points.some(p => parseDecimal(p.quantity) <= 0 || parseDecimal(p.unitPrice) < 0)) {showToast("Bitte Mengen und Preise prüfen.");return;}
 if (!document.getElementById("recipientName").value.trim()) {showToast("Bitte einen Empfänger angeben.");return;}
 const payload=buildOfferPayload();
 const submit=offerCreateForm.querySelector('[type="submit"]');
 isSavingOffer=true; submit.disabled=true;
 try {
  const response=await fetch(editingOfferId ? `/api/offers/${encodeURIComponent(editingOfferId)}` : '/api/offers', {
   method:editingOfferId ? 'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
  });
  const result=await response.json();
  if(!response.ok || !result.ok) throw new Error(result.error || 'Angebot konnte nicht gespeichert werden.');
  editingOfferId=payload.id; editingOffer=payload;
  localStorage.removeItem(DRAFT_KEY);
  history.replaceState(null,'',`/offer-create?id=${encodeURIComponent(payload.id)}`);
  document.getElementById('offerNumberDisplay').value=payload.offerNumber;
  document.querySelector('.pageTitle').textContent='Angebot bearbeiten';
  submit.textContent='Änderungen speichern';
  showToast('Angebot erfolgreich gespeichert.');
 } catch(error){console.error(error);showToast(error.message || 'Speichern fehlgeschlagen.');}
 finally {isSavingOffer=false;submit.disabled=false;}
}

async function loadExistingOffer() {
 if (!editingOfferId) return;
 const submit=offerCreateForm.querySelector('[type="submit"]');submit.disabled=true;
 try {
  const response=await fetch(`/api/offers/${encodeURIComponent(editingOfferId)}`,{cache:'no-store'});
  const result=await response.json();
  if(!response.ok || !result.ok || !result.offer) throw new Error('Angebot nicht gefunden oder kein Zugriff.');
  const row=result.offer;const d=row.data || {};
  editingOffer={...d,id:row.id,contactId:row.contact_id,offerNumber:row.offer_number || d.offerNumber,status:row.status};
  const fields={recipientName:d.recipientName,recipientStreet:d.recipientStreet,recipientCity:d.recipientCity,recipientEmail:d.recipientEmail,offerSubject:d.subject,offerIntro:d.introText,offerClosing:d.closingText,offerDiscount:d.discountPercent,offerTemplate:d.template,footerMode:d.footerMode,offerCurrency:d.currency,offerTax:d.taxMode,offerDateDisplay:d.offerDate,offerNumberDisplay:row.offer_number || d.offerNumber};
  for(const [id,value] of Object.entries(fields)){const el=document.getElementById(id);if(el && value!==undefined && value!==null)el.value=value;}
  if(d.validUntil && d.offerDate){const parse=x=>{const m=String(x).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);return m?new Date(+m[3],+m[2]-1,+m[1]):null;};const a=parse(d.offerDate),b=parse(d.validUntil);if(a&&b){const days=Math.round((b-a)/86400000);const valid=document.getElementById('validDays');if([...valid.options].some(o=>Number(o.value)===days))valid.value=String(days);}}
  if(row.contact_id){customerSelect.value=row.contact_id; if(![...customerSelect.options].some(o=>o.value===row.contact_id)){const opt=document.createElement('option');opt.value=row.contact_id;opt.textContent=d.recipientName||'Ausgewählter Kunde';customerSelect.appendChild(opt);customerSelect.value=row.contact_id;}}
  requestPoints.replaceChildren();
  for(const p of (Array.isArray(d.positions)&&d.positions.length?d.positions:(d.requestPoints||[])))createRequestPoint(p);
  if(!requestPoints.children.length)createRequestPoint();
  document.querySelector('.pageTitle').textContent='Angebot bearbeiten';
  submit.textContent='Änderungen speichern';
  renderOfferLivePreview();
 }catch(error){console.error(error);showToast(error.message);submit.disabled=true;return;}
 submit.disabled=false;
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

document.addEventListener("DOMContentLoaded", () => { if (!editingOfferId) preloadContact(); });

// Visuelle Dokumentvorschau: keine Server-/PDF-Funktion, nur der lokale Entwurf.
function renderOfferLivePreview() {
 const byId = id => document.getElementById(id);
 const recipient = [byId('recipientName').value,byId('recipientStreet').value,byId('recipientCity').value].filter(Boolean).join('\n');
 byId('previewRecipient').textContent = recipient || 'Kunde / Empfänger';
 byId('previewIntro').textContent = byId('offerIntro').value;
 byId('previewClosing').textContent = byId('offerClosing').value;
 byId('offerLivePaper').dataset.template = byId('offerTemplate').value;
 byId('previewDate').textContent = byId('offerDateDisplay').value || new Date().toLocaleDateString('de-DE');
 const tbody = byId('previewPositions'); tbody.replaceChildren();
 let sum = 0;
 collectRequestPoints().forEach((point,i) => {
  const qty = parseDecimal(point.quantity), price = parseDecimal(point.unitPrice), total = qty * price; sum += total;
  const tr = document.createElement('tr');
  [i+1,point.description,point.quantity,point.unit,price.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}),total.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})].forEach(v => {const td=document.createElement('td');td.textContent=String(v);tr.appendChild(td);});
  tbody.appendChild(tr);
 });
 if (!tbody.children.length) {const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=6;td.textContent='Noch keine Positionen';tr.appendChild(td);tbody.appendChild(tr);}
 sum *= 1-Math.min(100,Math.max(0,parseDecimal(byId('offerDiscount').value)))/100;
 byId('previewTotal').textContent=sum.toLocaleString('de-DE',{style:'currency',currency:'EUR'});
}
document.getElementById('offerDateDisplay').value = new Date().toLocaleDateString('de-DE');
document.getElementById('discardOffer').addEventListener('click', () => {
 if(!confirm('Ungespeicherte Änderungen verwerfen? Bereits gespeicherte Angebote bleiben erhalten.'))return;
 if(DRAFT_KEY)localStorage.removeItem(DRAFT_KEY);
 window.location.href='/offers';
});
document.getElementById('newCustomerBtn').addEventListener('click', () => { window.location.href='/contact-create?returnTo='+encodeURIComponent('/offer-create'); });
const customerSelect=document.getElementById('customerSelect');
customerSelect.addEventListener('change', async () => { if(!customerSelect.value)return; try { const c=await apiGetContact(customerSelect.value); document.getElementById('recipientName').value=c.name||''; document.getElementById('recipientStreet').value=c.street||''; document.getElementById('recipientCity').value=c.city||''; document.getElementById('recipientEmail').value=c.email||''; renderOfferLivePreview(); } catch(e){console.warn('Kunde konnte nicht geladen werden',e);} });
// Kundenliste wird nur dann gefüllt, wenn die vorhandene Kontakt-API ein lesbares Array liefert.
(async()=>{try{const r=await fetch('/api/contacts');if(!r.ok)return;const data=await r.json();const list=Array.isArray(data)?data:(Array.isArray(data.contacts)?data.contacts:[]);for(const c of list){if(!c.id)continue;if([...customerSelect.options].some(o=>o.value===c.id))continue;const opt=document.createElement('option');opt.value=c.id;opt.textContent=c.name||c.company_name||'Kontakt';customerSelect.appendChild(opt);}}catch(e){console.warn('Kundenliste nicht verfügbar',e);}})();
document.getElementById('offerDiscount').addEventListener('input',()=>{updateCreateTotals();renderOfferLivePreview();});
document.getElementById('offerCreateForm').addEventListener('input',renderOfferLivePreview);
document.getElementById('offerCreateForm').addEventListener('change',renderOfferLivePreview);
const wpOriginalUpdateCreateTotals = updateCreateTotals;
updateCreateTotals = function(){wpOriginalUpdateCreateTotals();renderOfferLivePreview();};
renderOfferLivePreview();

// Vorhandene Angebote werden auf derselben Seite geladen und bearbeitet.
loadExistingOffer();
