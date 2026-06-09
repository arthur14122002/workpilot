const DRAFT_KEY = "workpilot_current_offer_draft";
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

function createRequestPoint(value = "") {
const wrapper = document.createElement("div");
wrapper.className = "requestPoint";

wrapper.innerHTML = `
<textarea
class="requestPointInput"
placeholder="z. B. Wohnzimmer streichen, weiß, ca. 60qm"
>${value}</textarea>

<button
type="button"
class="btn btnSecondary requestPointRemove"
>
–
</button>
`;

const removeBtn = wrapper.querySelector(".requestPointRemove");

removeBtn.addEventListener("click", () => {
if (requestPoints.children.length === 1) {
return;
}

wrapper.remove();
});

requestPoints.appendChild(wrapper);
}

function collectRequestPoints() {
const fields = document.querySelectorAll(".requestPointInput");

return Array.from(fields)
.map((field) => field.value.trim())
.filter(Boolean);
}

function buildPositionsFromPoints(points, trade) {
const tradeLabels = {
maler: "Malerarbeiten",
elektro: "Elektroarbeiten",
sanitaer: "Sanitär-/Heizungsarbeiten",
abriss: "Abrissarbeiten",
kfz: "KFZ-Arbeiten",
allgemein: "Arbeiten"
};

return points.map((point, index) => ({
pos: index + 1,
description: `${tradeLabels[trade] || tradeLabels.allgemein}: ${point}`,
quantity: "",
unit: "",
unitPrice: "",
total: ""
}));
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

const today = new Date();
const validDays = document.getElementById("validDays").value;
const offerId = crypto.randomUUID();

const draft = {
id: offerId,
createdAt: new Date().toISOString(),
contactId: getContactIdFromUrl(),
status: "open",

trade: document.getElementById("trade").value,
recipientName: document.getElementById("recipientName").value.trim(),
recipientStreet: document.getElementById("recipientStreet").value.trim(),
recipientCity: document.getElementById("recipientCity").value.trim(),
recipientEmail: document.getElementById("recipientEmail").value.trim(),
requestPoints: collectRequestPoints(),
offerNumber: createOfferNumber(),
offerDate: formatDate(today),
validUntil: formatDate(addDays(today, validDays)),
introText: "vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:",
closingText: "Ich freue mich auf Ihre Rückmeldung und stehe für Rückfragen jederzeit zur Verfügung.",
positions: buildPositionsFromPoints(
collectRequestPoints(),
document.getElementById("trade").value
)
};

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

createRequestPoint();

addRequestPointBtn.addEventListener("click", () => {
createRequestPoint();
});

document.addEventListener("DOMContentLoaded", preloadContact);
