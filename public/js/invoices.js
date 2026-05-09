const INVOICES_KEY = "workpilot_saved_invoices";
const CONTACTS_KEY = "workpilot_contacts";
const DRAFT_KEY = "workpilot_current_invoice_draft";

const invoicesList = document.getElementById("invoicesList");
const emptyInvoices = document.getElementById("emptyInvoices");

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

function getContacts() {
return getSavedJson(CONTACTS_KEY, []);
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

function renderInvoices() {
const invoices = getInvoices();

invoicesList.innerHTML = "";

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
<div class="invoiceBadge">${contactLabel}</div>
<div class="statusBadge">
${getInvoiceStatusLabel(invoice.status)}
</div>
</div>

<div class="invoiceActions">

<select class="statusSelect" data-status="${invoice.id}">
<option value="open" ${invoice.status === "open" || !invoice.status ? "selected" : ""}>Offen</option>
<option value="paid" ${invoice.status === "paid" ? "selected" : ""}>Bezahlt</option>
<option value="overdue" ${invoice.status === "overdue" ? "selected" : ""}>Überfällig</option>
</select>

<select class="contactSelect" data-assign="${invoice.id}">
${renderContactOptions(invoice.contactId)}
</select>

<button class="btn btnSecondary" data-open="${invoice.id}">Öffnen</button>
<button class="btn btnSecondary" data-delete="${invoice.id}">Löschen</button>
</div>
`;

invoicesList.appendChild(item);
});

bindActions();
}

function assignContact(event) {
const invoiceId = event.target.dataset.assign;
const contactId = event.target.value || null;

const updated = getInvoices().map((invoice) => {
if (invoice.id !== invoiceId) return invoice;
return { ...invoice, contactId };
});

saveJson(INVOICES_KEY, updated);
showToast(contactId ? "Kontakt wurde zugeordnet." : "Kontaktzuordnung entfernt.");
renderInvoices();
}

function openInvoice(event) {
const invoiceId = event.target.dataset.open;
const invoice = getInvoices().find((entry) => entry.id === invoiceId);

if (!invoice) {
showToast("Rechnung konnte nicht geöffnet werden.");
return;
}

localStorage.setItem(DRAFT_KEY, JSON.stringify(invoice));
window.location.href = "/invoice-editor";
}

function deleteInvoice(event) {
const invoiceId = event.target.dataset.delete;
const filtered = getInvoices().filter((invoice) => invoice.id !== invoiceId);

saveJson(INVOICES_KEY, filtered);
showToast("Rechnung wurde gelöscht.");
renderInvoices();
}

function getInvoiceStatusLabel(status) {
const labels = {
open: "Offen",
paid: "Bezahlt",
overdue: "Überfällig"
};

return labels[status] || "Offen";
}

function updateInvoiceStatus(event) {
const invoiceId = event.target.dataset.status;
const status = event.target.value;

const updated = getInvoices().map((invoice) => {
if (invoice.id !== invoiceId) return invoice;

return {
...invoice,
status
};
});

saveJson(INVOICES_KEY, updated);
showToast("Status wurde aktualisiert.");
renderInvoices();
}

function bindActions() {
document.querySelectorAll("[data-open]").forEach((button) => {
button.addEventListener("click", openInvoice);
});

document.querySelectorAll("[data-delete]").forEach((button) => {
button.addEventListener("click", deleteInvoice);
});

document.querySelectorAll("[data-status]").forEach((select) => {
select.addEventListener("change", updateInvoiceStatus);
});

document.querySelectorAll("[data-assign]").forEach((select) => {
select.addEventListener("change", assignContact);
});
}

document.addEventListener("DOMContentLoaded", renderInvoices);
