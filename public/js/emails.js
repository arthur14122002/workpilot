const emailThreadsList = document.getElementById("emailThreadsList");
const emptyEmails = document.getElementById("emptyEmails");

const emptyMailState = document.getElementById("emptyMailState");
const mailDetailView = document.getElementById("mailDetailView");

const currentFolderTitle = document.getElementById("currentFolderTitle");
const currentFolderSubtitle = document.getElementById("currentFolderSubtitle");

let activeFolder = "inbox";
let emailMessagesCache = [];
let activeMessageId = null;

const folderLabels = {
inbox: "Posteingang",
offer: "Angebote",
invoice: "Rechnungen",
sent: "Gesendet",
other: "Sonstiges",
trash: "Papierkorb"
};

const folderSubtitles = {
inbox: "Alle aktuellen E-Mails in WorkPilot.",
offer: "E-Mails, die zu Angeboten gehören.",
invoice: "E-Mails, die zu Rechnungen gehören.",
sent: "Von WorkPilot gesendete E-Mails.",
other: "Sonstige Kundenkommunikation.",
trash: "Gelöschte E-Mails werden später nach 30 Tagen entfernt."
};

function getMessageFolder(message) {
const relatedType = message.email_threads?.related_type;

if (message.deleted_at) return "trash";
if (message.direction === "outbound") return "sent";
if (relatedType === "offer") return "offer";
if (relatedType === "invoice") return "invoice";

return "inbox";
}

function isUnread(message) {
return message.direction === "inbound" && !message.read_at;
}

function getVisibleMessages() {
return emailMessagesCache.filter((message) => {
return getMessageFolder(message) === activeFolder;
});
}

function updateFolderCounts() {
const counts = {
inbox: 0,
offer: 0,
invoice: 0,
sent: 0,
other: 0,
trash: 0
};

emailMessagesCache.forEach((message) => {
const folder = getMessageFolder(message);

if (counts[folder] !== undefined) {
counts[folder] += 1;
}
});

document.getElementById("countInbox").textContent = counts.inbox;
document.getElementById("countOffer").textContent = counts.offer;
document.getElementById("countInvoice").textContent = counts.invoice;
document.getElementById("countSent").textContent = counts.sent;
document.getElementById("countOther").textContent = counts.other;
document.getElementById("countTrash").textContent = counts.trash;
}

async function apiGetEmailMessages() {
const response = await fetch("/api/email-inbox");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mails konnten nicht geladen werden.");
}

return result.messages || [];
}

async function renderEmails() {
emailThreadsList.innerHTML = "";

try {
emailMessagesCache = await apiGetEmailMessages();
} catch (error) {
showToast(error.message);
return;
}

updateFolderCounts();

currentFolderTitle.textContent = folderLabels[activeFolder];
currentFolderSubtitle.textContent = folderSubtitles[activeFolder];

const visibleMessages = getVisibleMessages();

if (!visibleMessages.length) {
emptyEmails.classList.remove("hidden");
return;
}

emptyEmails.classList.add("hidden");

visibleMessages.forEach((message) => {
const item = document.createElement("div");

item.className = `emailThreadItem ${isUnread(message) ? "unread" : ""}`;

if (message.id === activeMessageId) {
item.classList.add("selected");
}

item.addEventListener("click", async () => {
activeMessageId = message.id;

document.querySelectorAll(".emailThreadItem").forEach((entry) => {
entry.classList.remove("selected");
});

item.classList.add("selected");
item.classList.remove("unread");

await openMailDetail(message);
});

const subject =
message.subject ||
message.email_threads?.subject ||
"Ohne Betreff";

item.innerHTML = `
<div class="threadTop">
<div class="threadSender">
${message.direction === "outbound" ? message.recipient || "Unbekannt" : message.sender || "Unbekannt"}
</div>

<div class="threadDate">
${new Date(message.created_at).toLocaleDateString("de-DE")}
</div>
</div>

<div class="threadSubject">
${subject}
</div>

<div class="threadPreview">
${stripHtml(message.body || "").slice(0, 120) || "Keine Vorschau verfügbar"}
</div>
`;

emailThreadsList.appendChild(item);
});
}

