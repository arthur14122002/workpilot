const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const puppeteer = require("puppeteer");
const multer = require("multer");
const crypto = require("crypto");
const { google } = require("googleapis");

const upload = multer({
storage: multer.memoryStorage()
});

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);
const googleOAuthClient = new google.auth.OAuth2(
process.env.GOOGLE_CLIENT_ID,
process.env.GOOGLE_CLIENT_SECRET,
process.env.GOOGLE_REDIRECT_URI
);

const emailVerificationCodes = new Map();

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

let connectedGoogleTokens = null;

app.use(express.json());

app.use((req, res, next) => {
console.log("REQUEST:", req.method, req.url);
next();
});

app.get("/api/mailbox/google/start", (req, res) => {
const authUrl = googleOAuthClient.generateAuthUrl({
access_type: "offline",
prompt: "consent",
scope: [
"https://www.googleapis.com/auth/gmail.send",
"https://www.googleapis.com/auth/gmail.readonly"
]
});

res.json({
ok: true,
url: authUrl
});
});

app.post("/api/profile/send-email-verification", async (req, res) => {
const { email } = req.body;

if (!email) {
return res.status(400).json({
ok: false,
error: "E-Mail-Adresse fehlt."
});
}

const code = String(Math.floor(100000 + Math.random() * 900000));

emailVerificationCodes.set(email, {
code,
expiresAt: Date.now() + 10 * 60 * 1000
});

try {
await resend.emails.send({
from: `WorkPilot <${process.env.RESEND_FROM_EMAIL}>`,
to: email,
subject: "WorkPilot E-Mail-Verifizierung",
html: `
<div style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.6;">
<p>Ihr WorkPilot-Verifizierungscode lautet:</p>

<p style="font-size: 24px; font-weight: bold;">
${code}
</p>

<p>Der Code ist 10 Minuten gültig.</p>
</div>
`
});

res.json({
ok: true
});

} catch (error) {
console.error("EMAIL VERIFICATION ERROR:", error);

res.status(500).json({
ok: false,
error: "Verifizierungs-E-Mail konnte nicht gesendet werden."
});
}
});

app.post("/api/profile/verify-email-code", async (req, res) => {
const { email, code } = req.body;

if (!email || !code) {
return res.status(400).json({
ok: false,
error: "E-Mail oder Code fehlt."
});
}

const entry = emailVerificationCodes.get(email);

if (!entry) {
return res.status(400).json({
ok: false,
error: "Kein Verifizierungscode gefunden."
});
}

if (Date.now() > entry.expiresAt) {
emailVerificationCodes.delete(email);

return res.status(400).json({
ok: false,
error: "Der Verifizierungscode ist abgelaufen."
});
}

if (String(entry.code) !== String(code).trim()) {
return res.status(400).json({
ok: false,
error: "Der Verifizierungscode ist falsch."
});
}

emailVerificationCodes.delete(email);

res.json({
ok: true
});
});

app.get("/api/health/supabase", async (req, res) => {
const { data, error } = await supabase
.from("contacts")
.select("id")
.limit(1);

if (error) {
return res.status(500).json({ ok: false, error: error.message });
}

res.json({ ok: true, data });
});

app.get("/auth/google/callback", async (req, res) => {
const { code } = req.query;

if (!code) {
return res.redirect("/settings?google=error");
}

try {
const { tokens } = await googleOAuthClient.getToken(code);

googleOAuthClient.setCredentials(tokens);

const gmail = google.gmail({
version: "v1",
auth: googleOAuthClient
});

const { data: profile } = await gmail.users.getProfile({
userId: "me"
});

const connectedEmail = profile.emailAddress || "";

connectedGoogleTokens = tokens;

const { error: mailboxError } = await supabase
.from("mailbox_connections")
.upsert(
[
{
provider: "google",
email: connectedEmail,
access_token: tokens.access_token || null,
refresh_token: tokens.refresh_token || null,
scope: tokens.scope || null,
token_type: tokens.token_type || null,
expiry_date: tokens.expiry_date || null,
is_active: true,
updated_at: new Date().toISOString()
}
],
{
onConflict: "provider,email"
}
);

if (mailboxError) {
throw mailboxError;
}

console.log("GOOGLE MAILBOX CONNECTED:", {
email: connectedEmail
});

res.redirect(
`/settings?google=connected&email=${encodeURIComponent(connectedEmail)}`
);

} catch (error) {
console.error("GOOGLE CALLBACK ERROR");
console.error("MESSAGE:", error.message);
console.error("DATA:", JSON.stringify(error.response?.data, null, 2));
console.error("CAUSE:", error.cause);

res.redirect("/settings?google=error");
}
});

async function getActiveGoogleMailboxAuth() {
const { data: mailbox, error } = await supabase
.from("mailbox_connections")
.select("*")
.eq("provider", "google")
.eq("is_active", true)
.order("updated_at", { ascending: false })
.limit(1)
.single();

if (error || !mailbox) {
throw new Error("Kein Google-Postfach verbunden.");
}

const auth = new google.auth.OAuth2(
process.env.GOOGLE_CLIENT_ID,
process.env.GOOGLE_CLIENT_SECRET,
process.env.GOOGLE_REDIRECT_URI
);

auth.setCredentials({
access_token: mailbox.access_token,
refresh_token: mailbox.refresh_token,
scope: mailbox.scope,
token_type: mailbox.token_type,
expiry_date: mailbox.expiry_date
});

return {
auth,
mailbox
};
}

async function startGoogleMailboxWatch() {
const { auth, mailbox } = await getActiveGoogleMailboxAuth();

const gmail = google.gmail({
version: "v1",
auth
});

const response = await gmail.users.watch({
userId: "me",
requestBody: {
topicName: "projects/rosy-sky-500516-j7/topics/workpilot-gmail-updates",
labelIds: ["INBOX"]
}
});

await supabase
.from("mailbox_connections")
.update({
gmail_history_id: String(response.data.historyId),
watch_expiration: Number(response.data.expiration),
updated_at: new Date().toISOString()
})
.eq("id", mailbox.id);

return response.data;
}

app.post("/api/mailbox/google/watch", async (req, res) => {
try {
const watch = await startGoogleMailboxWatch();

res.json({
ok: true,
watch
});
} catch (error) {
console.error("GOOGLE WATCH ERROR:", error);

res.status(500).json({
ok: false,
error: error.message
});
}
});

