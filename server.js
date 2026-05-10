const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

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