function stripHtml(value) {
const div = document.createElement("div");
div.innerHTML = value;
return div.textContent || div.innerText || "";
}

async function openMailDetail(message) {
emptyMailState.classList.add("hidden");
mailDetailView.classList.remove("hidden");

const relatedThread = message.email_threads || {};
const subject =
message.subject ||
relatedThread.subject ||
"Ohne Betreff";

mailDetailView.innerHTML = `
<div class="mailDetailHeader">
<div>
<div class="mailDetailType">
${folderLabels[getMessageFolder(message)] || "E-Mail"}
</div>

<h2>${subject}</h2>

<p>
Von: ${message.sender || "Unbekannt"}<br>
An: ${message.recipient || "Unbekannt"}
</p>
</div>

<div class="mailDetailDate">
${new Date(message.created_at).toLocaleDateString("de-DE")}
</div>
</div>

<div class="mailMessagesDetailList">
<div class="detailMessageItem">
<div class="detailMessageTop">
<strong>
${message.direction === "inbound" ? "Eingegangen" : "Gesendet"}
</strong>

<span>
${new Date(message.created_at).toLocaleString("de-DE")}
</span>
</div>

<div class="detailMessageBody">
${message.body || ""}
</div>

${
message.ai_suggested_reply
? `
<div class="detailAiReply">
<strong>KI-Antwortvorschlag:</strong><br><br>
${message.ai_suggested_reply}
</div>
`
: ""
}
</div>
</div>

<div class="mailReplyBox">
<textarea
id="mailReplyTextarea"
class="mailReplyTextarea"
placeholder="Antwort schreiben..."
></textarea>

<div class="mailReplyActions">
<button id="useAiSuggestionBtn" class="btn btnSecondary">
KI-Vorschlag übernehmen
</button>

<button id="sendMailReplyBtn" class="btn btnPrimary">
Antwort senden
</button>
</div>
</div>
`;

bindReplyActions(message, subject);
}

function bindReplyActions(message, subject) {
const replyTextarea = document.getElementById("mailReplyTextarea");
const useAiSuggestionBtn = document.getElementById("useAiSuggestionBtn");
const sendMailReplyBtn = document.getElementById("sendMailReplyBtn");

useAiSuggestionBtn.addEventListener("click", () => {
if (!message.ai_suggested_reply) {
showToast("Kein KI-Vorschlag vorhanden.");
return;
}

replyTextarea.value = message.ai_suggested_reply;
});

sendMailReplyBtn.addEventListener("click", async () => {
const text = replyTextarea.value.trim();

if (!text) {
showToast("Bitte eine Antwort eingeben.");
return;
}

try {
await sendReply(
message.thread_id,
text,
subject,
message.sender
);

showToast("Antwort wurde gespeichert.");
await renderEmails();
} catch (error) {
showToast(error.message);
}
});
}

async function sendReply(threadId, body, subject, recipient) {
const response = await fetch("/api/email-reply", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
threadId,
body,
subject,
recipient
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Antwort konnte nicht gespeichert werden.");
}

return result.message;
}

function bindFolders() {
document.querySelectorAll(".mailFolder").forEach((button) => {
button.addEventListener("click", () => {
activeFolder = button.dataset.folder;

document.querySelectorAll(".mailFolder").forEach((entry) => {
entry.classList.remove("active");
});

button.classList.add("active");

activeMessageId = null;
mailDetailView.classList.add("hidden");
emptyMailState.classList.remove("hidden");

renderEmails();
});
});
}

document.addEventListener("DOMContentLoaded", () => {
bindFolders();
renderEmails();
});