function makeBase64Url(input) {
return Buffer.from(input)
.toString("base64")
.replace(/\+/g, "-")
.replace(/\//g, "_")
.replace(/=+$/, "");
}

async function sendEmailWithGoogle({ to, subject, html }) {
const { auth, mailbox } = await getActiveGoogleMailboxAuth();

const gmail = google.gmail({
version: "v1",
auth
});

const rawMessage = [
`From: ${mailbox.email}`,
`To: ${to}`,
`Subject: ${subject}`,
"MIME-Version: 1.0",
'Content-Type: text/html; charset="UTF-8"',
"",
html
].join("\r\n");

const result = await gmail.users.messages.send({
userId: "me",
requestBody: {
raw: makeBase64Url(rawMessage)
}
});

return {
provider: "google",
email: result.data,
sender: mailbox.email
};
}

function extractEmailAddress(value = "") {
const match = value.match(/<([^>]+)>/);

if (match) {
return match[1].trim().toLowerCase();
}

return value.trim().toLowerCase();
}

app.post("/api/mailbox/google/import", async (req, res) => {
const { range } = req.body;

try {
const { auth } = await getActiveGoogleMailboxAuth();

const gmail = google.gmail({
version: "v1",
auth
});

const query =
range === "all"
? ""
: `newer_than:${range}d`;

const listResponse = await gmail.users.messages.list({
userId: "me",
maxResults: 20,
q: query
});

const gmailMessages = listResponse.data.messages || [];

let importedCount = 0;

for (const gmailMessage of gmailMessages) {
const detailResponse = await gmail.users.messages.get({
userId: "me",
id: gmailMessage.id,
format: "metadata",
metadataHeaders: [
"From",
"To",
"Subject",
"Date"
]
});

const messageData = detailResponse.data;
const headers = messageData.payload?.headers || [];

const getHeader = (name) => {
const found = headers.find((header) => {
return header.name.toLowerCase() === name.toLowerCase();
});

return found?.value || "";
};

const senderRaw = getHeader("From");
const recipientRaw = getHeader("To");

const sender = extractEmailAddress(senderRaw);
const recipient = extractEmailAddress(recipientRaw);

const subject = getHeader("Subject") || "Ohne Betreff";
const dateHeader = getHeader("Date");

const createdAt = dateHeader
? new Date(dateHeader).toISOString()
: new Date().toISOString();

const gmailThreadId = messageData.threadId;
const gmailMessageId = messageData.id;

const { data: existingMessage } = await supabase
.from("email_messages")
.select("id")
.eq("external_message_id", gmailMessageId)
.maybeSingle();

if (existingMessage) {
continue;
}

const { data: thread, error: threadError } = await supabase
.from("email_threads")
.insert([
{
subject,
related_type: "gmail",
related_id: gmailThreadId,
status: "open",
ai_category: "Importiert",
manual_folder: "inbox"
}
])
.select()
.single();

if (threadError) {
throw threadError;
}

const { error: messageError } = await supabase
.from("email_messages")
.insert([
{
thread_id: thread.id,
direction: "inbound",
sender,
recipient,
subject,
body: messageData.snippet || "",
message_status: "received",
external_message_id: gmailMessageId,
external_thread_id: gmailThreadId,
created_at: createdAt
}
]);

if (messageError) {
throw messageError;
}

importedCount++;
}

res.json({
ok: true,
range,
count: importedCount,
found: gmailMessages.length
});

} catch (error) {
console.error("GOOGLE IMPORT ERROR:", error);

res.status(500).json({
ok: false,
error: "Google-E-Mails konnten nicht importiert werden."
});
}
});

app.get("/api/contacts", async (req, res) => {
const { data, error } = await supabase
.from("contacts")
.select("*")
.order("created_at", { ascending: false });

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
contacts: data
});
});

app.delete("/api/contacts/:id", async (req, res) => {
const { id } = req.params;

const { error } = await supabase
.from("contacts")
.delete()
.eq("id", id);

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true
});
});

app.get("/api/contacts/:id", async (req, res) => {
const { id } = req.params;

const { data, error } = await supabase
.from("contacts")
.select("*")
.eq("id", id)
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
contact: data
});
});

app.put("/api/contacts/:id", async (req, res) => {
const { id } = req.params;
const { name, email, phone, street, city, data } = req.body;

const { data: updatedContact, error } = await supabase
.from("contacts")
.update({
name,
email,
phone,
street,
city,
data: data || {},
updated_at: new Date().toISOString()
})
.eq("id", id)
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
contact: updatedContact
});
});

app.get("/api/offers", async (req, res) => {
const { data, error } = await supabase
.from("offers")
.select("*")
.order("created_at", { ascending: false });

if (error) {
return res.status(500).json({ ok: false, error: error.message });
}

res.json({ ok: true, offers: data });
});

app.get("/api/offers/:id", async (req, res) => {
const { id } = req.params;

let { data, error } = await supabase
.from("offers")
.select("*")
.eq("id", id)
.maybeSingle();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

if (!data) {
const fallback = await supabase
.from("offers")
.select("*")
.eq("offer_number", id)
.maybeSingle();

data = fallback.data;
error = fallback.error;
}

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

if (!data) {
return res.status(404).json({
ok: false,
error: "Angebot wurde nicht gefunden."
});
}

res.json({
ok: true,
offer: data
});
});

app.post("/api/contacts", async (req, res) => {

const {
name,
email,
phone,
street,
city
} = req.body;

const { data, error } = await supabase
.from("contacts")
.insert([
{
name,
email,
phone: phone || null,
street: street || null,
city: city || null
}
])
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

if (email) {

await supabase
.from("email_messages")
.update({
contact_id: data.id
})
.or(`sender.eq.${email},recipient.eq.${email}`);
}

await createDashboardEvent({
type: "contact_created",
title: "Kontakt erstellt",
description: `${name || email} wurde als Kontakt angelegt.`,
relatedType: "contact",
relatedId: data.id
});


res.json({
ok: true,
contact: data
});
});

app.post("/api/offers", async (req, res) => {
const offer = req.body;

const { data, error } = await supabase
.from("offers")
.upsert(
{
id: offer.id,
contact_id: offer.contactId || null,
offer_number: offer.offerNumber || null,
status: offer.status || "open",
data: offer,
updated_at: new Date().toISOString()
},
{
onConflict: "id"
}
)
.select()
.single();

if (error) {
return res.status(500).json({ ok: false, error: error.message });
}

res.json({ ok: true, offer: data });
});

app.put("/api/offers/:id", async (req, res) => {
const { id } = req.params;
const offer = req.body;

const { data, error } = await supabase
.from("offers")
.update({
contact_id: offer.contactId || null,
offer_number: offer.offerNumber || null,
status: offer.status || "open",
data: offer,
updated_at: new Date().toISOString()
})
.eq("id", id)
.select()
.single();

if (error) {
return res.status(500).json({ ok: false, error: error.message });
}

res.json({ ok: true, offer: data });
});

app.delete("/api/offers/:id", async (req, res) => {
const { id } = req.params;

const { error } = await supabase
.from("offers")
.delete()
.eq("id", id);

if (error) {
return res.status(500).json({ ok: false, error: error.message });
}

res.json({ ok: true });
});

