const OFFERS_KEY = "workpilot_saved_offers";
const CONTACTS_KEY = "workpilot_contacts";
const DRAFT_KEY = "workpilot_current_offer_draft";

const offersList = document.getElementById("offersList");
const emptyOffers = document.getElementById("emptyOffers");

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

function getSavedOffers() {
return getSavedJson(OFFERS_KEY, []);
}

function getContacts() {
return getSavedJson(CONTACTS_KEY, []);
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

function renderOffers() {
const offers = getSavedOffers();

offersList.innerHTML = "";

if (!offers.length) {
emptyOffers.style.display = "block";
return;
}

emptyOffers.style.display = "none";

offers
.sort((a, b) => {
return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
})
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

<div class="offerBadge">
${contactLabel}
</div>

<div class="statusBadge">
${getOfferStatusLabel(offer.status)}
</div>

</div>

<div class="offerActions">

<select class="statusSelect" data-status="${offer.id}">
<option value="open" ${offer.status === "open" || !offer.status ? "selected" : ""}>Offen</option>
<option value="accepted" ${offer.status === "accepted" ? "selected" : ""}>Angenommen</option>
<option value="rejected" ${offer.status === "rejected" ? "selected" : ""}>Abgelehnt</option>
</select>

<select
class="contactSelect"
data-assign="${offer.id}"
>
${renderContactOptions(offer.contactId)}
</select>

<button
class="btn btnSecondary"
data-open="${offer.id}"
>
Öffnen
</button>

<button
class="btn btnSecondary"
data-delete="${offer.id}"
>
Löschen
</button>
</div>
`;

offersList.appendChild(item);
});

bindActions();
}

function assignContact(event) {
const offerId = event.target.dataset.assign;
const contactId = event.target.value || null;

const offers = getSavedOffers();

const updated = offers.map((offer) => {
if (offer.id !== offerId) return offer;

return {
...offer,
contactId
};
});

saveJson(OFFERS_KEY, updated);

showToast(
contactId
? "Kontakt wurde zugeordnet."
: "Kontaktzuordnung entfernt."
);

renderOffers();
}

function openOffer(event) {
const offerId = event.target.dataset.open;

const offers = getSavedOffers();

const offer = offers.find(
(entry) => entry.id === offerId
);

if (!offer) {
showToast("Angebot konnte nicht geöffnet werden.");
return;
}

localStorage.setItem(
DRAFT_KEY,
JSON.stringify(offer)
);

window.location.href = "/offer-editor";
}

function deleteOffer(event) {
const offerId = event.target.dataset.delete;

const offers = getSavedOffers();

const filtered = offers.filter(
(offer) => offer.id !== offerId
);

saveJson(OFFERS_KEY, filtered);

showToast("Angebot wurde gelöscht.");

renderOffers();
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

document.querySelectorAll("[data-assign]").forEach((select) => {
select.addEventListener("change", assignContact);
});
}

document.addEventListener("DOMContentLoaded", renderOffers);

function getOfferStatusLabel(status) {
const labels = {
open: "Offen",
accepted: "Angenommen",
rejected: "Abgelehnt"
};

return labels[status] || "Offen";
}

function updateOfferStatus(event) {
const offerId = event.target.dataset.status;
const status = event.target.value;

const updated = getSavedOffers().map((offer) => {
if (offer.id !== offerId) return offer;

return {
...offer,
status
};
});

saveJson(OFFERS_KEY, updated);
showToast("Status wurde aktualisiert.");
renderOffers();
}