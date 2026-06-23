const STORAGE_KEY = "workpilot_company_settings";
const DASHBOARD_PROFILE_KEY = "workpilot_dashboard_profile";

const settingsForm = document.getElementById("settingsForm");
const resetBtn = document.getElementById("resetSettingsBtn");
const emailVerificationStatus =
document.getElementById("emailVerificationStatus");

const phoneVerificationStatus =
document.getElementById("phoneVerificationStatus");

const verifyEmailBtn =
document.getElementById("verifyEmailBtn");

const verifyPhoneBtn =
document.getElementById("verifyPhoneBtn");

function getSavedSettings() {
try {
return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
} catch {
return {};
}

function getFormData() {
const existingSettings = getSavedSettings();

return {
firstName: document.getElementById("firstName").value.trim(),
lastName: document.getElementById("lastName").value.trim(),
personalEmail: document.getElementById("personalEmail").value.trim(),
personalPhone: document.getElementById("personalPhone").value.trim(),
communicationEmailVerified: existingSettings.communicationEmailVerified || false,
communicationPhoneVerified: existingSettings.communicationPhoneVerified || false,

companyName: document.getElementById("companyName").value.trim(),
ownerName: document.getElementById("ownerName").value.trim(),
street: document.getElementById("street").value.trim(),
city: document.getElementById("city").value.trim(),
phone: document.getElementById("phone").value.trim(),
email: document.getElementById("email").value.trim(),
website: document.getElementById("website").value.trim(),
taxId: document.getElementById("taxId").value.trim(),
bankName: document.getElementById("bankName").value.trim(),
iban: document.getElementById("iban").value.trim(),
bic: document.getElementById("bic").value.trim(),
vatRate: document.getElementById("vatRate").value,
paymentTerm: document.getElementById("paymentTerm").value.trim(),
footerNote: document.getElementById("footerNote").value.trim()
};
}

function getDashboardGreetingName(data) {
return data.firstName || "";
}

function getCommunicationSettings() {
const saved = localStorage.getItem(STORAGE_KEY);

if (!saved) {
return null;
}

try {
const data = JSON.parse(saved);

return {
personalName: `${data.firstName || ""} ${data.lastName || ""}`.trim(),

communicationEmail: data.personalEmail || "",
communicationPhone: data.personalPhone || "",

companyEmail: data.email || "",
companyPhone: data.phone || "",

companyName: data.companyName || ""
};

} catch (error) {
console.error(error);
return null;
}
}

function fillForm(data) {
Object.keys(data).forEach((key) => {
const field = document.getElementById(key);
if (field) field.value = data[key] || "";
});
}

function loadSettings() {
const saved = localStorage.getItem(STORAGE_KEY);
if (!saved) return;

try {
const data = JSON.parse(saved);
fillForm(data);
updateVerificationUi(data);
} catch (error) {
console.error("Firmendaten konnten nicht geladen werden:", error);
}
}

function updateVerificationUi(data = {}) {
if (emailVerificationStatus) {
const verified = data.communicationEmailVerified === true;

emailVerificationStatus.textContent = verified
? "Verifiziert"
: "Nicht verifiziert";

emailVerificationStatus.classList.toggle("verified", verified);
emailVerificationStatus.classList.toggle("pending", !verified);
}

if (phoneVerificationStatus) {
const verified = data.communicationPhoneVerified === true;

phoneVerificationStatus.textContent = verified
? "Verifiziert"
: "Nicht verifiziert";

phoneVerificationStatus.classList.toggle("verified", verified);
phoneVerificationStatus.classList.toggle("pending", !verified);
}
}

function saveSettings(event) {
event.preventDefault();

const data = getFormData();
localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

localStorage.setItem(
DASHBOARD_PROFILE_KEY,
JSON.stringify({
greetingName: getDashboardGreetingName(data),
firstName: data.firstName,
lastName: data.lastName
})
);

updateVerificationUi(data);
showToast("Firmendaten wurden gespeichert.");
}

function resetSettings() {
localStorage.removeItem(STORAGE_KEY);
settingsForm.reset();

showToast("Firmendaten wurden zurückgesetzt.");
}

settingsForm.addEventListener("submit", saveSettings);
resetBtn.addEventListener("click", resetSettings);

if (verifyEmailBtn) {
verifyEmailBtn.addEventListener("click", () => {
showToast("E-Mail-Verifizierung kommt im nächsten Schritt.");
});
}

if (verifyPhoneBtn) {
verifyPhoneBtn.addEventListener("click", () => {
showToast("Telefon-Verifizierung wird für den Telefonagenten vorbereitet.");
});
}

document.addEventListener("DOMContentLoaded", loadSettings);

window.getCommunicationSettings = getCommunicationSettings;
