const contactCreateForm = document.getElementById("contactCreateForm");
const pageTitle = document.getElementById("pageTitle");
const saveContactBtn = document.getElementById("saveContactBtn");

const contactName = document.getElementById("contactName");
const contactEmail = document.getElementById("contactEmail");
const contactPhone = document.getElementById("contactPhone");
const contactStreet = document.getElementById("contactStreet");
const contactCity = document.getElementById("contactCity");

function getContactIdFromUrl() {
const params = new URLSearchParams(window.location.search);
return params.get("id");
}

async function apiGetContact(contactId) {
const response = await fetch(`/api/contacts/${contactId}`);
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakt konnte nicht geladen werden.");
}

return result.contact;
}

async function apiCreateContact(contact) {
const response = await fetch("/api/contacts", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(contact)
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakt konnte nicht gespeichert werden.");
}

return result.contact;
}

async function apiUpdateContact(contactId, contact) {
const response = await fetch(`/api/contacts/${contactId}`, {
method: "PUT",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(contact)
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakt konnte nicht aktualisiert werden.");
}

return result.contact;
}

function fillForm(contact) {
contactName.value = contact.name || "";
contactEmail.value = contact.email || "";
contactPhone.value = contact.phone || "";
contactStreet.value = contact.street || "";
contactCity.value = contact.city || "";
}

function getFormData() {
return {
name: contactName.value.trim(),
email: contactEmail.value.trim(),
phone: contactPhone.value.trim(),
street: contactStreet.value.trim(),
city: contactCity.value.trim()
};
}

async function initContactCreate() {
const contactId = getContactIdFromUrl();

if (!contactId) {
pageTitle.textContent = "Kontakt erstellen";
saveContactBtn.textContent = "Kontakt speichern";
return;
}

pageTitle.textContent = "Kontakt bearbeiten";
saveContactBtn.textContent = "Kontakt aktualisieren";

try {
const contact = await apiGetContact(contactId);
fillForm(contact);
} catch (error) {
showToast(error.message);
window.location.href = "/contacts";
}
}

contactCreateForm.addEventListener("submit", async (event) => {
event.preventDefault();

const contactId = getContactIdFromUrl();
const contact = getFormData();

if (!contact.name) {
showToast("Bitte einen Namen eingeben.");
return;
}

saveContactBtn.disabled = true;

try {
let savedContact;

if (contactId) {
savedContact = await apiUpdateContact(contactId, contact);
sessionStorage.setItem("workpilot_toast", "Kontaktdaten wurden aktualisiert.");
} else {
savedContact = await apiCreateContact(contact);
sessionStorage.setItem("workpilot_toast", "Kontakt wurde erstellt.");
}

window.location.href = `/contact-detail?id=${savedContact.id}`;

} catch (error) {
showToast(error.message);
} finally {
saveContactBtn.disabled = false;
}
});

document.addEventListener("DOMContentLoaded", initContactCreate);
