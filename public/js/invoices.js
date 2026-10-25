const INVOICES_KEY = "workpilot_saved_invoices";
const CONTACTS_KEY = "workpilot_contacts";
const DRAFT_KEY = "workpilot_current_invoice_draft";

const invoicesList = document.getElementById("invoicesList");
const emptyInvoices = document.getElementById("emptyInvoices");

const invoiceMailModal = document.getElementById("invoiceMailModal");
const closeInvoiceMailModal = document.getElementById("closeInvoiceMailModal");
const invoiceMailRecipient = document.getElementById("invoiceMailRecipient");
const invoiceMailSubject = document.getElementById("invoiceMailSubject");
const invoiceMailMessage = document.getElementById("invoiceMailMessage");
const sendInvoiceMailBtn = document.getElementById("sendInvoiceMailBtn");

let activeInvoiceForAssign = null;

function openContactAssignModal(invoiceId) {
activeInvoiceForAssign = invoiceId;

const modal = document.getElementById("contactAssignModal");
const searchInput = document.getElementById("contactSearchInput");

modal.classList.remove("hidden");

if (searchInput) {
searchInput.value = "";
searchInput.focus();
}

renderContactSearchResults("");
}

function renderContactSearchResults(searchTerm = "") {
const resultsContainer = document.getElementById("contactSearchResults");

if (!resultsContainer) return;

const contacts = getContacts();

const normalizedSearch = searchTerm.toLowerCase().trim();

const filteredContacts = contacts.filter((contact) => {
const text = `
${contact.name || ""}
${contact.email || ""}
${contact.phone || ""}
${contact.street || ""}
${contact.city || ""}
`.toLowerCase();

return text.includes(normalizedSearch);
});

resultsContainer.innerHTML = "";

if (!filteredContacts.length) {
resultsContainer.innerHTML = `
<div class="emptyState">
<p>Keine Kontakte gefunden.</p>
</div>
`;
return;
}

filteredContacts.forEach((contact) => {
const item = document.createElement("button");
item.type = "button";
item.className = "contactSearchItem";
item.dataset.contactId = contact.id;

item.innerHTML = `
<strong>${contact.name || "Unbekannter Kontakt"}</strong>
<span>${contact.email || "Keine E-Mail"}</span>
`;

item.addEventListener("click", () => {
assignContactFromModal(contact.id);
});

resultsContainer.appendChild(item);
});
}

async function assignContactFromModal(contactId) {
if (!activeInvoiceForAssign) return;

try {
const invoices = await apiGetInvoices();
const invoice = invoices.find((entry) => entry.id === activeInvoiceForAssign);

if (!invoice) {
showToast("Rechnung wurde nicht gefunden.");
return;
}

invoice.contactId = contactId;

await apiSaveInvoice(invoice);

showToast("Kontakt wurde zugeordnet.");

document
.getElementById("contactAssignModal")
.classList.add("hidden");

activeInvoiceForAssign = null;

renderInvoices();
} catch (error) {
showToast(error.message);
}
}

async function openInvoiceMailModal(invoiceId) {
const invoices = await apiGetInvoices();

const invoice = invoices.find((entry) => entry.id === invoiceId);

if (!invoice) {
showToast("Rechnung wurde nicht gefunden.");
return;
}

activeInvoiceForMail = invoice;

invoiceMailRecipient.value = invoice.recipientEmail || "";

invoiceMailSubject.value = `Rechnung ${invoice.invoiceNumber || ""}`;

invoiceMailMessage.value =
`Hallo ${invoice.recipientName || ""},

anbei erhalten Sie unsere Rechnung.

Bitte überweisen Sie den Rechnungsbetrag innerhalb des angegebenen Zahlungsziels.

Mit freundlichen Grüßen
`;

invoiceMailModal.classList.remove("hidden");
}

function getSavedJson(key, fallback = []) {
try {
return JSON.parse(localStorage.getItem(key)) || fallback;
} catch {
return fallback;
}
}

function saveJson(key, value) {
localStorage.setItem(key, JSON.stringify(value));
}

function getInvoices() {
return getSavedJson(INVOICES_KEY, []);
}

let contactsCache = [];

