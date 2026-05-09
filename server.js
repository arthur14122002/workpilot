const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());
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
res.sendFile(path.join(__dirname, "public/html/offers.html"));
});

app.get("/offer-editor", (req, res) => {
res.sendFile(path.join(__dirname, "public", "html", "offer-editor.html"));
});

app.get("/contact-detail", (req, res) => {
res.sendFile(path.join(__dirname, "public/html/contact-detail.html"));
});

app.get("/invoices", (req, res) => {
res.sendFile(path.join(__dirname, "public/html/invoices.html"));
});

app.get("/invoice-create", (req, res) => {
res.sendFile(path.join(__dirname, "public/html/invoice-create.html"));
});

app.get("/invoice-editor", (req, res) => {
res.sendFile(path.join(__dirname, "public/html/invoice-editor.html"));
});

app.listen(PORT, () => {
console.log(`WorkPilot läuft auf http://localhost:${PORT}`);
});