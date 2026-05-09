const STORAGE_KEY = "workpilot_company_settings";

const settingsForm = document.getElementById("settingsForm");
const resetBtn = document.getElementById("resetSettingsBtn");

function getFormData() {
return {
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
} catch (error) {
console.error("Firmendaten konnten nicht geladen werden:", error);
}
}

function saveSettings(event) {
event.preventDefault();

const data = getFormData();
localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

showToast("Firmendaten wurden gespeichert.");
}

function resetSettings() {
localStorage.removeItem(STORAGE_KEY);
settingsForm.reset();

showToast("Firmendaten wurden zurückgesetzt.");
}

settingsForm.addEventListener("submit", saveSettings);
resetBtn.addEventListener("click", resetSettings);

document.addEventListener("DOMContentLoaded", loadSettings);