async function apiGetContacts() {
const response = await fetch("/api/contacts");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakte konnten nicht geladen werden.");
}

return result.contacts || [];
}

function getContacts() {
return contactsCache;
}

function getContactName(contactId) {
const contact = getContacts().find((entry) => entry.id === contactId);
return contact ? contact.name : null;
}

function renderContactOptions(selectedId) {
const contacts = getContacts();

return `
<option value="">Nicht zugeordnet</option>
${contacts.map((contact) => `
<option value="${contact.id}" ${selectedId === contact.id ? "selected" : ""}>
${contact.name}
</option>
`).join("")}
`;
}

const wpRechnungenState = {page:1, size:8};
function wpEsc(v) { return String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function wpFilterRechnungen(rows) {
 const query=(document.getElementById('wp-search')?.value||'').toLocaleLowerCase('de').trim();
 const status=document.getElementById('wp-filter-status')?.value||'';
 const assigned=document.getElementById('wp-filter-assigned')?.value||'';
 const from=document.getElementById('wp-filter-from')?.value||'';
 const to=document.getElementById('wp-filter-to')?.value||'';
 return rows.filter(row=>{
 const date=String(row.invoiceDate||row.createdAt||'').slice(0,10);
 const normalized=/^\d{2}\.\d{2}\.\d{4}$/.test(date)?date.slice(6)+'-'+date.slice(3,5)+'-'+date.slice(0,2):date;
 if(status && (row.status||'open')!==status) return false;
 if(assigned==='yes'&&!row.contactId || assigned==='no'&&row.contactId) return false;
 if(from && normalized<from || to && normalized>to) return false;
 if(query && ![row.invoiceNumber,row.recipientName,getContactName(row.contactId)].some(v=>String(v||'').toLocaleLowerCase('de').includes(query)))return false;
 return true;
 });
}
function wpUpdateRechnungenStats(rows) {
 const stats={all:rows.length,open:0,paid:0,overdue:0};
 rows.forEach(r=>{const key=r.status||'open';if(key in stats)stats[key]++;});
 Object.entries(stats).forEach(([key,value])=>{const el=document.getElementById('wp-stat-'+key);if(el)el.textContent=value;});
}
function wpPaginationRechnungen(total) {
 const el=document.getElementById('wp-pagination');if(!el)return;
 const pages=Math.max(1,Math.ceil(total/wpRechnungenState.size));
 wpRechnungenState.page=Math.min(wpRechnungenState.page,pages);
 el.replaceChildren();
 const info=document.createElement('span');info.textContent=`${total?((wpRechnungenState.page-1)*wpRechnungenState.size+1):0}–${Math.min(total,wpRechnungenState.page*wpRechnungenState.size)} von ${total} Rechnungen`;el.append(info);
 const actions=document.createElement('div');actions.className='wp-page-actions';
 for(const [label,target,disabled] of [['‹',wpRechnungenState.page-1,wpRechnungenState.page===1],...Array.from({length:Math.min(pages,7)},(_,i)=>[String(i+1),i+1,false]),['›',wpRechnungenState.page+1,wpRechnungenState.page===pages]]){
 const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=disabled;b.className='wp-page-button'+(target===wpRechnungenState.page&&label===String(target)?' active':'');b.addEventListener('click',()=>{wpRechnungenState.page=target;renderInvoices();});actions.append(b);
 }el.append(actions);
}
async function renderInvoices() {
let invoices = [];

try {
invoices = await apiGetInvoices();
} catch (error) {
showToast(error.message);
}

invoicesList.innerHTML = "";
wpUpdateRechnungenStats(invoices);
invoices=wpFilterRechnungen(invoices);
wpPaginationRechnungen(invoices.length);
invoices=invoices.slice((wpRechnungenState.page-1)*wpRechnungenState.size,wpRechnungenState.page*wpRechnungenState.size);

if (!invoices.length) {
emptyInvoices.style.display = "block";
return;
}

emptyInvoices.style.display = "none";

invoices
.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
.forEach((invoice) => {
const item = document.createElement("div");
item.className = "invoiceItem";

const contactLabel = getContactName(invoice.contactId) || "Nicht zugeordnet";

item.innerHTML = `
<div class="invoiceInfo">
<div class="invoiceTitle">${invoice.invoiceNumber || "Unbenannte Rechnung"}</div>
<div class="invoiceMeta">${invoice.recipientName || "Kein Kunde"}</div>
<div class="invoiceMeta">Rechnungsdatum: ${invoice.invoiceDate || "-"}</div>

</div>
<div class="wp-row-date">${wpEsc(invoice.invoiceDate || "–")}</div>

<div class="wp-status-cell">
<select class="statusSelect" data-status="${invoice.id}">
<option value="open" ${invoice.status === "open" || !invoice.status ? "selected" : ""}>Offen</option>
<option value="paid" ${invoice.status === "paid" ? "selected" : ""}>Bezahlt</option>
<option value="overdue" ${invoice.status === "overdue" ? "selected" : ""}>Überfällig</option>
</select>
</div>
<div class="wp-assignment-cell">

<div class="contactAssignWrap">

  <button
    type="button"
    class="contactAssignBtn"
    data-assign="${invoice.id}"
  >
    ${contactLabel}
  </button>

  ${invoice.contactId ? `
    <button
      type="button"
      class="contactRemoveBtn"
      data-unassign="${invoice.id}"
      title="Kontaktzuordnung entfernen"
      aria-label="Kontaktzuordnung entfernen"
    >
      ×
    </button>
  ` : ""}

</div>

</div>
<div class="invoiceActions">
<button class="btn btnSecondary" data-open="${invoice.id}">Öffnen</button>

<button class="btn btnPrimary sendBtn" data-send="${invoice.id}">
Senden
</button>

<button class="btn btnSecondary" data-delete="${invoice.id}">
Löschen
</button>
</div>
`;

invoicesList.appendChild(item);
});

bindActions();
}

async function apiGetInvoices() {
const response = await fetch("/api/invoices");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Rechnungen konnten nicht geladen werden.");
}

return (result.invoices || []).map((row) => ({
...row.data,
id: row.id,
contactId: row.contact_id,
status: row.status,
invoiceNumber: row.invoice_number
}));
}

