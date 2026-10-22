const noteCreateForm =
document.getElementById("noteCreateForm");

const noteText =
document.getElementById("noteText");

function getUrlParam(name) {
const params = new URLSearchParams(window.location.search);
return params.get(name);
}

function getContactIdFromUrl() {
return getUrlParam("contactId");
}

function getSourceFromUrl() {
return getUrlParam("source");
}

function getMessageIdFromUrl() {
return getUrlParam("messageId");
}

async function apiCreateNote(note) {
const response = await fetch("/api/notes", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(note)
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Notiz konnte nicht gespeichert werden.");
}

return result.note;
}

async function apiGetEmails() {
const response = await fetch("/api/email-inbox");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht geladen werden.");
}

return result.messages || [];
}

async function prefillFromEmail() {
const source = getSourceFromUrl();
const messageId = getMessageIdFromUrl();

if (source !== "email" || !messageId) {
return;
}

try {
const messages = await apiGetEmails();

const message = messages.find((entry) => {
return entry.id === messageId;
});

if (!message) {
return;
}

const noteFromUrl = getUrlParam("note");

const noteContent =
noteFromUrl ||
message.ai_summary ||
message.email_threads?.ai_summary ||
"Keine KI-Zusammenfassung vorhanden.";

noteText.value =
`Notiz aus E-Mail
Betreff: ${message.subject || "Ohne Betreff"}
Datum: ${
message.created_at
? new Date(message.created_at).toLocaleString("de-DE")
: "-"
}

${noteContent}`;

} catch (error) {
showToast(error.message);
}
}

noteCreateForm.addEventListener("submit", async (event) => {
event.preventDefault();

const contactId = getContactIdFromUrl();

if (!contactId) {
showToast("Kontakt wurde nicht gefunden.");
return;
}

const text = noteText.value.trim();

if (!text) {
showToast("Bitte eine Notiz eingeben.");
return;
}

try {

await apiCreateNote({
contactId,
type: "note",
text,
source: getSourceFromUrl() || "manual",
data: {
messageId: getMessageIdFromUrl()
}
});

sessionStorage.setItem(
"workpilot_toast",
"Notiz wurde gespeichert."
);

window.location.href =
`/contact-detail?id=${contactId}`;

} catch (error) {
showToast(error.message);
}
});

document.addEventListener("DOMContentLoaded", prefillFromEmail);