app.get("/api/invoices", async (req, res) => {
const { data, error } = await supabase
.from("invoices")
.select("*")
.order("created_at", { ascending: false });

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
invoices: data
});
});

app.get("/api/invoices/:id", async (req, res) => {
const { id } = req.params;

const { data, error } = await supabase
.from("invoices")
.select("*")
.eq("id", id)
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
invoice: data
});
});

app.post("/api/invoices", async (req, res) => {
const invoice = req.body;

const { data, error } = await supabase
.from("invoices")
.insert([
{
id: invoice.id,
contact_id: invoice.contactId || null,
invoice_number: invoice.invoiceNumber || null,
status: invoice.status || "open",
data: invoice
}
])
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
invoice: data
});
});

app.put("/api/invoices/:id", async (req, res) => {
const { id } = req.params;
const invoice = req.body;

const { data, error } = await supabase
.from("invoices")
.update({
contact_id: invoice.contactId || null,
invoice_number: invoice.invoiceNumber || null,
status: invoice.status || "open",
data: invoice,
updated_at: new Date().toISOString()
})
.eq("id", id)
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
invoice: data
});
});

app.delete("/api/invoices/:id", async (req, res) => {
const { id } = req.params;

const { error } = await supabase
.from("invoices")
.delete()
.eq("id", id);

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true
});
});

app.get("/api/notes/:contactId", async (req, res) => {
const { contactId } = req.params;

const { data, error } = await supabase
.from("notes")
.select("*")
.eq("contact_id", contactId)
.order("created_at", { ascending: false });

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
notes: data
});
});

app.post("/api/notes", async (req, res) => {
const note = req.body;

const { data, error } = await supabase
.from("notes")
.insert([
{
contact_id: note.contactId,
type: note.type || "note",
text: note.text,
source: note.source || "manual",
data: note.data || {}
}
])
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
note: data
});
});

app.delete("/api/notes/:id", async (req, res) => {
const { id } = req.params;

const { error } = await supabase
.from("notes")
.delete()
.eq("id", id);

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true
});
});

app.put("/api/email-threads/:id/folder", async (req, res) => {
const { id } = req.params;
const { folder } = req.body;

const allowedFolders = [
"offer",
"invoice",
"appointment",
"other"
];

if (!allowedFolders.includes(folder)) {
return res.status(400).json({
ok: false,
error: "Ungültiger Zielordner."
});
}

const { data, error } = await supabase
.from("email_threads")
.update({
manual_folder: folder
})
.eq("id", id)
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
thread: data
});
});

app.get("/api/email-threads", async (req, res) => {
const { data, error } = await supabase
.from("email_threads")
.select("*")
.order("created_at", { ascending: false });

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
threads: data
});
});

app.post("/api/email-threads", async (req, res) => {
const thread = req.body;

const { data, error } = await supabase
.from("email_threads")
.insert([
{
contact_id: thread.contactId || null,
related_type: thread.relatedType || "general",
related_id: thread.relatedId || null,
subject: thread.subject || "Ohne Betreff",
status: thread.status || "open",
ai_summary: thread.aiSummary || null,
ai_category: thread.aiCategory || null
}
])
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
thread: data
});
});

app.post("/api/email-messages", async (req, res) => {
const message = req.body;

const { data: originalMessage } = await supabase
.from("email_messages")
.select("contact_id")
.eq("thread_id", threadId)
.eq("direction", "inbound")
.not("contact_id", "is", null)
.order("created_at", { ascending: true })
.limit(1)
.maybeSingle();

const matchedContact = recipient
? await findMatchingContact(recipient)
: null;

const finalContactId =
originalMessage?.contact_id ||
matchedContact?.id ||
null;

const sentEmail = await sendEmailWithGoogle({
to: recipient,
subject: replySubject,
html: body.replaceAll("\n", "<br>")
});

const { data, error } = await supabase
.from("email_messages")
.insert([
{

thread_id: message.threadId,
contact_id: matchedContact?.id || null,
direction: message.direction || "outbound",
sender: message.sender || null,
recipient: message.recipient || null,
subject: message.subject || null,
body: message.body || "",
ai_detected_intent: message.aiDetectedIntent || null,
ai_suggested_reply: message.aiSuggestedReply || null,
message_status: message.messageStatus || "sent"
}
])
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
message: data
});
});

app.get("/api/email-messages/:threadId", async (req, res) => {
const { threadId } = req.params;

const { data, error } = await supabase
.from("email_messages")
.select("*")
.eq("thread_id", threadId)
.order("created_at", { ascending: true });

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
messages: data
});
});

app.put("/api/email-messages/:id/read", async (req, res) => {
const { id } = req.params;

const { data, error } = await supabase
.from("email_messages")
.update({
read_at: new Date().toISOString()
})
.eq("id", id)
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
message: data
});
});

app.put("/api/email-messages/:id/trash", async (req, res) => {
const { id } = req.params;

const { data, error } = await supabase
.from("email_messages")
.update({
deleted_at: new Date().toISOString()
})
.eq("id", id)
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
message: data
});
});

app.post("/api/email-messages/:id/restore", async (req, res) => {
const { id } = req.params;

const { error } = await supabase
.from("email_messages")
.update({
deleted_at: null
})
.eq("id", id);

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true
});
});

app.post("/api/email-reply", async (req, res) => {
const { threadId, body, subject, recipient, fromDisplayEmail } = req.body;

if (!threadId || !body) {
return res.status(400).json({
ok: false,
error: "Thread oder Antworttext fehlt."
});
}

try {
const senderEmail =
fromDisplayEmail ||
process.env.RESEND_FROM_EMAIL;

const replySubject = subject?.startsWith("RE:")
? subject
: `RE: ${subject || "Ohne Betreff"}`;

const { data: originalMessage } = await supabase
.from("email_messages")
.select("contact_id")
.eq("thread_id", threadId)
.not("contact_id", "is", null)
.order("created_at", { ascending: true })
.limit(1)
.maybeSingle();

const matchedContact = recipient
? await findMatchingContact(recipient)
: null;

const finalContactId =
originalMessage?.contact_id ||
matchedContact?.id ||
null;

const sentEmail = await sendEmailWithGoogle({
to: recipient,
subject: replySubject,
html: body.replaceAll("\n", "<br>")
});

const { data, error } = await supabase
.from("email_messages")
.insert([
{
thread_id: threadId,
contact_id: finalContactId,
direction: "outbound",
sender: sentEmail.sender,
recipient: recipient || "kunde@example.com",
subject: replySubject,
body,
message_status: "sent"
}
])
.select()
.single();

if (error) throw error;

res.json({
ok: true,
message: data
});

} catch (error) {
console.error("EMAIL REPLY ERROR:", error);

res.status(500).json({
ok: false,
error: error.message || "Antwort konnte nicht gespeichert werden."
});
}
});

