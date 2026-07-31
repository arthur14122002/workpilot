const CONTACTS_KEY = "workpilot_contacts";
const OFFERS_KEY = "workpilot_saved_offers";
const DRAFT_KEY = "workpilot_current_offer_draft";
const INVOICES_KEY = "workpilot_saved_invoices";
const NOTES_KEY = "workpilot_contact_notes";

const contactTitle = document.getElementById("contactTitle");
const contactSubtitle = document.getElementById("contactSubtitle");
const detailName = document.getElementById("detailName");
const detailAddress = document.getElementById("detailAddress");
const detailEmail = document.getElementById("detailEmail");
const detailPhone = document.getElementById("detailPhone");
const contactOffersList = document.getElementById("contactOffersList");
const emptyContactOffers = document.getElementById("emptyContactOffers");
const contactInvoicesList = document.getElementById("contactInvoicesList");
const emptyContactInvoices = document.getElementById("emptyContactInvoices");
const noteForm = document.getElementById("noteForm");
const noteType = document.getElementById("noteType");
const noteText = document.getElementById("noteText");
const notesList = document.getElementById("notesList");
const emptyNotes = document.getElementById("emptyNotes");
const contactEmailsList = document.getElementById("contactEmailsList");
const emptyContactEmails = document.getElementById("emptyContactEmails");

let notesCache = [];

async function apiGetNotes(contactId) {
const response = await fetch(`/api/notes/${contactId}`);
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Notizen konnten nicht geladen werden.");
}

return result.notes || [];
}

async function apiCreateNote(note) {
const response = await fetch("/api/notes", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(note)
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Notiz konnte nicht gespeichert werden.");
}

return result.note;
}

async function apiDeleteNote(noteId) {
const response = await fetch(`/api/notes/${noteId}`, {
method: "DELETE"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Notiz konnte nicht gelöscht werden.");
}
}

function generateId(prefix = "id") {
return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function saveJson(key, value) {
localStorage.setItem(key, JSON.stringify(value));
}

async function getNotesForContact(contactId) {
return await apiGetNotes(contactId);
}

function getNoteTypeLabel(type) {
const labels = {
note: "Notiz",
call: "Telefonnotiz",
email: "E-Mail",
ai: "KI-Zusammenfassung"
};

return labels[type] || "Notiz";
}

async function renderNotes(contactId) {
try {
notesCache = await apiGetNotes(contactId);
} catch (error) {
showToast(error.message);
return;
}

notesList.innerHTML = "";

if (!notesCache.length) {
emptyNotes.style.display = "block";
return;
}

emptyNotes.style.display = "none";

notesCache.forEach((note) => {
const item = document.createElement("div");
item.className = "noteItem";

item.innerHTML = `
<div class="noteTop">
<div class="noteType">${getNoteTypeLabel(note.type)}</div>

<div class="noteDate">
${new Date(note.created_at).toLocaleString("de-DE")}
</div>
</div>

<div class="noteText">
${note.text}
</div>

<div class="noteActions">
<button
class="noteEditBtn"
data-edit-note="${note.id}"
title="Notiz bearbeiten"
>
✏️
</button>

<button
class="noteDeleteBtn"
data-delete-note="${note.id}"
title="Notiz löschen"
>
🗑
</button>
</div>
`;

notesList.appendChild(item);
});
bindNoteActions(contactId);
}

function bindNoteActions(contactId) {
document.querySelectorAll("[data-delete-note]").forEach((button) => {
button.addEventListener("click", async () => {
const noteId = button.dataset.deleteNote;

try {
await apiDeleteNote(noteId);

showToast("Notiz wurde gelöscht.");

await renderNotes(contactId);
} catch (error) {
showToast(error.message);
}
});
});

document.querySelectorAll("[data-edit-note]").forEach((button) => {
button.addEventListener("click", () => {
showToast("Notiz bearbeiten kommt im nächsten Schritt.");
});
});
}

async function createNote(event) {
event.preventDefault();

const contactId = getContactIdFromUrl();
const text = noteText.value.trim();

if (!text) {
showToast("Bitte eine Notiz eingeben.");
return;
}

try {
await apiCreateNote({
contactId,
type: noteType.value,
text,
source: "manual"
});

noteText.value = "";
noteType.value = "note";

showToast("Notiz wurde gespeichert.");

renderNotes(contactId);
} catch (error) {
showToast(error.message);
}
}

function getSavedJson(key, fallback) {
try {
return JSON.parse(localStorage.getItem(key)) || fallback;
} catch {
return fallback;
}
}

function getContactIdFromUrl() {
const params = new URLSearchParams(window.location.search);
return params.get("id");
}

async function apiGetContact(contactId) {
const response = await fetch(`/api/contacts/${contactId}`);
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakt konnte nicht geladen werden.");
}

return result.contact;
}

async function apiGetEmails(contactId) {

const response = await fetch(`/api/email-inbox`);
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mails konnten nicht geladen werden.");
}

return (result.messages || []).filter(
(message) => message.contact_id === contactId
);
}

