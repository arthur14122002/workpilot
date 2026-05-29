const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const puppeteer = require("puppeteer");
const multer = require("multer");
const crypto = require("crypto");

const upload = multer({
storage: multer.memoryStorage()
});

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json());

app.use((req, res, next) => {
console.log("REQUEST:", req.method, req.url);
next();
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

const { data, error } = await supabase
.from("email_messages")
.insert([
{
thread_id: message.threadId,
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
const { threadId, body, subject, recipient } = req.body;

if (!threadId || !body) {
return res.status(400).json({
ok: false,
error: "Thread oder Antworttext fehlt."
});
}

const replySubject = subject?.startsWith("RE:")
? subject
: `RE: ${subject || "Ohne Betreff"}`;

const { data, error } = await supabase
.from("email_messages")
.insert([
{
thread_id: threadId,
direction: "outbound",
sender: process.env.RESEND_FROM_EMAIL,
recipient: recipient || "kunde@example.com",
subject: replySubject,
body,
message_status: "sent"
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

async function analyzeInboundEmail(message, thread) {
try {
const response = await openai.responses.create({
model: "gpt-4.1-mini",
input: [
{
role: "system",
content: `
Du bist der interne E-Mail-Agent von WorkPilot für Handwerksbetriebe.

Analysiere eingehende Kunden-E-Mails.

Antworte ausschließlich als JSON:
{
"category": "offer | invoice | question | other",
"intent": "offer_request | invoice_question | appointment | complaint | general_question | other",
"summary": "kurze interne Zusammenfassung",
"suggestedReply": "professioneller deutscher Antwortvorschlag",
"dashboardTitle": "kurzer Dashboard-Titel",
"dashboardMessage": "kurzer Dashboard-Hinweis",
"actionLabel": "Button-Text oder null",
"actionTarget": "create_offer_draft | open_email_thread | null",
"priority": "low | normal | high"
}

Regeln:
- Führe keine Aktion automatisch aus.
- Bei Angebotsanfragen category = "offer".
- Bei Rechnungsfragen category = "invoice".
- Bei einfachen Rückfragen category = "question".
- Wenn unsicher, category = "other".
- Halte alles kurz und sachlich.
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

await supabase
.from("email_messages")
.update({
ai_detected_intent: analysis.intent || null,
ai_summary: analysis.summary || null,
ai_suggested_reply: analysis.suggestedReply || null
})
.eq("id", message.id);

await supabase
.from("email_threads")
.update({
related_type: analysis.category || "other",
ai_category: analysis.category || "other",
ai_summary: analysis.summary || null
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
intent: analysis.intent || "other"
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
actionTarget: analysis.actionTarget || "open_email_thread"
}
});
}

return analysis;

} catch (error) {
console.error("EMAIL AGENT ERROR:", error);
return null;
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
const { to, subject, html, threadId } = req.body;
const uploadedFiles = req.files || [];

if (!to || !subject || !html) {
return res.status(400).json({
ok: false,
error: "Fehlende E-Mail-Daten."
});
}

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

const email = await resend.emails.send({
from: `WorkPilot <${process.env.RESEND_FROM_EMAIL}>`,
to,
subject,
html,
attachments: resendAttachments
});

const matchedContact = await findMatchingContact(to);

const { data: message, error: messageError } = await supabase
.from("email_messages")
.insert([
{
thread_id: finalThreadId,
contact_id: matchedContact?.id || null,
direction: "outbound",
sender: process.env.RESEND_FROM_EMAIL,
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
ai_category
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

app.use(express.static(path.join(__dirname, "public")));

app.get("/contacts", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "index.html"));
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