app.post("/api/ai/analyze-email", async (req, res) => {
const { messageId, body } = req.body;

if (!body) {
return res.status(400).json({
ok: false,
error: "Kein Nachrichtentext übergeben."
});
}

try {
const response = await openai.responses.create({
model: "gpt-4.1-mini",
input: [
{
role: "system",
content: `
Du bist der WorkPilot E-Mail-Assistent für Handwerks- und Dienstleistungsbetriebe.
Analysiere Kunden-E-Mails knapp und praktisch.

Antworte ausschließlich als JSON mit:
{
"intent": "question | price_negotiation | appointment | acceptance_hint | rejection_hint | general",
"summary": "kurze deutsche Zusammenfassung",
"suggestedReply": "professioneller deutscher Antwortvorschlag"
}

Wichtig:
- Setze niemals verbindlich accepted/rejected.
- Wenn Zustimmung/Ablehnung erkennbar ist, nur als Hinweis formulieren.
- Der echte Status wird nur über Kundenbuttons geändert.
`
},
{
role: "user",
content: body
}
]
});

const rawText = response.output_text;
const analysis = JSON.parse(rawText);

if (messageId) {
await supabase
.from("email_messages")
.update({
ai_detected_intent: analysis.intent,
ai_summary: analysis.summary,
ai_suggested_reply: analysis.suggestedReply
})
.eq("id", messageId);
}

res.json({
ok: true,
analysis
});
} catch (error) {
console.error("AI Fehler:", error);

res.status(500).json({
ok: false,
error: "KI-Analyse konnte nicht erstellt werden."
});
}
});

app.delete("/api/email-messages/:id", async (req, res) => {
const { id } = req.params;

const { error } = await supabase
.from("email_messages")
.delete()
.eq("id", id);

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true
});
});

async function createDashboardEvent({
type,
title,
description = "",

relatedType = null,
relatedId = null,

dueAt = null,

priority = "normal",

actionType = null,

metadata = {}
}) {

const { data: event, error } = await supabase
.from("dashboard_events")
.insert([
{
type,
title,
description,

related_type: relatedType,
related_id: relatedId,

due_at: dueAt,

priority: priority,

action_type: actionType,

metadata
}
])
.select()
.single();

if (error) {
console.error(error);
return null;
}

return event;
}

async function createDashboardNotification({
eventId,

title,

message = "",

type = "info",

priority = "normal",

remindAfterDays = 5,

metadata = {}
}) {

const { data, error } = await supabase
.from("dashboard_notifications")
.insert([
{
event_id: eventId,

title,
message,

type,

priority,

remind_after_days: remindAfterDays,

metadata
}
])
.select()
.single();

if (error) {
console.error(error);
return null;
}

return data;
}

async function triggerDashboardAction({
actionTarget,
actionPayload = {}
}) {

switch (actionTarget) {

case "create_calendar_entry":

console.log(
"Kalendereintrag vorbereiten:",
actionPayload
);

return {
ok: true,
type: "calendar",
message: "Kalendereintrag wurde vorbereitet."
};

case "create_offer_draft": {

const {
messageId,
threadId
} = actionPayload;

if (!messageId) {
return {
ok: false,
error: "Keine E-Mail für den Angebotsvorschlag gefunden."
};
}

const { data: message, error: messageError } = await supabase
.from("email_messages")
.select(`
*,
contacts (
id,
name,
email,
phone,
street,
city
)
`)
.eq("id", messageId)
.single();

if (messageError) {
throw messageError;
}

const contact = message.contacts || null;

const offerId = crypto.randomUUID();

const offerDraft = {
id: offerId,

contactId: contact?.id || message.contact_id || null,

offerNumber: `AN-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`,

status: "open",

recipientName: contact?.name || message.sender || "",
recipientStreet: contact?.street || "",
recipientCity: contact?.city || "",

offerDate: new Date().toISOString().slice(0, 10),
validUntil: "",

introText:
"vielen Dank für Ihre Anfrage. Gerne erstellen wir Ihnen folgendes Angebot:",

positions: [
{
id: `pos_${Date.now()}`,
description: message.subject || "Leistung gemäß Kundenanfrage",
quantity: "1",
unit: "Pauschal",
unitPrice: "0,00",
total: "0,00"
}
],

closingText:
"Bei Fragen stehen wir Ihnen jederzeit gerne zur Verfügung.",

source: {
type: "email",
messageId,
threadId: threadId || message.thread_id
}
};

const { data: offer, error: offerError } = await supabase
.from("offers")
.insert([
{
id: offerDraft.id,
contact_id: offerDraft.contactId,
offer_number: offerDraft.offerNumber,
status: "open",
data: offerDraft
}
])
.select()
.single();

if (offerError) {
throw offerError;
}

return {
ok: true,
type: "offer_draft",
message: "Angebotsvorschlag wurde erstellt.",
target: `/offer-editor?id=${offer.id}`,
offer
};
}

case "open_email_thread":

return {
ok: true,
type: "navigation",
target: `/emails?thread=${actionPayload.threadId}`
};

default:

return {
ok: false,
error: "Unbekannte Dashboard-Aktion."
};
}
}

app.post("/api/dashboard-actions", async (req, res) => {
const {
actionTarget,
actionPayload
} = req.body;

if (!actionTarget) {
return res.status(400).json({
ok: false,
error: "Keine Dashboard-Aktion angegeben."
});
}

try {
const result = await triggerDashboardAction({
actionTarget,
actionPayload: actionPayload || {}
});

if (!result.ok) {
return res.status(400).json(result);
}

res.json(result);

} catch (error) {
console.error("DASHBOARD ACTION ERROR:", error);

res.status(500).json({
ok: false,
error: "Dashboard-Aktion konnte nicht ausgeführt werden."
});
}
});

app.get("/api/dashboard-notifications", async (req, res) => {

const { data, error } = await supabase
.from("dashboard_notifications")
.select(`
*,
dashboard_events (
id,
type,
title,
description,
related_type,
related_id
)
`)
.is("dismissed_at", null)
.order("triggered_at", { ascending: false });

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
notifications: data || []
});
});

app.put("/api/dashboard-notifications/:id/read", async (req, res) => {
const { id } = req.params;

const { data, error } = await supabase
.from("dashboard_notifications")
.update({
status: "read",
read_at: new Date().toISOString()
})
.eq("id", id)
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
notification: data
});
});

app.put("/api/dashboard-notifications/:id/dismiss", async (req, res) => {
const { id } = req.params;

const { data, error } = await supabase
.from("dashboard_notifications")
.update({
status: "dismissed",
dismissed_at: new Date().toISOString()
})
.eq("id", id)
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
notification: data
});
});