async function apiGetOffers(contactId) {
const response = await fetch("/api/offers");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Angebote konnten nicht geladen werden.");
}

return (result.offers || [])
.map((row) => ({
...row.data,
id: row.id,
contactId: row.contact_id,
status: row.status,
offerNumber: row.offer_number
}))
.filter((offer) => offer.contactId === contactId);
}

function renderContact(contact) {
contactTitle.textContent = contact.name || "Kontakt";
contactSubtitle.textContent = "Kontaktkarte mit Angeboten und später Rechnungen, Notizen und E-Mails.";

detailName.textContent = contact.name || "Kontakt";
detailAddress.textContent = `${contact.street || ""} ${contact.city ? "· " + contact.city : ""}`;
detailEmail.textContent = contact.email || "-";
detailPhone.textContent = contact.phone || "-";
}

async function renderOffers(contactId) {
let offers = [];

try {
offers = await apiGetOffers(contactId);
} catch (error) {
showToast(error.message);
return;
}

contactOffersList.innerHTML = "";

if (!offers.length) {
emptyContactOffers.style.display = "block";
return;
}

emptyContactOffers.style.display = "none";

offers.forEach((offer) => {
const item = document.createElement("div");
item.className = "offerItem";

item.innerHTML = `
<div class="offerInfo">
<div class="offerTitle">${offer.offerNumber || "Unbenanntes Angebot"}</div>
<div class="offerMeta">${offer.recipientName || "Kein Kunde"} · ${offer.offerDate || "-"}</div>
</div>

<div class="offerActions">
<button class="btn btnSecondary" data-open="${offer.id}">Öffnen</button>
</div>
`;

contactOffersList.appendChild(item);
});

bindOfferActions();
}

async function apiGetInvoices(contactId) {
const response = await fetch("/api/invoices");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Rechnungen konnten nicht geladen werden.");
}

return (result.invoices || [])
.map((row) => ({
...row.data,
id: row.id,
contactId: row.contact_id,
status: row.status,
invoiceNumber: row.invoice_number
}))
.filter((invoice) => invoice.contactId === contactId);
}

async function renderInvoices(contactId) {
let invoices = [];

try {
invoices = await apiGetInvoices(contactId);
} catch (error) {
showToast(error.message);
return;
}

contactInvoicesList.innerHTML = "";

if (!invoices.length) {
emptyContactInvoices.style.display = "block";
return;
}

emptyContactInvoices.style.display = "none";

invoices.forEach((invoice) => {
const item = document.createElement("div");
item.className = "offerItem";

item.innerHTML = `
<div class="offerInfo">
<div class="offerTitle">${invoice.invoiceNumber || "Unbenannte Rechnung"}</div>
<div class="offerMeta">${invoice.recipientName || "Kein Kunde"} · ${invoice.invoiceDate || "-"}</div>
</div>

<div class="offerActions">
<button class="btn btnSecondary" data-open-invoice="${invoice.id}">Öffnen</button>
</div>
`;

contactInvoicesList.appendChild(item);
});

bindInvoiceActions();
}

