const emailThreadsList = document.getElementById("emailThreadsList");
const emptyEmails = document.getElementById("emptyEmails");

const createDemoEmailBtn = document.getElementById("createDemoEmailBtn");

let activeFilter = "all";
let emailThreadsCache = [];

async function apiGetEmailThreads() {
const response = await fetch("/api/email-threads");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail-Verläufe konnten nicht geladen werden.");
}

return result.threads || [];
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
(thread) => thread.related_type === activeFilter
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
toggleThread(item, thread);
});

item.innerHTML = `
<div class="emailThreadTop">
<div>
<div class="emailSubject">
${thread.subject || "Ohne Betreff"}
</div>

<div class="emailMeta">
${thread.related_type || "general"}
</div>
</div>

<div class="emailMeta">
${new Date(thread.created_at).toLocaleDateString("de-DE")}
</div>
</div>

<div class="emailSummary">
${thread.ai_summary || "Noch keine KI-Zusammenfassung vorhanden."}
</div>

<div class="emailBadgeRow">
<div class="emailBadge">
${thread.status || "open"}
</div>

<div class="emailBadge">
${thread.ai_category || "Keine Kategorie"}
</div>
</div>
`;

emailThreadsList.appendChild(item);
});
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

if (!messages.length) {
details.innerHTML = `<p class="emailMeta">Noch keine Nachrichten vorhanden.</p>`;
return;
}

details.innerHTML = messages
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

<div class="emailMessageBody">
${message.body || ""}
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
.join("");
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

await renderEmailThreads();

alert("Demo-E-Mail erstellt");

} catch (error) {
console.error(error);
alert(error.message);
}
});