async function processDashboardReminders() {

const now = new Date().toISOString();

const { data: notifications, error } = await supabase
.from("dashboard_notifications")
.select("*")
.eq("status", "unread")
.not("next_reminder_at", "is", null)
.lte("next_reminder_at", now);

if (error) {
console.error(error);
return;
}

for (const notification of notifications || []) {

const nextReminderDate = new Date();

nextReminderDate.setDate(
nextReminderDate.getDate() +
(notification.remind_after_days || 5)
);

await supabase
.from("dashboard_notifications")
.update({
reminder_count: (notification.reminder_count || 0) + 1,

last_reminded_at: now,

next_reminder_at: nextReminderDate.toISOString(),

priority:
notification.auto_escalate &&
(notification.reminder_count || 0) >= 2
? "high"
: notification.priority
})
.eq("id", notification.id);

console.log(
"Reminder verarbeitet:",
notification.title
);
}
}

app.get("/api/dashboard-events", async (req, res) => {
const { data, error } = await supabase
.from("dashboard_events")
.select("*")
.order("created_at", { ascending: false })
.limit(50);

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
events: data || []
});
});

app.get("/api/calendar-events", async (req, res) => {
const { data, error } = await supabase
.from("calendar_events")
.select("*")
.order("event_date", { ascending: true })
.order("event_time", { ascending: true });

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
events: data || []
});
});

app.post("/api/calendar-events", async (req, res) => {
const event = req.body;

const { data, error } = await supabase
.from("calendar_events")
.insert([
{
title: event.title,
description: event.description || "",
event_date: event.eventDate,
event_time: event.eventTime || null,
reminder_at: event.reminderAt || null,
color: event.color || "orange",
related_type: event.relatedType || null,
related_id: event.relatedId || null,
source: event.source || "manual",
metadata: event.metadata || {}
}
])
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
event: data
});
});

app.put("/api/calendar-events/:id", async (req, res) => {
const { id } = req.params;
const event = req.body;

const { data, error } = await supabase
.from("calendar_events")
.update({
title: event.title,
description: event.description || "",
event_date: event.eventDate,
event_time: event.eventTime || null,
reminder_at: event.reminderAt || null,
color: event.color || "orange",
status: event.status || "open",
metadata: event.metadata || {},
updated_at: new Date().toISOString()
})
.eq("id", id)
.select()
.single();

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
event: data
});
});

app.delete("/api/calendar-events/:id", async (req, res) => {
const { id } = req.params;

const { error } = await supabase
.from("calendar_events")
.delete()
.eq("id", id);

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true
});
});

async function findMatchingContact(email, name = "") {

if (!email) return null;

const { data: contacts, error } = await supabase
.from("contacts")
.select("*")
.ilike("email", email)
.limit(1);

if (error) {
console.error(error);
return null;
}

if (!contacts?.length) {
return null;
}

return contacts[0];
}

function getFallbackEmailAnalysis(message) {
return {
category: "other",
intent: "other",
summary: "Neue E-Mail konnte nicht automatisch analysiert werden.",
suggestedReply:
"Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Nachricht. Wir prüfen Ihr Anliegen und melden uns zeitnah bei Ihnen zurück.\n\nMit freundlichen Grüßen\nIhr WorkPilot-Team",
dashboardTitle: "Neue E-Mail eingegangen",
dashboardMessage: "Eine neue E-Mail wurde empfangen und muss geprüft werden.",
actionLabel: "E-Mail öffnen",
actionTarget: "open_email_thread",
priority: "normal",
calendarSuggestion: null
};
}

async function saveEmailAnalysis(message, thread, analysis) {
await supabase
.from("email_messages")
.update({
ai_detected_intent: analysis.intent,
ai_summary: analysis.summary,
ai_suggested_reply: analysis.suggestedReply,
calendar_suggestion: analysis.calendarSuggestion
})
.eq("id", message.id);

await supabase
.from("email_threads")
.update({
related_type: analysis.category,
ai_category: analysis.category,
ai_summary: analysis.summary
})
.eq("id", thread.id);

const dashboardEvent = await createDashboardEvent({
type: "email_ai_analysis",
title: analysis.dashboardTitle || "E-Mail analysiert",
description: analysis.dashboardMessage || analysis.summary || "",
relatedType: "email",
relatedId: message.id,
priority: analysis.priority || "normal",
actionType: analysis.actionTarget || "open_email_thread",
metadata: {
threadId: thread.id,
messageId: message.id,
category: analysis.category || "other",
intent: analysis.intent || "other",
calendarSuggestion: analysis.calendarSuggestion || null
}
});

if (dashboardEvent) {
await createDashboardNotification({
eventId: dashboardEvent.id,
title: analysis.dashboardTitle || "Neue E-Mail erkannt",
message: analysis.dashboardMessage || "Eine neue E-Mail wurde analysiert.",
type: "email",
priority: analysis.priority || "normal",
metadata: {
threadId: thread.id,
messageId: message.id,
actionLabel: analysis.actionLabel || "E-Mail öffnen",
actionTarget: analysis.actionTarget || "open_email_thread",
calendarSuggestion: analysis.calendarSuggestion || null
}
});
}
}

