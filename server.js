const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const puppeteer = require("puppeteer");

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

app.post("/api/contacts", async (req, res) => {
const { name, email, phone, street, city } = req.body;

const { data, error } = await supabase
.from("contacts")
.insert([
{
name,
email,
phone,
street,
city
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
contact: data
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

app.post("/api/offers", async (req, res) => {
const offer = req.body;

const { data, error } = await supabase
.from("offers")
.insert([
{
id: offer.id,
contact_id: offer.contactId || null,
offer_number: offer.offerNumber || null,
status: offer.status || "open",
data: offer
}
])
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
sender: "mail@workpilot-app.de",
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
from: "WorkPilot <mail@workpilot-app.de>",
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
sender: "mail@workpilot-app.de",
recipient: to,
subject,
body: html,
message_status: "sent"
}
]);

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
from: "WorkPilot <mail@workpilot-app.de>",
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
sender: "mail@workpilot-app.de",
recipient: to,
subject,
body: html,
message_status: "sent"
}
]);

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

app.post("/api/send-invoice-email", async (req, res) => {
// invoiceId, to, subject, message
});

app.post("/api/send-email", async (req, res) => {
const {
to,
subject,
html,
threadId,
attachments
} = req.body;

if (!to || !subject || !html) {
return res.status(400).json({
ok: false,
error: "Fehlende E-Mail-Daten."
});
}

try {

const email = await resend.emails.send({
from: "WorkPilot <mail@workpilot-app.de>",
to,
subject,
html,

attachments: attachments || []
});

if (threadId) {
await supabase
.from("email_messages")
.insert([
{
thread_id: threadId,
direction: "outbound",
sender: "workpilot@example.com",
recipient: to,
subject,
body: html,
message_status: "sent"
}
]);
}

res.json({
ok: true,
email
});

} catch (error) {
console.error("RESEND ERROR:", error);

res.status(500).json({
ok: false,
error: "E-Mail konnte nicht gesendet werden."
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

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
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
