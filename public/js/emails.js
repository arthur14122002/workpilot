const emailThreadsList = document.getElementById("emailThreadsList");
const emptyEmails = document.getElementById("emptyEmails");

const emptyMailState = document.getElementById("emptyMailState");
const mailDetailView = document.getElementById("mailDetailView");

const createDemoEmailBtn = document.getElementById("createDemoEmailBtn");

let activeFilter = "all";
let emailThreadsCache = [];

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
${relatedThread.related_type || "E-Mail"}
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
${
message.direction === "inbound"
? "Eingegangen"
: "Gesendet"
}
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
await renderEmailThreads();

const latestMessages = await apiGetEmailThreads();
const newestReply = latestMessages.find((entry) => {
return (
entry.thread_id === message.thread_id &&
entry.direction === "outbound"
);
});

if (newestReply) {
openMailDetail(newestReply);
}
} catch (error) {
showToast(error.message);
}
});
}

async function apiGetEmailThreads() {
const response = await fetch("/api/email-inbox");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mails konnten nicht geladen werden.");
}

return result.messages || [];
}

async function renderEmailThreads() {
emailThreadsList.innerHTML = "";

try {
emailThreadsCache = await apiGetEmailThreads();
} catch (error) {
console.error(error);
return;
}

const visibleThreads =
activeFilter === "all"
? emailThreadsCache
: emailThreadsCache.filter(
(message) =>
message.email_threads?.related_type === activeFilter
);

if (!visibleThreads.length) {
emptyEmails.style.display = "block";
return;
}

emptyEmails.style.display = "none";

visibleThreads.forEach((thread) => {
const item = document.createElement("div");
item.className = "emailThreadItem";

item.addEventListener("click", () => {
document.querySelectorAll(".emailThreadItem").forEach((entry) => {
entry.classList.remove("selected");
});

item.classList.add("selected");

openMailDetail(thread);
});

item.innerHTML = `
<div class="threadTop">
<div class="threadSender">
${thread.sender || "Unbekannt"}
</div>

<div class="threadDate">
${new Date(thread.created_at).toLocaleDateString("de-DE")}
</div>
</div>

<div class="threadSubject">
${thread.subject ||
thread.email_threads?.subject ||
"Ohne Betreff"}
</div>

<div class="threadPreview">
${thread.body?.slice(0, 120) || "Keine Vorschau verfügbar"}
</div>
`;

emailThreadsList.appendChild(item);
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

async function apiGetEmailMessages(threadId) {
const response = await fetch(`/api/email-messages/${threadId}`);
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Nachrichten konnten nicht geladen werden.");
}

return result.messages || [];
}

async function toggleThread(item, thread) {
const existingDetails = item.querySelector(".emailThreadDetails");

if (existingDetails) {
existingDetails.remove();
item.classList.remove("open");
return;
}

document.querySelectorAll(".emailThreadDetails").forEach((detail) => {
detail.remove();
});

document.querySelectorAll(".emailThreadItem.open").forEach((entry) => {
entry.classList.remove("open");
});

item.classList.add("open");

const details = document.createElement("div");
details.className = "emailThreadDetails";
details.innerHTML = `<p class="emailMeta">Nachrichten werden geladen...</p>`;

item.appendChild(details);

let messages = [];

try {
messages = await apiGetEmailMessages(thread.id);
} catch (error) {
details.innerHTML = `<p class="emailMeta">${error.message}</p>`;
return;
}

const messagesHtml = messages.length
? messages
.map((message) => {
return `
<div class="emailMessageItem">
<div class="emailMessageTop">
<div class="emailMessageDirection">
${
message.direction === "inbound"
? "Kunde → WorkPilot"
: "WorkPilot → Kunde"
}
</div>

<div class="emailMeta">
${new Date(message.created_at).toLocaleString("de-DE")}
</div>
</div>

<button class="toggleOriginalBtn">
Original-E-Mail anzeigen
</button>

<div class="originalEmail hidden">
<div class="emailMessageBody">
${message.body || ""}
</div>
</div>

${
message.ai_suggested_reply
? `
<div class="emailMessageAi">
<strong>KI-Antwortvorschlag:</strong><br><br>
${message.ai_suggested_reply}
</div>
`
: ""
}
</div>
`;
})
.join("")
: `<p class="emailMeta">Noch keine Nachrichten vorhanden.</p>`;

details.innerHTML =
messagesHtml +
`
<div class="replyBox">
<textarea
class="replyTextarea"
placeholder="Antwort schreiben..."
></textarea>

<div class="replyActions">
<button class="btn btnSecondary aiReplyBtn">
KI-Vorschlag übernehmen
</button>

<button class="btn btnPrimary sendReplyBtn">
Antwort senden
</button>
</div>
</div>
`;

details.addEventListener("click", (event) => {
event.stopPropagation();
});

const textarea = details.querySelector(".replyTextarea");
const aiButton = details.querySelector(".aiReplyBtn");
const sendButton = details.querySelector(".sendReplyBtn");

details.querySelectorAll(".toggleOriginalBtn").forEach((button) => {
button.addEventListener("click", (event) => {
event.stopPropagation();

const original =
button.parentElement.querySelector(".originalEmail");

original.classList.toggle("hidden");

button.textContent = original.classList.contains("hidden")
? "Original-E-Mail anzeigen"
: "Original-E-Mail ausblenden";
});
});

const latestAiSuggestion = [...messages]
.reverse()
.find((message) => message.ai_suggested_reply);

aiButton.addEventListener("click", () => {
if (!latestAiSuggestion) {
showToast("Kein KI-Vorschlag vorhanden.");
return;
}

textarea.value = latestAiSuggestion.ai_suggested_reply;
});

sendButton.addEventListener("click", async () => {
const text = textarea.value.trim();

if (!text) {
showToast("Bitte eine Antwort eingeben.");
return;
}

try {
await sendReply(thread.id, text);

showToast("Antwort wurde gespeichert.");

details.remove();
item.classList.remove("open");

await toggleThread(item, thread);
} catch (error) {
showToast(error.message);
}
});
}

function bindFilters() {
document.querySelectorAll(".emailFilter").forEach((button) => {
button.addEventListener("click", () => {
activeFilter = button.dataset.filter;

document.querySelectorAll(".emailFilter").forEach((entry) => {
entry.classList.remove("active");
});

button.classList.add("active");

renderEmailThreads();
});
});
}

document.addEventListener("DOMContentLoaded", () => {
bindFilters();
renderEmailThreads();
});

createDemoEmailBtn.addEventListener("click", async () => {
try {

const threadResponse = await fetch("/api/email-threads", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
subject: "Angebot für Küchenrenovierung",
relatedType: "offer",
status: "open",
aiSummary: "Kunde interessiert sich für Küchenrenovierung.",
aiCategory: "Angebot"
})
});

const threadResult = await threadResponse.json();

if (!threadResult.ok) {
throw new Error(threadResult.error);
}

const thread = threadResult.thread;

const messageResponse = await fetch("/api/email-messages", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
threadId: thread.id,
direction: "inbound",
sender: "kunde@example.com",
recipient: "workpilot@example.com",
subject: "Angebot für Küchenrenovierung",
body: "Hallo, ich hätte gerne ein Angebot für meine Küche.",
aiDetectedIntent: "Anfrage",
aiSuggestedReply:
"Vielen Dank für Ihre Anfrage. Gerne erstellen wir Ihnen ein Angebot."
})
});

const messageResult = await messageResponse.json();

if (!messageResult.ok) {
throw new Error(messageResult.error);
}

const sendResponse = await fetch("/api/send-email", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
to: "arthur.02@gmx.de",
subject: "WorkPilot Testmail",
html: `
<h1>WorkPilot funktioniert 😄</h1>

<p>
Diese E-Mail wurde erfolgreich über Resend versendet.
</p>

<p>
Das Postfach-System von WorkPilot funktioniert 😄
</p>
`,
threadId: thread.id
})
});

const sendResult = await sendResponse.json();

if (!sendResult.ok) {
throw new Error(sendResult.error);
}

await renderEmailThreads();

alert("Demo-E-Mail erstellt");

} catch (error) {
console.error(error);
alert(error.message);
}
});