async function renderEmails(contactId) {
let emails = [];

try {
emails = await apiGetEmails(contactId);
} catch (error) {
showToast(error.message);
return;
}

contactEmailsList.innerHTML = "";

if (!emails.length) {
emptyContactEmails.style.display = "block";
return;
}

emptyContactEmails.style.display = "none";

emails
.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
.forEach((mail) => {
const item = document.createElement("div");

const isOutbound = mail.direction === "outbound";
const preview = (mail.body || "")
.replace(/<[^>]*>/g, "")
.replace(/\s+/g, " ")
.trim()
.slice(0, 120);

item.className = isOutbound
? "emailChatRow emailChatRowOutbound"
: "emailChatRow emailChatRowInbound";

item.innerHTML = `
<div class="emailChatCard">
<div class="emailChatTop">
<strong>${mail.subject || "Ohne Betreff"}</strong>
<span>${new Date(mail.created_at).toLocaleDateString("de-DE")}</span>
</div>

<div class="emailChatMeta">
${isOutbound ? `An: ${mail.recipient || "-"}` : `Von: ${mail.sender || "-"}`}
</div>

<div class="emailChatPreview">
${preview || "Keine Vorschau vorhanden."}
</div>

<button
class="emailChatOpenBtn"
data-open-email="${mail.id}"
title="E-Mail öffnen"
>
👁
</button>
</div>
`;

contactEmailsList.appendChild(item);
});

bindEmailActions();
}

function openInvoice(event) {
const invoiceId = event.target.dataset.openInvoice;

if (!invoiceId) {
showToast("Rechnung konnte nicht geöffnet werden.");
return;
}

window.location.href = `/invoice-editor?id=${invoiceId}`;
}

function bindInvoiceActions() {
document.querySelectorAll("[data-open-invoice]").forEach((button) => {
button.addEventListener("click", openInvoice);
});
}

function openEmail(event) {
const messageId = event.currentTarget.dataset.openEmail;

window.location.href = `/emails?message=${messageId}`;
}

function bindEmailActions() {

document.querySelectorAll("[data-open-email]").forEach((button) => {

button.addEventListener("click", openEmail);
});
}

function openOffer(event) {
const offerId = event.target.dataset.open;

if (!offerId) {
showToast("Angebot konnte nicht geöffnet werden.");
return;
}

window.location.href = `/offer-editor?id=${offerId}`;
}

function bindOfferActions() {
document.querySelectorAll("[data-open]").forEach((button) => {
button.addEventListener("click", openOffer);
});
}

async function init() {
const contactId = getContactIdFromUrl();

if (!contactId) {
showToast("Kontakt wurde nicht gefunden.");
window.location.href = "/";
return;
}

try {
const contact = await apiGetContact(contactId);

const offerBtn = document.getElementById("createOfferFromContactBtn");

if (offerBtn) {
offerBtn.href = `/offer-create?contactId=${contactId}`;
}

const invoiceBtn = document.getElementById("createInvoiceFromContactBtn");

if (invoiceBtn) {
invoiceBtn.href = `/invoice-create?contactId=${contactId}`;
}

renderContact(contact);

const editContactBtn = document.getElementById("editContactBtn");

if (editContactBtn) {
editContactBtn.href = `/contact-create?id=${contactId}`;
}

const createNoteBtn = document.getElementById("createNoteBtn");

if (createNoteBtn) {
createNoteBtn.href = `/note-create?contactId=${contactId}`;
}

await renderOffers(contactId);
await renderInvoices(contactId);
renderEmails (contactId);
renderNotes(contactId);

if (noteForm) {
noteForm.addEventListener("submit", createNote);
}

initCollapsibleCards();

} catch (error) {
showToast(error.message);
window.location.href = "/";
}
}

function initCollapsibleCards() {
document.querySelectorAll("[data-collapsible-card]").forEach((card) => {
card.classList.add("isCollapsed");
const trigger = card.querySelector("[data-collapsible-trigger]");
const toggleBtn = card.querySelector(".collapseToggleBtn");

if (!trigger || !toggleBtn) return;

trigger.addEventListener("click", (event) => {
if (event.target.closest("a")) {
return;
}

card.classList.toggle("isCollapsed");
});

toggleBtn.addEventListener("click", (event) => {
event.stopPropagation();
card.classList.toggle("isCollapsed");
});
});
}

document.addEventListener("DOMContentLoaded", init);
