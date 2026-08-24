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

const connectMailboxBtn =
document.getElementById("connectMailboxBtn");

const mailboxConnectionText =
document.getElementById("mailboxConnectionText");

const mailboxConnectModal =
document.getElementById("mailboxConnectModal");

const closeMailboxModal =
document.getElementById("closeMailboxModal");

const smtpConnectModal =
document.getElementById("smtpConnectModal");

const closeSmtpModal =
document.getElementById("closeSmtpModal");

const cancelSmtpConnectionBtn =
document.getElementById("cancelSmtpConnectionBtn");

const smtpConnectForm =
document.getElementById("smtpConnectForm");

const smtpMailboxEmail =
document.getElementById("smtpMailboxEmail");

const smtpMailboxPassword =
document.getElementById("smtpMailboxPassword");

const submitSmtpConnectionBtn =
document.getElementById("submitSmtpConnectionBtn");

const emailImportModal =
document.getElementById("emailImportModal");

const closeImportModal =
document.getElementById("closeImportModal");

const cancelImportBtn =
document.getElementById("cancelImportBtn");

const startImportBtn =
document.getElementById("startImportBtn");

const importMailboxBtn =
document.getElementById("importMailboxBtn");

const mailImportProgress =
    document.getElementById(
        "mailImportProgress"
    );

const mailImportProgressStatus =
    document.getElementById(
        "mailImportProgressStatus"
    );

const mailImportProgressCount =
    document.getElementById(
        "mailImportProgressCount"
    );

const mailImportProgressBar =
    document.getElementById(
        "mailImportProgressBar"
    );

const disconnectMailboxModal =
    document.getElementById(
        "disconnectMailboxModal"
    );

const closeDisconnectMailboxModal =
    document.getElementById(
        "closeDisconnectMailboxModal"
    );

const cancelDisconnectMailboxBtn =
    document.getElementById(
        "cancelDisconnectMailboxBtn"
    );

const confirmDisconnectMailboxBtn =
    document.getElementById(
        "confirmDisconnectMailboxBtn"
    );

function getSavedSettings() {
try {
return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
} catch {
return {};
}
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
mailProvider: existingSettings.mailProvider || null,
mailboxConnected: existingSettings.mailboxConnected || false,
mailboxEmail: existingSettings.mailboxEmail || "",

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
mailProvider: data.mailProvider || null,
mailboxConnected: data.mailboxConnected || false,
mailboxEmail: data.mailboxEmail || data.personalEmail || "",

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

if (!saved) {
handleGoogleCallbackResult();
return;
}

try {
const data = JSON.parse(saved);
fillForm(data);
updateVerificationUi(data);
updateMailboxUi(data);
handleGoogleCallbackResult();
} catch (error) {
console.error("Firmendaten konnten nicht geladen werden:", error);
handleGoogleCallbackResult();
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

function updateMailboxUi(data = {}) {
if (!mailboxConnectionText) {
return;
}

if (data.mailboxConnected) {
const providerLabel = {
google: "Gmail",
microsoft: "Microsoft",
smtp: "Anderer Anbieter"
}[data.mailProvider] || "Postfach";

mailboxConnectionText.textContent =
`Postfach verbunden: ${data.mailboxEmail}`;

if (connectMailboxBtn) {
connectMailboxBtn.textContent = "Postfach entfernen";
}

if (importMailboxBtn) {
importMailboxBtn.classList.remove("hidden");
}

return;
}

mailboxConnectionText.textContent =
"Noch kein Postfach verbunden.";

if (connectMailboxBtn) {
connectMailboxBtn.textContent = "Postfach verbinden";
}

if (importMailboxBtn) {
importMailboxBtn.classList.add("hidden");
}
}

function handleGoogleCallbackResult() {
const params = new URLSearchParams(window.location.search);

const googleStatus = params.get("google");
const email = params.get("email");

if (googleStatus === "connected" && email) {
const data = getFormData();

data.mailProvider = "google";
data.mailboxConnected = true;
data.mailboxEmail = email;

localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

updateMailboxUi(data);

showToast("Google-Postfach wurde verbunden.");

window.history.replaceState({}, document.title, "/settings");
}

if (googleStatus === "error") {
showToast("Google-Postfach konnte nicht verbunden werden.");

window.history.replaceState({}, document.title, "/settings");
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
verifyEmailBtn.addEventListener("click", async () => {
const email = document.getElementById("personalEmail").value.trim();

if (!email) {
showToast("Bitte zuerst eine Kommunikations-E-Mail eingeben.");
return;
}

try {
const response = await fetch("/api/profile/send-email-verification", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({ email })
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Verifizierung konnte nicht gestartet werden.");
}

const code = prompt("Verifizierungscode eingeben:");

if (!code) {
showToast("Verifizierung abgebrochen.");
return;
}

const verifyResponse = await fetch("/api/profile/verify-email-code", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
email,
code
})
});

const verifyResult = await verifyResponse.json();

if (!verifyResult.ok) {
throw new Error(verifyResult.error || "Code konnte nicht verifiziert werden.");
}

const data = getFormData();
data.communicationEmailVerified = true;

localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
updateVerificationUi(data);

showToast("E-Mail wurde verifiziert.");
} catch (error) {
showToast(error.message);
}
});
}

