const OFFERS_KEY = "workpilot_saved_offers";
const CONTACTS_KEY = "workpilot_contacts";
const DRAFT_KEY = "workpilot_current_offer_draft";

const offersList = document.getElementById("offersList");
const emptyOffers = document.getElementById("emptyOffers");

const offerMailModal =
document.getElementById("offerMailModal");

const closeOfferMailModal =
document.getElementById("closeOfferMailModal");

const offerMailRecipient =
document.getElementById("offerMailRecipient");

const offerMailSubject =
document.getElementById("offerMailSubject");

const offerMailMessage =
document.getElementById("offerMailMessage");

const sendOfferMailBtn =
document.getElementById("sendOfferMailBtn");

let activeOfferForMail = null;

let activeOfferForAssign = null;

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

async function openOfferMailModal(offerId) {
const offers = await apiGetOffers();

const offer = offers.find(
(entry) => entry.id === offerId
);

if (!offer) {
showToast("Angebot wurde nicht gefunden.");
return;
}

activeOfferForMail = offer;

offerMailRecipient.value =
offer.recipientEmail || "";

offerMailSubject.value =
`Angebot ${offer.offerNumber || ""}`;

offerMailMessage.value =
`Hallo ${offer.recipientName || ""},

anbei erhalten Sie unser Angebot.

Bei Fragen können Sie sich jederzeit gerne melden.

Mit freundlichen Grüßen
${offer.companyName || "WorkPilot"}
`;

offerMailModal.classList.remove("hidden");
}

closeOfferMailModal.addEventListener("click", () => {
offerMailModal.classList.add("hidden");
});

const closeContactAssignModal = document.getElementById("closeContactAssignModal");
const contactSearchInput = document.getElementById("contactSearchInput");

if (closeContactAssignModal) {
closeContactAssignModal.addEventListener("click", () => {
document
.getElementById("contactAssignModal")
.classList.add("hidden");

activeOfferForAssign = null;
});
}

if (contactSearchInput) {
contactSearchInput.addEventListener("input", () => {
renderContactSearchResults(contactSearchInput.value);
});
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

async function getSavedOffers() {
return await apiGetOffers();
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
const contacts = getContacts();

const contact = contacts.find(
(entry) => entry.id === contactId
);

return contact ? contact.name : null;
}

function renderContactOptions(selectedId) {
const contacts = getContacts();

return `
<option value="">Nicht zugeordnet</option>

${contacts
.map((contact) => {
return `
<option
value="${contact.id}"
${selectedId === contact.id ? "selected" : ""}
>
${contact.name}
</option>
`;
})
.join("")}
`;
}

async function renderOffers() {
let offers = [];

try {
offers = await apiGetOffers();
} catch (error) {
showToast(error.message);
}

offersList.innerHTML = "";

if (!offers.length) {
emptyOffers.style.display = "block";
return;
}

emptyOffers.style.display = "none";

offers
.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
.forEach((offer) => {
const item = document.createElement("div");
item.className = "offerItem";

const contactLabel =
getContactName(offer.contactId) ||
"Nicht zugeordnet";

item.innerHTML = `
<div class="offerInfo">
<div class="offerListTitle">
${offer.offerNumber || "Unbenanntes Angebot"}
</div>

<div class="offerMeta">
${offer.recipientName || "Kein Kunde"}
</div>

<div class="offerMeta">
Erstellt am ${offer.offerDate || "-"}
</div>

</div>

<div class="offerActions">
<select class="statusSelect" data-status="${offer.id}">
<option value="open" ${offer.status === "open" || !offer.status ? "selected" : ""}>Offen</option>
<option value="accepted" ${offer.status === "accepted" ? "selected" : ""}>Angenommen</option>
<option value="rejected" ${offer.status === "rejected" ? "selected" : ""}>Abgelehnt</option>
</select>

<button
class="contactAssignBtn"
data-assign="${offer.id}"
>
${contactLabel}
</button>

<button class="btn btnSecondary" data-open="${offer.id}">Öffnen</button>
<button
class="btn btnPrimary sendOfferMailBtn"
data-offer-id="${offer.id}"
>
Senden
</button>
<button class="btn btnSecondary" data-delete="${offer.id}">Löschen</button>
</div>
`;

offersList.appendChild(item);
});

bindActions();
}

function openContactAssignModal(offerId) {
activeOfferForAssign = offerId;

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
if (!activeOfferForAssign) return;

try {
const offers = await apiGetOffers();
const offer = offers.find((entry) => entry.id === activeOfferForAssign);

if (!offer) {
showToast("Angebot wurde nicht gefunden.");
return;
}

offer.contactId = contactId;

await apiSaveOffer(offer);

showToast("Kontakt wurde zugeordnet.");

document
.getElementById("contactAssignModal")
.classList.add("hidden");

activeOfferForAssign = null;

renderOffers();
} catch (error) {
showToast(error.message);
}
}

async function assignContact(event) {
const offerId = event.target.dataset.assign;
const contactId = event.target.value || null;

try {
const offers = await apiGetOffers();
const offer = offers.find((entry) => entry.id === offerId);

if (!offer) {
showToast("Angebot wurde nicht gefunden.");
return;
}

offer.contactId = contactId;

await apiSaveOffer(offer);

showToast(contactId ? "Kontakt wurde zugeordnet." : "Kontaktzuordnung entfernt.");
renderOffers();
} catch (error) {
showToast(error.message);
}
}

async function openOffer(event) {
const offerId = event.target.dataset.open;

try {
const offers = await apiGetOffers();
const offer = offers.find((entry) => entry.id === offerId);

if (!offer) {
showToast("Angebot konnte nicht geöffnet werden.");
return;
}

localStorage.setItem(DRAFT_KEY, JSON.stringify(offer));
window.location.href = "/offer-editor";
} catch (error) {
showToast(error.message);
}
}

async function deleteOffer(event) {
const offerId = event.target.dataset.delete;

try {
await apiDeleteOffer(offerId);

showToast("Angebot wurde gelöscht.");
renderOffers();
} catch (error) {
showToast(error.message);
}
}

function bindActions() {
document.querySelectorAll("[data-open]").forEach((button) => {
button.addEventListener("click", openOffer);
});

document.querySelectorAll("[data-delete]").forEach((button) => {
button.addEventListener("click", deleteOffer);
});

document.querySelectorAll("[data-status]").forEach((select) => {
select.addEventListener("change", updateOfferStatus);
});

document.querySelectorAll("[data-assign]").forEach((button) => {
button.addEventListener("click", () => {
openContactAssignModal(button.dataset.assign);
});
});

document.querySelectorAll(".sendOfferMailBtn").forEach((button) => {
button.addEventListener("click", () => {
const offerId = button.dataset.offerId;

openOfferMailModal(offerId);
});
});
}

document.addEventListener("DOMContentLoaded", async () => {
try {
contactsCache = await apiGetContacts();
await renderOffers();
} catch (error) {
showToast(error.message);
}
});

async function apiGetOffers() {
const response = await fetch("/api/offers");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Angebote konnten nicht geladen werden.");
}

return (result.offers || []).map((row) => ({
...row.data,
id: row.id,
contactId: row.contact_id,
status: row.status,
offerNumber: row.offer_number
}));
}

