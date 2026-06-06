const CONTACTS_KEY = "workpilot_contacts";
const OFFERS_KEY = "workpilot_saved_offers";
const INVOICES_KEY = "workpilot_saved_invoices";

const contactsList = document.getElementById("contactsList");
const emptyContacts = document.getElementById("emptyContacts");
const letterNav = document.getElementById("letterNav");

let activeLetter = "ALLE";
let contactsCache = [];

async function apiGetContacts() {
const response = await fetch("/api/contacts");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakte konnten nicht geladen werden.");
}

return result.contacts || [];
}

async function apiCreateContact(contact) {
const response = await fetch("/api/contacts", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(contact)
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakt konnte nicht gespeichert werden.");
}

return result.contact;
}

async function apiDeleteContact(contactId) {
const response = await fetch(`/api/contacts/${contactId}`, {
method: "DELETE"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakt konnte nicht gelöscht werden.");
}
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
const contacts = contactsCache.sort((a, b) => {
return (a.name || "").localeCompare(b.name || "", "de");
});

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

async function deleteContact(event) {
const contactId = event.target.dataset.delete;

try {
await apiDeleteContact(contactId);

showToast("Kontakt wurde gelöscht.");

contactsCache = await apiGetContacts();
renderContacts();
renderKpis();
} catch (error) {
showToast(error.message);
}
}

function bindContactActions() {
document.querySelectorAll("[data-open]").forEach((button) => {
button.addEventListener("click", openContact);
});

document.querySelectorAll("[data-delete]").forEach((button) => {
button.addEventListener("click", deleteContact);
});
}

document.addEventListener("DOMContentLoaded", async () => {
try {
contactsCache = await apiGetContacts();
renderContacts();
} catch (error) {
showToast(error.message);
renderContacts();
}
});