async function analyzeInboundEmail(message, thread) {
let response;

try {
response = await openai.responses.create({
model: "gpt-4.1-mini",
input: [
{
role: "system",
content: `
Du bist der interne E-Mail-Agent von WorkPilot für Handwerksbetriebe.

Analysiere eingehende Kunden-E-Mails.

Antworte ausschließlich als JSON:
{
"category": "offer | invoice | appointment | question | other",
"intent": "offer_request | invoice_question | appointment | complaint | general_question | other",
"summary": "kurze interne Zusammenfassung",
"suggestedReply": "professioneller deutscher Antwortvorschlag",
"dashboardTitle": "kurzer Dashboard-Titel",
"dashboardMessage": "kurzer Dashboard-Hinweis",
"actionLabel": "Button-Text oder null",
"actionTarget": "create_offer_draft | create_calendar_event | open_email_thread | null",
"priority": "low | normal | high",
"calendarSuggestion": {
"title": "kurzer Termintitel oder null",
"date": "YYYY-MM-DD oder null",
"time": "HH:MM oder null",
"description": "kurze Beschreibung oder null"
}
}

Regeln:
- Führe keine Aktion automatisch aus.
- Bei Angebotsanfragen category = "offer".
- Bei Rechnungsfragen category = "invoice".
- Bei einfachen Rückfragen ohne Angebot, Rechnung oder Termin setze category = "question".
- Wenn unsicher, category = "other".
- Halte alles kurz und sachlich.
- Wenn ein konkreter Termin, ein Datum oder eine Uhrzeit erkennbar ist, setze intent = "appointment".
- Wenn ein Termin erkennbar ist, setze actionTarget = "create_calendar_event".
- Wenn ein Termin erkennbar ist, setze actionLabel = "Termin erstellen".
- calendarSuggestion.date muss im Format YYYY-MM-DD sein.
- calendarSuggestion.time muss im Format HH:MM sein oder null.
- Wenn kein Datum sicher erkennbar ist, calendarSuggestion.date = null.
- calendarSuggestion.title soll ein kurzer sinnvoller Titel sein, z. B. "Vor-Ort-Termin Patrick Müller" oder "Besichtigung Terrasse".
- calendarSuggestion.description soll Adresse, Kontext und Kundenwunsch kurz enthalten.
- Uhrzeiten wie "gegen 14 Uhr" müssen als "14:00" erkannt werden.
- suggestedReply ist Pflicht. Liefere immer einen professionellen deutschen Antwortvorschlag. suggestedReply darf niemals null oder leer sein.
- Wenn im Betreff oder Text "Rechnung", "RE-", "Rechnungsnummer", "Zahlung", "Überweisung", "Mahnung" oder "Position" im Zusammenhang mit einer Rechnung vorkommt, setze category = "invoice" und intent = "invoice_question".
- Wenn ein konkretes Datum, eine Uhrzeit, "Termin", "Vor-Ort", "Besichtigung", "Rückruf", "Telefonat" oder "vorbeikommen" vorkommt, setze category = "appointment" und intent = "appointment".
- Wenn Angebot und Termin gleichzeitig vorkommen, entscheide category nach dem Hauptanliegen der Mail. Setze aber trotzdem intent = "appointment", wenn ein konkreter Termin erkennbar ist.
- Wenn ein Angebot/Kostenvoranschlag/Preis/Leistungsänderung klar vorkommt, setze category = "offer".
calendarSuggestion.description soll lesbar mit Zeilenumbrüchen formatiert sein.

Wenn eine Adresse vorhanden ist, schreibe sie separat.

Beispiel:

"Kunde wünscht Vor-Ort-Besichtigung wegen Garagendach-Sanierung.

Adresse:
Musterstraße 12
55116 Mainz"

Kopiere niemals die komplette E-Mail.
Beschreibung kurz halten (maximal 1-3 Sätze).
Lass eine Zeile Abstand zwischen Beschreibung und Adresse.

Datum und Uhrzeit nicht wiederholen, wenn calendarSuggestion.date oder calendarSuggestion.time bereits gesetzt sind.
`
},
{
role: "user",
content: `
Von: ${message.sender}
An: ${message.recipient}
Betreff: ${message.subject}

Nachricht:
${message.body}
`
}
]
});

const analysis = JSON.parse(response.output_text);

const safeAnalysis = {
...getFallbackEmailAnalysis(message),
...analysis,
calendarSuggestion: analysis.calendarSuggestion || null
};

console.log("EMAIL AI RAW:", response.output_text);
console.log("EMAIL AI PARSED:", safeAnalysis);

await saveEmailAnalysis(message, thread, safeAnalysis);

return safeAnalysis;

} catch (error) {
console.error("EMAIL AGENT ERROR:", error);
console.error("EMAIL AI RAW FAILED:", response?.output_text);

const fallbackAnalysis = getFallbackEmailAnalysis(message);

await saveEmailAnalysis(message, thread, fallbackAnalysis);

return fallbackAnalysis;
}
}