if (verifyPhoneBtn) {
verifyPhoneBtn.addEventListener("click", () => {
showToast("Telefon-Verifizierung wird für den Telefonagenten vorbereitet.");
});
}

if (connectMailboxBtn) {

    connectMailboxBtn.addEventListener(
        "click",
        () => {

            const data =
                getSavedSettings();

            if (!data.mailboxConnected) {

                if (mailboxConnectModal) {
                    mailboxConnectModal
                        .classList
                        .remove("hidden");
                }

                return;
            }

            if (disconnectMailboxModal) {

                disconnectMailboxModal
                    .classList
                    .remove("hidden");

            }

        }
    );

}

if (importMailboxBtn) {
importMailboxBtn.addEventListener("click", () => {
emailImportModal.classList.remove("hidden");
});
}

if (closeMailboxModal) {
closeMailboxModal.addEventListener("click", () => {
mailboxConnectModal.classList.add("hidden");
});
}

if (smtpConnectForm) {
smtpConnectForm.addEventListener("submit", async (event) => {
event.preventDefault();

const email = smtpMailboxEmail.value
.trim()
.toLowerCase();

const password = smtpMailboxPassword.value;

if (!email || !password) {
showToast(
"Bitte gib deine E-Mail-Adresse und dein E-Mail-Passwort ein."
);
return;
}

submitSmtpConnectionBtn.disabled = true;
submitSmtpConnectionBtn.textContent =
"Verbindung wird geprüft...";

try {
const response = await fetch(
"/api/mailbox/connect",
{
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
email,
password
})
}
);

const responseText = await response.text();

let result = {};

if (responseText) {
    try {
        result = JSON.parse(responseText);
    } catch (error) {
        throw new Error(
            "Der Server hat keine gültige Antwort geliefert."
        );
    }
}

if (!response.ok || !result.ok) {
throw new Error(
result.error ||
"Das Postfach konnte nicht verbunden werden."
);
}

const data = getSavedSettings();

data.mailProvider = "smtp";
data.mailboxConnected = true;
data.mailboxEmail = email;
data.mailProviderName =
result.providerName || "Anderer Anbieter";

localStorage.setItem(
STORAGE_KEY,
JSON.stringify(data)
);

updateMailboxUi(data);
closeSmtpConnectionModal();

showToast(
`${data.mailProviderName} wurde erfolgreich verbunden.`
);

} catch (error) {
showToast(error.message);

} finally {
submitSmtpConnectionBtn.disabled = false;
submitSmtpConnectionBtn.textContent =
"Postfach verbinden";
}
});
}

function closeSmtpConnectionModal() {
if (smtpConnectModal) {
smtpConnectModal.classList.add("hidden");
}

if (smtpConnectForm) {
smtpConnectForm.reset();
}
}

if (closeSmtpModal) {
closeSmtpModal.addEventListener(
"click",
closeSmtpConnectionModal
);
}

if (cancelSmtpConnectionBtn) {
cancelSmtpConnectionBtn.addEventListener("click", () => {
closeSmtpConnectionModal();

if (mailboxConnectModal) {
mailboxConnectModal.classList.remove("hidden");
}
});
}

async function startGoogleMailboxConnection() {
try {
const response = await fetch("/api/mailbox/google/start");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Google-Verbindung konnte nicht gestartet werden.");
}

window.location.href = result.url;
} catch (error) {
showToast(error.message);
}
}

function startMicrosoftMailboxConnection() {
showToast("Microsoft-Verbindung wird vorbereitet.");
}

function startSmtpMailboxConnection() {
if (mailboxConnectModal) {
mailboxConnectModal.classList.add("hidden");
}

if (smtpConnectModal) {
smtpConnectModal.classList.remove("hidden");
}

if (smtpMailboxEmail) {
const settings = getSavedSettings();

smtpMailboxEmail.value =
settings.personalEmail ||
settings.communicationEmail ||
"";
}

if (smtpMailboxPassword) {
smtpMailboxPassword.value = "";
}

setTimeout(() => {
smtpMailboxEmail?.focus();
}, 50);
}