async function apiSaveInvoice(invoice) {
const response = await fetch(`/api/invoices/${invoice.id}`, {
method: "PUT",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(invoice)
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Rechnung konnte nicht gespeichert werden.");
}
}

async function apiDeleteInvoice(invoiceId) {
const response = await fetch(`/api/invoices/${invoiceId}`, {
method: "DELETE"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Rechnung konnte nicht gelöscht werden.");
}
}

async function assignContact(event) {
const invoiceId = event.target.dataset.assign;
const contactId = event.target.value || null;

try {
const invoices = await apiGetInvoices();
const invoice = invoices.find((entry) => entry.id === invoiceId);

if (!invoice) {
showToast("Rechnung wurde nicht gefunden.");
return;
}

invoice.contactId = contactId;

await apiSaveInvoice(invoice);

showToast(contactId ? "Kontakt wurde zugeordnet." : "Kontaktzuordnung entfernt.");
renderInvoices();
} catch (error) {
showToast(error.message);
}
}

async function openInvoice(event) {
const invoiceId = event.target.dataset.open;

try {
const invoices = await apiGetInvoices();
const invoice = invoices.find((entry) => entry.id === invoiceId);

if (!invoice) {
showToast("Rechnung konnte nicht geöffnet werden.");
return;
}

localStorage.setItem(DRAFT_KEY, JSON.stringify(invoice));
window.location.href = `/invoice-editor?id=${invoiceId}`;
} catch (error) {
showToast(error.message);
}
}

async function deleteInvoice(event) {
const invoiceId = event.target.dataset.delete;

try {
await apiDeleteInvoice(invoiceId);

showToast("Rechnung wurde gelöscht.");
renderInvoices();
} catch (error) {
showToast(error.message);
}
}

function getInvoiceStatusLabel(status) {
const labels = {
open: "Offen",
paid: "Bezahlt",
overdue: "Überfällig"
};

return labels[status] || "Offen";
}

async function updateInvoiceStatus(event) {
const invoiceId = event.target.dataset.status;
const status = event.target.value;

try {
const invoices = await apiGetInvoices();
const invoice = invoices.find((entry) => entry.id === invoiceId);

if (!invoice) {
showToast("Rechnung wurde nicht gefunden.");
return;
}

invoice.status = status;

await apiSaveInvoice(invoice);

showToast("Status wurde aktualisiert.");
renderInvoices();
} catch (error) {
showToast(error.message);
}
}

function bindActions() {
document.querySelectorAll("[data-open]").forEach((button) => {
button.addEventListener("click", openInvoice);
});

document.querySelectorAll("[data-delete]").forEach((button) => {
button.addEventListener("click", deleteInvoice);
});

document.querySelectorAll("[data-send]").forEach((button) => {
button.addEventListener("click", () => {
openInvoiceMailModal(button.dataset.send);
});
});

document.querySelectorAll("[data-status]").forEach((select) => {
select.addEventListener("change", updateInvoiceStatus);
});

document.querySelectorAll("[data-assign]").forEach((button) => {
button.addEventListener("click", () => {
openContactAssignModal(button.dataset.assign);
});
});

document.querySelectorAll("[data-unassign]").forEach((button) => {
  button.addEventListener("click", async (event) => {
    event.stopPropagation();

    const invoiceId = button.dataset.unassign;

    try {
      const invoices = await apiGetInvoices();
      const invoice = invoices.find((entry) => entry.id === invoiceId);

      if (!invoice) {
        showToast("Rechnung wurde nicht gefunden.");
        return;
      }

      invoice.contactId = null;

      await apiSaveInvoice(invoice);

      showToast("Kontaktzuordnung entfernt.");
      await renderInvoices();

    } catch (error) {
      showToast(error.message);
    }
  });
});
}

document.addEventListener("DOMContentLoaded", async () => {
try {
contactsCache = await apiGetContacts();
await renderInvoices();
} catch (error) {
showToast(error.message);
}
});

closeInvoiceMailModal.addEventListener("click", () => {
invoiceMailModal.classList.add("hidden");
});

const closeContactAssignModal = document.getElementById("closeContactAssignModal");
const contactSearchInput = document.getElementById("contactSearchInput");

if (closeContactAssignModal) {
closeContactAssignModal.addEventListener("click", () => {
document
.getElementById("contactAssignModal")
.classList.add("hidden");

activeInvoiceForAssign = null;
});
}

if (contactSearchInput) {
contactSearchInput.addEventListener("input", () => {
renderContactSearchResults(contactSearchInput.value);
});
}

sendInvoiceMailBtn.addEventListener("click", async () => {
if (!activeInvoiceForMail) {
showToast("Keine Rechnung ausgewählt.");
return;
}

const to = invoiceMailRecipient.value.trim();
const subject = invoiceMailSubject.value.trim();
const message = invoiceMailMessage.value.trim();

if (!to || !subject || !message) {
showToast("Bitte Empfänger, Betreff und Nachricht ausfüllen.");
return;
}

sendInvoiceMailBtn.disabled = true;
sendInvoiceMailBtn.textContent = "Wird gesendet...";

try {
const response = await fetch("/api/send-invoice-email", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
invoiceId: activeInvoiceForMail.id,
to,
subject,
message
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Rechnung konnte nicht gesendet werden.");
}

showToast("Rechnung wurde per E-Mail gesendet.");
invoiceMailModal.classList.add("hidden");

} catch (error) {
showToast(error.message);
} finally {
sendInvoiceMailBtn.disabled = false;
sendInvoiceMailBtn.textContent = "E-Mail senden";
}
});

// WorkPilot Blue V2: client-side filtering and paging; original API handlers remain unchanged.
for(const id of ['wp-search','wp-filter-status','wp-filter-assigned','wp-filter-from','wp-filter-to']){
 const el=document.getElementById(id);if(el)el.addEventListener(id==='wp-search'?'input':'change',()=>{wpRechnungenState.page=1;renderInvoices();});
}
const wpExportButton=document.getElementById('wp-export');
if(wpExportButton)wpExportButton.addEventListener('click',()=>{showToast('Der vollständige Export wird im Rechnungs- und Angebotsmodul ergänzt.');});