async function createOfferPdfBuffer(offerId, baseUrl) {
const browser = await puppeteer.launch({
headless: "new",
args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

try {
const page = await browser.newPage();

const pdfUrl = `${baseUrl}/offer-editor?id=${offerId}&pdf=1`;
console.log("PDF URL:", pdfUrl);

await page.goto(pdfUrl, {
waitUntil: "domcontentloaded",
timeout: 20000
});

await page.waitForSelector("#offerDocument .offerPage", {
timeout: 20000
});

await new Promise((resolve) => setTimeout(resolve, 1000));

await page.emulateMediaType("screen");

const pdfData = await page.pdf({
format: "A4",
printBackground: true,
margin: {
top: "0mm",
right: "0mm",
bottom: "0mm",
left: "0mm"
}
});

return Buffer.from(pdfData);
} finally {
await browser.close();
}
}

async function createInvoicePdfBuffer(invoiceId, baseUrl) {
const browser = await puppeteer.launch({
headless: "new",
args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

try {
const page = await browser.newPage();

const pdfUrl = `${baseUrl}/invoice-editor?id=${invoiceId}&pdf=1`;

console.log("INVOICE PDF URL:", pdfUrl);

await page.goto(pdfUrl, {
waitUntil: "domcontentloaded",
timeout: 10000
});

await page.waitForSelector("#offerDocument .offerPage", {
timeout: 20000
});

await page.emulateMediaType("screen");

const pdfData = await page.pdf({
format: "A4",
printBackground: true,
margin: {
top: "0mm",
right: "0mm",
bottom: "0mm",
left: "0mm"
}
});

return Buffer.from(pdfData);
} finally {
await browser.close();
}
}

app.post("/api/send-offer-email", async (req, res) => {
const { offerId, to, subject, message } = req.body;

if (!offerId || !to || !subject || !message) {
return res.status(400).json({
ok: false,
error: "Fehlende Daten für den Angebotsversand."
});
}

try {
const { data: offerRow, error: offerError } = await supabase
.from("offers")
.select("*")
.eq("id", offerId)
.single();

if (offerError) {
throw offerError;
}

const offer = {
...offerRow.data,
id: offerRow.id,
contactId: offerRow.contact_id,
status: offerRow.status,
offerNumber: offerRow.offer_number
};

const { data: thread, error: threadError } = await supabase
.from("email_threads")
.insert([
{
contact_id: offer.contactId || null,
related_type: "offer",
related_id: offer.id,
subject,
status: "sent",
ai_category: "Angebot"
}
])
.select()
.single();

if (threadError) {
throw threadError;
}

const baseUrl = `https://${req.get("host")}`;
const pdfBuffer = await createOfferPdfBuffer(offer.id, baseUrl);

const html = `
<div style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #111827;">
<p>${message.replaceAll("\n", "<br>")}</p>

<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />

<p style="font-size: 12px; color: #6b7280;">
Gesendet über WorkPilot
</p>
</div>
`;

console.log("PDF BUFFER CHECK:", {
isBuffer: Buffer.isBuffer(pdfBuffer),
size: pdfBuffer.length,
header: Buffer.from(pdfBuffer).slice(0, 5).toString()
});

const email = await resend.emails.send({
from: `WorkPilot <${process.env.RESEND_FROM_EMAIL}>`,
to,
subject,
html,
attachments: [
{
filename: `Angebot-${offer.offerNumber || offer.id}.pdf`,

content:Buffer.from(pdfBuffer).toString("base64")
}
]
});

await supabase
.from("email_messages")
.insert([
{
thread_id: thread.id,
direction: "outbound",
sender: process.env.RESEND_FROM_EMAIL,
recipient: to,
subject,
body: html,
message_status: "sent"
}
]);

await createDashboardEvent({
type: "offer_email_sent",
title: "Angebot versendet",
description: `Angebot ${offer.offerNumber || offer.id} wurde an ${to} gesendet.`,
relatedType: "offer",
relatedId: offer.id
});

res.json({
ok: true,
email
});
} catch (error) {
console.error("SEND OFFER EMAIL ERROR:", error);

res.status(500).json({
ok: false,
error: "Angebot konnte nicht per E-Mail gesendet werden."
});
}
});

app.post("/api/send-invoice-email", async (req, res) => {
const { invoiceId, to, subject, message } = req.body;

if (!invoiceId || !to || !subject || !message) {
return res.status(400).json({
ok: false,
error: "Fehlende Daten für den Rechnungsversand."
});
}

try {
const { data: invoiceRow, error: invoiceError } = await supabase
.from("invoices")
.select("*")
.eq("id", invoiceId)
.single();

if (invoiceError) {
throw invoiceError;
}

const invoice = {
...invoiceRow.data,
id: invoiceRow.id,
contactId: invoiceRow.contact_id,
status: invoiceRow.status,
invoiceNumber: invoiceRow.invoice_number
};

const { data: thread, error: threadError } = await supabase
.from("email_threads")
.insert([
{
contact_id: invoice.contactId || null,
related_type: "invoice",
related_id: invoice.id,
subject,
status: "sent",
ai_category: "Rechnung"
}
])
.select()
.single();

if (threadError) {
throw threadError;
}

const baseUrl = `${req.protocol}://${req.get("host")}`;
const pdfBuffer = await createInvoicePdfBuffer(invoice.id, baseUrl);

const html = `
<div style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #111827;">
<p>${message.replaceAll("\n", "<br>")}</p>

<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />

<p style="font-size: 12px; color: #6b7280;">
Gesendet über WorkPilot
</p>
</div>
`;

const email = await resend.emails.send({
from: `WorkPilot <${process.env.RESEND_FROM_EMAIL}>`,
to,
subject,
html,
attachments: [
{
filename: `Rechnung-${invoice.invoiceNumber || invoice.id}.pdf`,
content: Buffer.from(pdfBuffer).toString("base64")
}
]
});

await supabase
.from("email_messages")
.insert([
{
thread_id: thread.id,
direction: "outbound",
sender: process.env.RESEND_FROM_EMAIL,
recipient: to,
subject,
body: html,
message_status: "sent"
}
]);

await createDashboardEvent({
type: "invoice_email_sent",
title: "Rechnung versendet",
description: `Rechnung ${invoice.invoiceNumber || invoice.id} wurde an ${to} gesendet.`,
relatedType: "invoice",
relatedId: invoice.id
});

res.json({
ok: true,
email
});
} catch (error) {
console.error("SEND INVOICE EMAIL ERROR:", error);

res.status(500).json({
ok: false,
error: "Rechnung konnte nicht per E-Mail gesendet werden."
});
}
});

app.post("/api/send-email", upload.array("attachments"), async (req, res) => {
const { to, subject, html, threadId, fromDisplayEmail } = req.body;
const uploadedFiles = req.files || [];

if (!to || !subject || !html) {
return res.status(400).json({
ok: false,
error: "Fehlende E-Mail-Daten."
});
}

const senderEmail =
fromDisplayEmail ||
process.env.RESEND_FROM_EMAIL;

try {
let finalThreadId = threadId;

if (!finalThreadId) {
const { data: thread, error: threadError } = await supabase
.from("email_threads")
.insert([
{
subject,
related_type: "general",
status: "sent",
ai_category: "Sonstiges"
}
])
.select()
.single();

if (threadError) throw threadError;

finalThreadId = thread.id;
}

const resendAttachments = uploadedFiles.map((file) => ({
filename: file.originalname,
content: file.buffer.toString("base64")
}));

const email = await sendEmailWithGoogle({
to,
subject,
html
});

const matchedContact = await findMatchingContact(to);

const { data: message, error: messageError } = await supabase
.from("email_messages")
.insert([
{
thread_id: finalThreadId,
contact_id: matchedContact?.id || null,
direction: "outbound",
sender: email.sender,
recipient: to,
subject,
body: html,
message_status: "sent"
}
])
.select()
.single();

if (messageError) throw messageError;

await createDashboardEvent({
type: "email_sent",
title: "E-Mail gesendet",
description: `E-Mail an ${to}: ${subject}`,
relatedType: "email",
relatedId: message.id
});

for (const file of uploadedFiles) {
const filePath = `${message.id}/${Date.now()}-${file.originalname}`;

const { error: uploadError } = await supabase.storage
.from("email-attachments")
.upload(filePath, file.buffer, {
contentType: file.mimetype,
upsert: false
});

if (uploadError) throw uploadError;

const { error: attachmentError } = await supabase
.from("email_attachments")
.insert([
{
message_id: message.id,
file_name: file.originalname,
file_size: file.size,
file_path: filePath
}
]);

if (attachmentError) throw attachmentError;
}

res.json({
ok: true,
email,
message
});

} catch (error) {
console.error("SEND EMAIL ERROR:", error);

res.status(500).json({
ok: false,
error: "E-Mail konnte nicht gesendet werden."
});
}
});

app.post("/api/email-inbound", async (req, res) => {

const {
from,
to,
subject,
html,
text
} = req.body;

if (!from || !to) {
return res.status(400).json({
ok: false,
error: "Fehlende Inbound-Daten."
});
}

try {

const matchedContact = await findMatchingContact(from);

const finalBody = html || text || "";

const { data: thread, error: threadError } = await supabase
.from("email_threads")
.insert([
{
contact_id: matchedContact?.id || null,

subject: subject || "Ohne Betreff",

related_type: "general",

status: "open",

ai_category: "Unsortiert"
}
])
.select()
.single();

if (threadError) {
throw threadError;
}

const { data: message, error: messageError } = await supabase
.from("email_messages")
.insert([
{
thread_id: thread.id,

contact_id: matchedContact?.id || null,

direction: "inbound",

sender: from,
recipient: to,

subject: subject || "Ohne Betreff",

body: finalBody,

message_status: "received"
}
])
.select()
.single();

if (messageError) {
throw messageError;
}

await analyzeInboundEmail(message, thread);

const dashboardEvent = await createDashboardEvent({
type: "email_received",

title: "Neue E-Mail empfangen",

description: `${from}: ${subject || "Ohne Betreff"}`,

relatedType: "email",
relatedId: message.id,

priority: "normal",

actionType: "open_email_thread",

metadata: {
threadId: thread.id
}
});

res.json({
ok: true,
message
});

} catch (error) {

console.error("INBOUND EMAIL ERROR:", error);

res.status(500).json({
ok: false,
error: "Inbound-E-Mail konnte nicht verarbeitet werden."
});
}
});

async function importSingleGoogleMessage(gmail, gmailMessageId) {
const detailResponse = await gmail.users.messages.get({
userId: "me",
id: gmailMessageId,
format: "metadata",
metadataHeaders: ["From", "To", "Subject", "Date"]
});

const messageData = detailResponse.data;
const headers = messageData.payload?.headers || [];

const getHeader = (name) => {
const found = headers.find((header) =>
header.name.toLowerCase() === name.toLowerCase()
);

return found?.value || "";
};

const sender = getHeader("From");
const recipient = getHeader("To");
const subject = getHeader("Subject") || "Ohne Betreff";
const dateHeader = getHeader("Date");

const createdAt = dateHeader
? new Date(dateHeader).toISOString()
: new Date().toISOString();

const gmailThreadId = messageData.threadId;
const gmailMessageIdFinal = messageData.id;

const { data: existingMessage } = await supabase
.from("email_messages")
.select("id")
.eq("external_message_id", gmailMessageIdFinal)
.maybeSingle();

if (existingMessage) {
return null;
}

let { data: thread } = await supabase
.from("email_threads")
.select("*")
.eq("external_thread_id", gmailThreadId)
.maybeSingle();

if (!thread) {
const { data: newThread, error: threadError } = await supabase
.from("email_threads")
.insert([
{
subject,
related_type: "gmail",
related_id: gmailThreadId,
status: "open",
ai_category: "Importiert",
manual_folder: "inbox",
external_thread_id: gmailThreadId
}
])
.select()
.single();

if (threadError) throw threadError;

thread = newThread;
}

const matchedContact = await findMatchingContact(sender);

const { data: message, error: messageError } = await supabase
.from("email_messages")
.insert([
{
thread_id: thread.id,
contact_id: matchedContact?.id || null,
direction: "inbound",
sender,
recipient,
subject,
body: messageData.snippet || "",
message_status: "received",
external_message_id: gmailMessageIdFinal,
external_thread_id: gmailThreadId,
created_at: createdAt
}
])
.select()
.single();

if (messageError) throw messageError;

await analyzeInboundEmail(message, thread);

return message;
}

app.post("/api/gmail/webhook", async (req, res) => {
try {

const message = req.body?.message;

if (!message?.data) {
return res.status(200).json({
ok: true
});
}

const payload = JSON.parse(
Buffer.from(message.data, "base64").toString("utf8")
);

console.log("GMAIL PAYLOAD:", payload);

const historyId = payload.historyId;
const emailAddress = payload.emailAddress;

const { auth, mailbox } = await getActiveGoogleMailboxAuth();

const gmail = google.gmail({
  version: "v1",
  auth
});

const startHistoryId =
mailbox.gmail_history_id ||
historyId;

const historyResponse = await gmail.users.history.list({
  userId: "me",
  startHistoryId: startHistoryId,
  historyTypes: ["messageAdded"]
});

const history = historyResponse.data.history || [];

for (const entry of history) {

  const addedMessages = entry.messagesAdded || [];

  for (const added of addedMessages) {

    await importSingleGoogleMessage(
      gmail,
      added.message.id
    );

  }

}

await supabase
.from("mailbox_connections")
.update({
  gmail_history_id: String(historyId),
  updated_at: new Date().toISOString()
})
.eq("id", mailbox.id);

console.log("HISTORY ID:", historyId);
console.log("EMAIL:", emailAddress);

res.status(200).json({
ok: true
});

} catch (error) {

console.error("WEBHOOK ERROR:", error);

res.status(200).json({
ok: false
});

}
});

app.get("/api/email-inbox", async (req, res) => {
const { data, error } = await supabase
.from("email_messages")
.select(`
*,
email_threads (
id,
subject,
related_type,
related_id,
status,
ai_category,
manual_folder
)
`)
.order("created_at", { ascending: false });

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
messages: data || []
});
});

app.get("/api/email-messages/:id/attachments", async (req, res) => {
const { id } = req.params;

const { data, error } = await supabase
.from("email_attachments")
.select("*")
.eq("message_id", id)
.order("created_at", { ascending: true });

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
attachments: data || []
});
});

