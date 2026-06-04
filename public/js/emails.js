const emailThreadsList = document.getElementById("emailThreadsList");
const emptyEmails = document.getElementById("emptyEmails");

const emptyMailState = document.getElementById("emptyMailState");
const mailDetailView = document.getElementById("mailDetailView");

const currentFolderTitle = document.getElementById("currentFolderTitle");
const currentFolderSubtitle = document.getElementById("currentFolderSubtitle");
const activeCommunicationInfo = document.getElementById("activeCommunicationInfo");

const composeMailModal = document.getElementById("composeMailModal");
const newMailBtn = document.getElementById("newMailBtn");
const closeComposeMailBtn = document.getElementById("closeComposeMailBtn");

const composeRecipient = document.getElementById("composeRecipient");
const composeSubject = document.getElementById("composeSubject");
const composeBody = document.getElementById("composeBody");

const addAttachmentBtn = document.getElementById("addAttachmentBtn");
const sendComposeMailBtn = document.getElementById("sendComposeMailBtn");

const mailAttachmentInput = document.getElementById("mailAttachmentInput");
const mailAttachmentsList = document.getElementById("mailAttachmentsList");

let selectedAttachments = [];
let activeFolder = "offer";
let emailMessagesCache = [];
let activeMessageId = null;

const folderLabels = {
offer: "Angebote",
invoice: "Rechnungen",
appointment: "Termine",
other: "Sonstiges",
sent: "Gesendet",
trash: "Papierkorb"
};

const folderSubtitles = {
offer: "E-Mails, die zu Angeboten gehören.",
invoice: "E-Mails, die zu Rechnungen gehören.",
appointment: "E-Mails mit erkannten Terminen und Rücksprachen.",
other: "Sonstige Kundenkommunikation.",
sent: "Von WorkPilot gesendete E-Mails.",
trash: "Gelöschte E-Mails werden später nach 30 Tagen entfernt."
};

function renderCommunicationInfo() {

const profileSettings = JSON.parse(
localStorage.getItem("workpilot_company_settings") || "{}"
);

const communicationEmail =
profileSettings.personalEmail || "";

if (!communicationEmail) {

activeCommunicationInfo.textContent =
"Keine Kommunikations-E-Mail verbunden.";

return;
}

activeCommunicationInfo.textContent =
`Aktive Kommunikations-E-Mail: ${communicationEmail}`;
}

function formatFileSize(bytes){
if(bytes < 1024){
return bytes + " B";
}

if(bytes < 1024 * 1024){
return (bytes / 1024).toFixed(1) + " KB";
}

return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

async function getMessageAttachments(messageId) {
const response = await fetch(`/api/email-messages/${messageId}/attachments`);
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Anhänge konnten nicht geladen werden.");
}

return result.attachments || [];
}

async function openAttachment(attachmentId) {
const response = await fetch(`/api/email-attachments/${attachmentId}/open`);
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Anhang konnte nicht geöffnet werden.");
}

window.open(result.url, "_blank");
}

function renderAttachments(){
mailAttachmentsList.innerHTML = "";

selectedAttachments.forEach((file, index) => {

const item = document.createElement("div");
item.className = "mailAttachmentItem";

item.innerHTML = `
<div>
<div class="mailAttachmentName">
${file.name}
</div>

<div class="mailAttachmentSize">
${formatFileSize(file.size)}
</div>
</div>

<button
class="mailAttachmentRemove"
data-index="${index}"
>
✕
</button>
`;

const removeBtn = item.querySelector(".mailAttachmentRemove");

removeBtn.addEventListener("click", () => {
selectedAttachments.splice(index, 1);
renderAttachments();
});

mailAttachmentsList.appendChild(item);
});
}

function getMessageFolder(message) {
const relatedType = message.email_threads?.related_type;
const aiCategory = message.email_threads?.ai_category;
const intent = message.ai_detected_intent;

if (message.deleted_at) return "trash";
if (message.direction === "outbound") return "sent";

if (
relatedType === "appointment" ||
relatedType === "schedule" ||
aiCategory === "appointment" ||
aiCategory === "schedule" ||
intent === "appointment"
) {
return "appointment";
}

if (
relatedType === "offer" ||
aiCategory === "offer" ||
intent === "offer_request"
) {
return "offer";
}

if (
relatedType === "invoice" ||
aiCategory === "invoice" ||
intent === "invoice_question"
) {
return "invoice";
}

return "other";
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
offer: 0,
invoice: 0,
appointment: 0,
other: 0,
sent: 0,
trash: 0
};

