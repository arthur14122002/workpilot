const CONTACTS_KEY = "workpilot_contacts";
const OFFERS_KEY = "workpilot_saved_offers";
const INVOICES_KEY = "workpilot_saved_invoices";

const contactForm = document.getElementById("contactForm");
const contactsList = document.getElementById("contactsList");
const emptyContacts = document.getElementById("emptyContacts");
const letterNav = document.getElementById("letterNav");
const toggleContactFormBtn = document.getElementById("toggleContactFormBtn");
const cancelContactBtn = document.getElementById("cancelContactBtn");

let activeLetter = "ALLE";

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

function euro(value) {
return (Number(value) || 0).toLocaleString("de-DE", {
style: "currency",
currency: "EUR"
});
}

function calculateInvoiceGross(invoice) {
const net = (invoice.positions || []).reduce((sum, position) => {
return sum + parseMoney(position.total);
}, 0);

const vatRate = 19;
const vat = net * (vatRate / 100);

return net + vat;
}

function renderKpis() {
const contacts = getSavedJson(CONTACTS_KEY, []);
const offers = getSavedJson(OFFERS_KEY, []);
const invoices = getSavedJson(INVOICES_KEY, []);

const openOffers = offers.filter(
(offer) => offer.status === "open" || !offer.status
);

const openInvoices = invoices.filter(
(invoice) => invoice.status === "open" || !invoice.status
);

const openRevenue = openInvoices.reduce((sum, invoice) => {
return sum + calculateInvoiceGross(invoice);
}, 0);

document.getElementById("contactsKpi").textContent =
contacts.length;

document.getElementById("openOffersKpi").textContent =
openOffers.length;

document.getElementById("openInvoicesKpi").textContent =
openInvoices.length;

document.getElementById("openRevenueKpi").textContent =
euro(openRevenue);
}

function generateId(prefix = "id") {
return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getSavedJson(key, fallback) {
try {
return JSON.parse(localStorage.getItem(key)) || fallback;
} catch {
return fallback;
}
}

function saveJson(key, value) {
localStorage.setItem(key, JSON.stringify(value));
}

function getContactFormData() {
return {
id: generateId("contact"),
name: document.getElementById("contactName").value.trim(),
email: document.getElementById("contactEmail").value.trim(),
phone: document.getElementById("contactPhone").value.trim(),
street: document.getElementById("contactStreet").value.trim(),
city: document.getElementById("contactCity").value.trim(),
createdAt: new Date().toISOString()
};
}

function getContactLetter(contact) {
const firstChar = (contact.name || "#").trim().charAt(0).toUpperCase();

if (firstChar >= "A" && firstChar <= "Z") return firstChar;

return "#";
}

function getSortedContacts() {
const contacts = getSavedJson(CONTACTS_KEY, []);

return contacts.sort((a, b) => {
return (a.name || "").localeCompare(b.name || "", "de");
});
}

function getAvailableLetters(contacts) {
const letters = new Set();

contacts.forEach((contact) => {
letters.add(getContactLetter(contact));
});

return letters;
}

function renderLetterNav(contacts) {
const availableLetters = getAvailableLetters(contacts);
const letters = ["ALLE", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];

letterNav.innerHTML = "";

letters.forEach((letter) => {
const button = document.createElement("button");
button.type = "button";
button.className = "letterBtn";
button.textContent = letter === "ALLE" ? "Alle" : letter;

const hasContacts = letter === "ALLE" || availableLetters.has(letter);

if (!hasContacts) {
button.classList.add("disabled");
}

if (activeLetter === letter) {
button.classList.add("active");
}

button.addEventListener("click", () => {
if (!hasContacts) return;

activeLetter = letter;
renderContacts();
});

letterNav.appendChild(button);
});
}

function renderContacts() {
const contacts = getSortedContacts();

contactsList.innerHTML = "";
renderLetterNav(contacts);

if (!contacts.length) {
emptyContacts.style.display = "block";
return;
}

emptyContacts.style.display = "none";

const visibleContacts =
activeLetter === "ALLE"
? contacts
: contacts.filter((contact) => getContactLetter(contact) === activeLetter);

if (!visibleContacts.length) {
contactsList.innerHTML = `
<div class="emptyState">
<p>Keine Kontakte unter diesem Buchstaben.</p>
</div>
`;
return;
}

if (activeLetter !== "ALLE") {
const title = document.createElement("div");
title.className = "contactSectionTitle";
title.textContent = `Kontakte unter ${activeLetter}`;
contactsList.appendChild(title);
}

visibleContacts.forEach((contact) => {
const item = document.createElement("div");
item.className = "contactItem";

item.innerHTML = `
<div class="contactInfo">
<div class="contactName">${contact.name || "Unbekannter Kontakt"}</div>
<div class="contactMeta">
${contact.email || "Keine E-Mail"} · ${contact.phone || "Keine Telefonnummer"}
</div>
<div class="contactMeta">
${contact.street || ""} ${contact.city ? "· " + contact.city : ""}
</div>
</div>

<div class="contactActions">
<button class="btn btnSecondary" data-open="${contact.id}">Öffnen</button>
<button class="btn btnSecondary" data-delete="${contact.id}">Löschen</button>
</div>
`;

contactsList.appendChild(item);
});

bindContactActions();
}

function openContact(event) {
const contactId = event.target.dataset.open;
window.location.href = `/contact-detail?id=${contactId}`;
}

function createContact(event) {
event.preventDefault();

const contact = getContactFormData();

if (!contact.name) {
showToast("Bitte einen Namen eingeben.");
return;
}

const contacts = getSavedJson(CONTACTS_KEY, []);
contacts.push(contact);

saveJson(CONTACTS_KEY, contacts);
contactForm.reset();
contactForm.classList.add("hidden");

activeLetter = getContactLetter(contact);

showToast("Kontakt wurde gespeichert.");
renderContacts();
}

function deleteContact(event) {
const contactId = event.target.dataset.delete;
const contacts = getSavedJson(CONTACTS_KEY, []);

const filtered = contacts.filter((contact) => contact.id !== contactId);

saveJson(CONTACTS_KEY, filtered);
showToast("Kontakt wurde gelöscht.");
renderContacts();
}

function bindContactActions() {
document.querySelectorAll("[data-open]").forEach((button) => {
button.addEventListener("click", openContact);
});

document.querySelectorAll("[data-delete]").forEach((button) => {
button.addEventListener("click", deleteContact);
});
}

toggleContactFormBtn.addEventListener("click", () => {
contactForm.classList.toggle("hidden");
});

cancelContactBtn.addEventListener("click", () => {
contactForm.reset();
contactForm.classList.add("hidden");
});

contactForm.addEventListener("submit", createContact);

document.addEventListener("DOMContentLoaded", () => {
renderContacts();
renderKpis();
});