app.get("/api/email-attachments/:id/open", async (req, res) => {
const { id } = req.params;

const { data: attachment, error: attachmentError } = await supabase
.from("email_attachments")
.select("*")
.eq("id", id)
.single();

if (attachmentError) {
return res.status(500).json({
ok: false,
error: attachmentError.message
});
}

const { data, error } = await supabase.storage
.from("email-attachments")
.createSignedUrl(attachment.file_path, 60 * 5);

if (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
url: data.signedUrl
});
});

app.get("/calendar-create", (req, res) => {
res.sendFile(
path.join(
__dirname,
"public",
"html",
"calendar-create.html"
)
);
});

app.get("/calendar-edit", (req, res) => {
res.sendFile(
path.join(
__dirname,
"public",
"html",
"calendar-edit.html"
)
);
});

app.get("/api/calendar-events/:id", async (req, res) => {
const { id } = req.params;

const { data, error } = await supabase
.from("calendar_events")
.select("*")
.eq("id", id)
.single();

if (error) {
return res.status(404).json({
ok: false,
error: error.message
});
}

res.json({
ok: true,
event: data
});
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/contacts", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "index.html"));
});

app.get("/contact-create", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "contact-create.html"));
});

app.get("/note-create", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "note-create.html"));
});

app.get("/login", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "login.html"));
});

app.get("/settings", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "settings.html"));
});

app.get("/offer-create", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "offer-create.html"));
});

app.get("/offers", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "offers.html"));
});

app.get("/offer-editor", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "offer-editor.html"));
});

app.get("/contact-detail", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "contact-detail.html"));
});

app.get("/invoices", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "invoices.html"));
});

app.get("/invoice-create", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "invoice-create.html"));
});

app.get("/invoice-editor", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "invoice-editor.html"));
});

app.get("/emails", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "emails.html"));
});

app.get("/", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "dashboard.html"));
});

app.use((req, res) => {
console.log("404 ROUTE:", req.method, req.url);
res.status(404).json({
ok: false,
message: "Route nicht gefunden",
path: req.url
});
});

app.listen(PORT, async () => {
console.log(`WorkPilot läuft auf Port ${PORT}`);
});