emailMessagesCache.forEach((message) => {
const folder = getMessageFolder(message);

if (counts[folder] !== undefined) {
counts[folder] += 1;
}
});

document.getElementById("countOffer").textContent = counts.offer;
document.getElementById("countInvoice").textContent = counts.invoice;
document.getElementById("countAppointment").textContent = counts.appointment;
document.getElementById("countOther").textContent = counts.other;
document.getElementById("countSent").textContent = counts.sent;
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

async function moveMessageToTrash(messageId) {
const response = await fetch(`/api/email-messages/${messageId}/trash`, {
method: "PUT"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht gelöscht werden.");
}

return result.message;
}

async function restoreMessage(messageId) {
const response = await fetch(`/api/email-messages/${messageId}/restore`, {
method: "POST"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht wiederhergestellt werden.");
}
}

async function sendFreeEmail({ to, subject, body }) {
const response = await fetch("/api/send-email", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
to,
subject,
html: body.replaceAll("\n", "<br>")
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht gesendet werden.");
}

return result.email;
}

async function deleteMessageForever(messageId) {
const response = await fetch(`/api/email-messages/${messageId}`, {
method: "DELETE"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht gelöscht werden.");
}
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

item.dataset.messageId = message.id;
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

if (isUnread(message)) {
try {
await markMessageAsRead(message.id);
message.read_at = new Date().toISOString();
updateFolderCounts();
} catch (error) {
console.error(error);
}
}

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

<div class="mailRowActions">

${activeFolder === "trash" ? `
<button class="mailRowRestoreBtn">↩</button>
` : ""}

<button class="mailRowDeleteBtn">🗑</button>
</div>
`;

const deleteButton = item.querySelector(".mailRowDeleteBtn");

deleteButton.addEventListener("click", async (event) => {
event.stopPropagation();

try {

if (activeFolder === "trash") {

await deleteMessageForever(message.id);

showToast("E-Mail wurde endgültig gelöscht.");

} else {

await moveMessageToTrash(message.id);

showToast("E-Mail wurde in den Papierkorb verschoben.");
}

if (activeMessageId === message.id) {
activeMessageId = null;

mailDetailView.classList.add("hidden");
emptyMailState.classList.remove("hidden");
}

await renderEmails();

} catch (error) {
showToast(error.message);
}
});

const restoreButton = item.querySelector(".mailRowRestoreBtn");

if (restoreButton) {
restoreButton.addEventListener("click", async (event) => {
event.stopPropagation();

try {

await restoreMessage(message.id);

showToast("E-Mail wurde wiederhergestellt.");

await renderEmails();

} catch (error) {
showToast(error.message);
}
});
}

emailThreadsList.appendChild(item);
});
}

async function openEmailFromUrl() {
const params = new URLSearchParams(window.location.search);
const threadId = params.get("thread");

if (!threadId) return;

const message = emailMessagesCache.find((entry) => {
return entry.thread_id === threadId;
});

if (!message) return;

const targetFolder = getMessageFolder(message);

activeFolder = targetFolder;

document.querySelectorAll(".mailFolder").forEach((button) => {
button.classList.toggle(
"active",
button.dataset.folder === targetFolder
);
});

activeMessageId = message.id;

await renderEmails();

const updatedMessage = emailMessagesCache.find((entry) => {
return entry.id === message.id;
});

if (!updatedMessage) return;

const matchingItem = document.querySelector(
`[data-message-id="${updatedMessage.id}"]`
);

if (matchingItem) {
matchingItem.classList.add("selected");
matchingItem.classList.remove("unread");

matchingItem.scrollIntoView({
behavior: "smooth",
block: "center"
});
}

if (isUnread(updatedMessage)) {
try {
await markMessageAsRead(updatedMessage.id);
updatedMessage.read_at = new Date().toISOString();
updateFolderCounts();
} catch (error) {
console.error(error);
}
}

await openMailDetail(updatedMessage);
}

async function markMessageAsRead(messageId) {
const response = await fetch(`/api/email-messages/${messageId}/read`, {
method: "PUT"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht als gelesen markiert werden.");
}

return result.message;
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

let attachments = [];

try {
attachments = await getMessageAttachments(message.id);
} catch (error) {
console.error(error);
}

let matchedContact = null;

if (message.contact_id) {
try {

const response = await fetch(`/api/contacts/${message.contact_id}`);
const result = await response.json();

if (result.ok) {
matchedContact = result.contact;
}

} catch (error) {
console.error(error);
}
}

const folder = getMessageFolder(message);

const showOfferButton =
folder === "offer" ||
message.ai_detected_intent === "offer";

const showCalendarButton =
folder === "appointment" ||
message.ai_detected_intent === "appointment";

const showNoteButton =
message.direction === "inbound";

const showReplyBox =
message.direction === "inbound";

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

${
matchedContact
? `
<div class="mailLinkedContact">
<strong>Kontakt:</strong>
${matchedContact.name || matchedContact.email}

<button
class="mailOpenContactBtn"
data-contact-id="${matchedContact.id}"
>
Kontakt öffnen
</button>
</div>
`
: `
<div class="mailNoContact">
<div>
Kein Kontakt zugeordnet.
</div>

<button
class="mailCreateContactBtn"
data-name="${message.sender || ""}"
data-email="${message.sender || ""}"
>
Kontakt erstellen
</button>
</div>
`
}
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
attachments.length
? `
<div class="mailAttachmentsView">
<strong>Anhänge</strong>

${attachments.map((attachment) => `
<button class="mailAttachmentOpenBtn" data-attachment-id="${attachment.id}">
📎 ${attachment.file_name}
</button>
`).join("")}
</div>
`
: ""
}

${
message.ai_suggested_reply
? `
<div class="detailAiReply">
<div class="aiReplyHeader">
<strong>KI-Antwortvorschlag:</strong>

<button id="useAiSuggestionBtn" class="btn btnSecondary">
Vorschlag übernehmen
</button>
</div>

<div>
${message.ai_suggested_reply}
</div>
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
${
showOfferButton
? `
<button id="createOfferFromEmailBtn" class="btn btnSecondary">
📄 Angebot
</button>
`
: ""
}

${
showCalendarButton
? `
<button id="createCalendarFromEmailBtn" class="btn btnSecondary">
📅 Termin
</button>
`
: ""
}

${
showNoteButton
? `
<button id="createNoteFromEmailBtn" class="btn btnSecondary">
📝 Notiz
</button>
`
: ""
}

<button id="sendMailReplyBtn" class="btn btnPrimary">
Senden
</button>
</div>
</div>
`;

bindReplyActions(message, subject);

document.querySelectorAll(".mailOpenContactBtn").forEach((button) => {
button.addEventListener("click", () => {
const contactId = button.dataset.contactId;

window.location.href = `/contact-detail?id=${contactId}`;
});
});

document.querySelectorAll(".mailCreateContactBtn").forEach((button) => {
button.addEventListener("click", async () => {
try {
const response = await fetch("/api/contacts", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
name: button.dataset.name,
email: button.dataset.email
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakt konnte nicht erstellt werden.");
}

showToast("Kontakt wurde erstellt.");

await renderEmails();

} catch (error) {
showToast(error.message);
}
});
});

document.querySelectorAll(".mailAttachmentOpenBtn").forEach((button) => {
button.addEventListener("click", async () => {
try {
await openAttachment(button.dataset.attachmentId);
} catch (error) {
showToast(error.message);
}
});
});
}

function getCalendarSuggestionFromMessage(message, subject) {
const suggestion = message.calendar_suggestion || {};

return {
title:
suggestion.title ||
`Rücksprache ${message.sender || "Kunde"}`,

date:
suggestion.date ||
"",

time:
suggestion.time ||
"",

description:
suggestion.description ||
`E-Mail: ${subject}`
};
}

function bindReplyActions(message, subject) {
const replyTextarea = document.getElementById("mailReplyTextarea");
const useAiSuggestionBtn = document.getElementById("useAiSuggestionBtn");
const sendMailReplyBtn = document.getElementById("sendMailReplyBtn");

const createOfferFromEmailBtn = document.getElementById("createOfferFromEmailBtn");
const createCalendarFromEmailBtn = document.getElementById("createCalendarFromEmailBtn");

if (createOfferFromEmailBtn) {
createOfferFromEmailBtn.addEventListener("click", async () => {
try {
const response = await fetch("/api/dashboard-actions", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
actionTarget: "create_offer_draft",
actionPayload: {
messageId: message.id,
threadId: message.thread_id
}
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Angebotsvorschlag konnte nicht erstellt werden.");
}

if (result.target) {
window.location.href = result.target;
return;
}

showToast(result.message || "Angebotsvorschlag wurde erstellt.");
} catch (error) {
showToast(error.message);
}
});
}

if (createCalendarFromEmailBtn) {
createCalendarFromEmailBtn.addEventListener("click", () => {
const calendarSuggestion =
getCalendarSuggestionFromMessage(message, subject);

const params = new URLSearchParams();

if (calendarSuggestion.title) {
params.set("title", calendarSuggestion.title);
}

if (calendarSuggestion.date) {
params.set("date", calendarSuggestion.date);
}

if (calendarSuggestion.time) {
params.set("time", calendarSuggestion.time);
}

if (calendarSuggestion.description) {
params.set("description", calendarSuggestion.description);
}

window.location.href = `/calendar-create?${params.toString()}`;
});
}

if (useAiSuggestionBtn) {
useAiSuggestionBtn.addEventListener("click", () => {
if (!message.ai_suggested_reply) {
showToast("Kein KI-Vorschlag vorhanden.");
return;
}

replyTextarea.value = message.ai_suggested_reply;
});
}

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

renderEmails().then(async () => {
await openEmailFromUrl();
});

renderCommunicationInfo();

addAttachmentBtn.addEventListener("click", () => {
mailAttachmentInput.click();
});

mailAttachmentInput.addEventListener("change", (event) => {

const files = Array.from(event.target.files);

selectedAttachments.push(...files);

renderAttachments();

mailAttachmentInput.value = "";
});

const newMailBtn = document.getElementById("newMailBtn");
const composeMailModal = document.getElementById("composeMailModal");
const closeComposeMailBtn = document.getElementById("closeComposeMailBtn");

newMailBtn.addEventListener("click", () => {
composeMailModal.classList.remove("hidden");
});

closeComposeMailBtn.addEventListener("click", () => {
composeMailModal.classList.add("hidden");
});

newMailBtn.addEventListener("click", () => {
composeRecipient.value = "";
composeSubject.value = "";
composeBody.value = "";

composeMailModal.classList.remove("hidden");
});

closeComposeMailBtn.addEventListener("click", () => {
composeMailModal.classList.add("hidden");
});

sendComposeMailBtn.addEventListener("click", async () => {

const recipient = composeRecipient.value.trim();
const subject = composeSubject.value.trim();
const body = composeBody.value.trim();

const profileSettings = JSON.parse(
localStorage.getItem("workpilot_company_settings") || "{}"
);

const communicationEmail = profileSettings.personalEmail || "";

if (!communicationEmail) {
showToast("Bitte hinterlege zuerst deine persönliche Geschäfts-E-Mail im Profil.");
return;
}

if (!recipient || !subject || !body) {
showToast("Bitte alle Felder ausfüllen.");
return;
}

sendComposeMailBtn.disabled = true;
sendComposeMailBtn.textContent = "Wird gesendet...";

try {

const formData = new FormData();

formData.append("to", recipient);
formData.append("subject", subject);
formData.append("html", body);

selectedAttachments.forEach((file) => {
formData.append("attachments", file);
});

const response = await fetch("/api/send-email", {
method: "POST",
body: formData
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht gesendet werden.");
}

showToast("E-Mail wurde versendet.");

composeMailModal.classList.add("hidden");

composeRecipient.value = "";
composeSubject.value = "";
composeBody.value = "";

selectedAttachments = [];
renderAttachments();

await renderEmails();

} catch (error) {
showToast(error.message);

} finally {
sendComposeMailBtn.disabled = false;
sendComposeMailBtn.textContent = "Senden";
}

});
});
