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

function generateId(prefix = "id") {
return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function saveJson(key, value) {
localStorage.setItem(key, JSON.stringify(value));
}

function getNotesForContact(contactId) {
const notes = getSavedJson(NOTES_KEY, []);
return notes.filter((note) => note.contactId === contactId);
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

function renderNotes(contactId) {
const notes = getNotesForContact(contactId).sort((a, b) => {
return new Date(b.createdAt) - new Date(a.createdAt);
});

notesList.innerHTML = "";

if (!notes.length) {
emptyNotes.style.display = "block";
return;
}

emptyNotes.style.display = "none";

notes.forEach((note) => {
const item = document.createElement("div");
item.className = "noteItem";

item.innerHTML = `
<div class="noteTop">
<div class="noteType">${getNoteTypeLabel(note.type)}</div>
<div class="noteDate">${new Date(note.createdAt).toLocaleString("de-DE")}</div>
</div>

<div class="noteText">${note.text}</div>
`;

notesList.appendChild(item);
});
}

function createNote(event) {
event.preventDefault();

const contactId = getContactIdFromUrl();
const text = noteText.value.trim();

if (!text) {
showToast("Bitte eine Notiz eingeben.");
return;
}

const notes = getSavedJson(NOTES_KEY, []);

notes.push({
id: generateId("note"),
contactId,
type: noteType.value,
text,
source: "manual",
createdAt: new Date().toISOString()
});

saveJson(NOTES_KEY, notes);

noteText.value = "";
noteType.value = "note";

showToast("Notiz wurde gespeichert.");
renderNotes(contactId);
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

function findContact(contactId) {
const contacts = getSavedJson(CONTACTS_KEY, []);
return contacts.find((contact) => contact.id === contactId);
}

function getOffersForContact(contactId) {
const offers = getSavedJson(OFFERS_KEY, []);
return offers.filter((offer) => offer.contactId === contactId);
}

function renderContact(contact) {
contactTitle.textContent = contact.name || "Kontakt";
contactSubtitle.textContent = "Kontaktkarte mit Angeboten und später Rechnungen, Notizen und E-Mails.";

detailName.textContent = contact.name || "Kontakt";
detailAddress.textContent = `${contact.street || ""} ${contact.city ? "· " + contact.city : ""}`;
detailEmail.textContent = contact.email || "-";
detailPhone.textContent = contact.phone || "-";
}

function renderOffers(contactId) {
const offers = getOffersForContact(contactId);

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

function getInvoicesForContact(contactId) {
const invoices = getSavedJson(INVOICES_KEY, []);
return invoices.filter((invoice) => invoice.contactId === contactId);
}

function renderInvoices(contactId) {
const invoices = getInvoicesForContact(contactId);

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

function openInvoice(event) {
const invoiceId = event.target.dataset.openInvoice;
const invoices = getSavedJson(INVOICES_KEY, []);
const invoice = invoices.find((entry) => entry.id === invoiceId);

if (!invoice) {
showToast("Rechnung konnte nicht geöffnet werden.");
return;
}

localStorage.setItem("workpilot_current_invoice_draft", JSON.stringify(invoice));
window.location.href = "/invoice-editor";
}

function bindInvoiceActions() {
document.querySelectorAll("[data-open-invoice]").forEach((button) => {
button.addEventListener("click", openInvoice);
});
}

function openOffer(event) {
const offerId = event.target.dataset.open;
const offers = getSavedJson(OFFERS_KEY, []);
const offer = offers.find((entry) => entry.id === offerId);

if (!offer) {
showToast("Angebot konnte nicht geöffnet werden.");
return;
}

localStorage.setItem(DRAFT_KEY, JSON.stringify(offer));
window.location.href = "/offer-editor";
}

function bindOfferActions() {
document.querySelectorAll("[data-open]").forEach((button) => {
button.addEventListener("click", openOffer);
});
}

function init() {
const contactId = getContactIdFromUrl();
const contact = findContact(contactId);

if (!contact) {
showToast("Kontakt wurde nicht gefunden.");
window.location.href = "/";
return;
}

renderContact(contact);
renderOffers(contactId);
renderInvoices(contactId);
renderNotes(contactId);

noteForm.addEventListener("submit", createNote);
}

document.addEventListener("DOMContentLoaded", init);