async function apiSaveOffer(offer) {
const response = await fetch(`/api/offers/${offer.id}`, {
method: "PUT",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(offer)
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Angebot konnte nicht gespeichert werden.");
}
}

async function apiDeleteOffer(offerId) {
const response = await fetch(`/api/offers/${offerId}`, {
method: "DELETE"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Angebot konnte nicht gelöscht werden.");
}
}

function getOfferStatusLabel(status) {
const labels = {
open: "Offen",
accepted: "Angenommen",
rejected: "Abgelehnt"
};

return labels[status] || "Offen";
}

async function updateOfferStatus(event) {
const offerId = event.target.dataset.status;
const status = event.target.value;

try {
const offers = await apiGetOffers();
const offer = offers.find((entry) => entry.id === offerId);

if (!offer) {
showToast("Angebot wurde nicht gefunden.");
return;
}

offer.status = status;

await apiSaveOffer(offer);

showToast("Status wurde aktualisiert.");
renderOffers();
} catch (error) {
showToast(error.message);
}
}

sendOfferMailBtn.addEventListener("click", async () => {
if (!activeOfferForMail) {
showToast("Kein Angebot ausgewählt.");
return;
}

const to = offerMailRecipient.value.trim();
const subject = offerMailSubject.value.trim();
const message = offerMailMessage.value.trim();

if (!to || !subject || !message) {
showToast("Bitte Empfänger, Betreff und Nachricht ausfüllen.");
return;
}

sendOfferMailBtn.disabled = true;
sendOfferMailBtn.textContent = "Wird gesendet...";

try {
const response = await fetch("/api/send-offer-email", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
offerId: activeOfferForMail.id,
to,
subject,
message
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(
result.error || "Angebot konnte nicht gesendet werden."
);
}

showToast("Angebot wurde per E-Mail gesendet.");

offerMailModal.classList.add("hidden");

} catch (error) {
showToast(error.message);
} finally {
sendOfferMailBtn.disabled = false;
sendOfferMailBtn.textContent = "E-Mail senden";
}
});