document.querySelectorAll("[data-mail-provider]").forEach((button) => {
button.addEventListener("click", () => {
const provider = button.dataset.mailProvider;

if (provider === "google") {
startGoogleMailboxConnection();
return;
}

if (provider === "microsoft") {
startMicrosoftMailboxConnection();
return;
}

if (provider === "smtp") {
startSmtpMailboxConnection();
return;
}
});
});

document.addEventListener("DOMContentLoaded", loadSettings);

if (closeImportModal) {
closeImportModal.addEventListener("click", () => {
emailImportModal.classList.add("hidden");
});
}

if (cancelImportBtn) {
cancelImportBtn.addEventListener("click", () => {
emailImportModal.classList.add("hidden");
});
}

if (closeDisconnectMailboxModal) {

    closeDisconnectMailboxModal.addEventListener(
        "click",
        () => {

            disconnectMailboxModal
                ?.classList
                .add("hidden");

        }
    );

}


if (cancelDisconnectMailboxBtn) {

    cancelDisconnectMailboxBtn.addEventListener(
        "click",
        () => {

            disconnectMailboxModal
                ?.classList
                .add("hidden");

        }
    );

}

async function pollMailboxImportProgress() {

    try {

        const response =
            await fetch(
                "/api/mailbox/import-progress"
            );

        const result =
            await response.json();


        if (
            !result.success ||
            !result.progress
        ) {
            return;
        }


        const progress =
            result.progress;


        const total =
            Number(
                progress.total || 0
            );

        const processed =
            Number(
                progress.processed || 0
            );


        if (mailImportProgressCount) {

            mailImportProgressCount.textContent =
                `${processed} / ${total}`;

        }


        const percent =
            total > 0
                ? Math.min(
                    100,
                    (
                        processed /
                        total
                    ) * 100
                )
                : 0;


        if (mailImportProgressBar) {

            mailImportProgressBar.style.width =
                `${percent}%`;

        }


        if (
            progress.finished &&
            !progress.error
        ) {

            if (mailImportProgressStatus) {

                mailImportProgressStatus.textContent =
                    "Import abgeschlossen";

            }


            if (mailImportProgressBar) {

                mailImportProgressBar.style.width =
                    "100%";

            }

            return;

        }


        if (progress.error) {

            if (mailImportProgressStatus) {

                mailImportProgressStatus.textContent =
                    "Import fehlgeschlagen";

            }

            return;

        }


        if (progress.running) {

            setTimeout(
                pollMailboxImportProgress,
                400
            );

        }


    } catch (error) {

        console.error(
            "IMPORT PROGRESS ERROR:",
            error
        );

    }

}

if (startImportBtn) {

    startImportBtn.addEventListener(
        "click",
        async () => {

            const selectedRange =
                document.querySelector(
                    'input[name="mailImportRange"]:checked'
                )?.value || "30";


            startImportBtn.disabled =
                true;

            startImportBtn.textContent =
                "Import läuft...";


            if (mailImportProgress) {

                mailImportProgress
                    .classList
                    .remove("hidden");

            }


            if (mailImportProgressStatus) {

                mailImportProgressStatus.textContent =
                    "E-Mails werden importiert";

            }


            if (mailImportProgressCount) {

                mailImportProgressCount.textContent =
                    "0 / 0";

            }


            if (mailImportProgressBar) {

                mailImportProgressBar.style.width =
                    "0%";

            }

            pollMailboxImportProgress();


            try {

                const response =
                    await fetch(
                        "/api/mailbox/import",
                        {
                            method:
                                "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({
                                    range:
                                        selectedRange
                                })
                        }
                    );


                const result =
                    await response.json();

                if (!result.success) {

                    throw new Error(
                        result.message ||
                        "Import konnte nicht gestartet werden."
                    );

                }


                if (mailImportProgressStatus) {

                    mailImportProgressStatus.textContent =
                        "Import abgeschlossen";

                }


                if (mailImportProgressCount) {

                    mailImportProgressCount.textContent =
                        `${result.imported || 0} / ${result.imported || 0}`;

                }


                if (mailImportProgressBar) {

                    mailImportProgressBar.style.width =
                        "100%";

                }


                showToast(
                    `${result.imported || 0} E-Mails wurden verarbeitet.`
                );


            } catch (error) {

                if (mailImportProgressStatus) {

                    mailImportProgressStatus.textContent =
                        "Import fehlgeschlagen";

                }


                showToast(
                    error.message
                );


            } finally {

                startImportBtn.disabled =
                    false;

                startImportBtn.textContent =
                    "Import starten";

            }

        }
    );

}

window.getCommunicationSettings = getCommunicationSettings;
