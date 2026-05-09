const INVOICE_DRAFT_KEY = "workpilot_current_invoice_draft";

const invoiceCreateForm = document.getElementById("invoiceCreateForm");
const invoicePoints = document.getElementById("invoicePoints");
const addInvoicePointBtn = document.getElementById("addInvoicePointBtn");

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

function createInvoiceNumber() {
const now = new Date();
const year = now.getFullYear();
const random = Math.floor(1000 + Math.random() * 9000);
return `RE-${year}-${random}`;
}

function createInvoicePoint(value = "") {
const wrapper = document.createElement("div");
wrapper.className = "invoicePoint";

wrapper.innerHTML = `
<textarea
class="invoicePointInput"
placeholder="z. B. Wohnzimmer gestrichen, weiß, ca. 60qm"
>${value}</textarea>

<button type="button" class="btn btnSecondary invoicePointRemove">–</button>
`;

wrapper.querySelector(".invoicePointRemove").addEventListener("click", () => {
if (invoicePoints.children.length === 1) return;
wrapper.remove();
});

invoicePoints.appendChild(wrapper);
}

function collectInvoicePoints() {
return Array.from(document.querySelectorAll(".invoicePointInput"))
.map((field) => field.value.trim())
.filter(Boolean);
}

function buildPositionsFromPoints(points) {
return points.map((point, index) => ({
pos: index + 1,
description: point,
quantity: "",
unit: "",
unitPrice: "",
total: ""
}));
}

function createInvoiceDraft(event) {
event.preventDefault();

const today = new Date();
const dueDays = document.getElementById("dueDays").value;

const invoiceId = crypto.randomUUID();

const draft = {
id: invoiceId,
createdAt: new Date().toISOString(),
contactId: null,
status: "open",

recipientName: document.getElementById("recipientName").value.trim(),
recipientStreet: document.getElementById("recipientStreet").value.trim(),
recipientCity: document.getElementById("recipientCity").value.trim(),
recipientEmail: document.getElementById("recipientEmail").value.trim(),

invoiceNumber: createInvoiceNumber(),
invoiceDate: formatDate(today),
dueDate: formatDate(addDays(today, dueDays)),
serviceDate: document.getElementById("serviceDate").value,

introText: "vielen Dank für Ihren Auftrag. Für die erbrachten Leistungen stellen wir Ihnen folgende Rechnung:",
closingText: "Bitte überweisen Sie den Rechnungsbetrag innerhalb des angegebenen Zahlungsziels.",

invoicePoints: collectInvoicePoints(),
positions: buildPositionsFromPoints(collectInvoicePoints())
};

localStorage.setItem(INVOICE_DRAFT_KEY, JSON.stringify(draft));

showToast("Rechnung wird vorbereitet.");

setTimeout(() => {
window.location.href = "/invoice-editor";
}, 500);
}

invoiceCreateForm.addEventListener("submit", createInvoiceDraft);

createInvoicePoint();

addInvoicePointBtn.addEventListener("click", () => {
createInvoicePoint();
});
