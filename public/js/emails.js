const emailThreadsList = document.getElementById("emailThreadsList");
const emptyEmails = document.getElementById("emptyEmails");

const emptyMailState = document.getElementById("emptyMailState");
const mailDetailView = document.getElementById("mailDetailView");

const currentFolderTitle = document.getElementById("currentFolderTitle");
const currentFolderSubtitle = document.getElementById("currentFolderSubtitle");
const activeCommunicationInfo = document.getElementById("activeCommunicationInfo");

const composeMailModal = document.getElementById("composeMailModal");
const newMailBtn = document.getElementById("newMailBtn");
const closeComposeMailBtn = document.getElementById("closeComposeMailBtn");

const composeRecipient = document.getElementById("composeRecipient");
const composeSubject = document.getElementById("composeSubject");
const composeBody = document.getElementById("composeBody");

const addAttachmentBtn = document.getElementById("addAttachmentBtn");
const sendComposeMailBtn = document.getElementById("sendComposeMailBtn");

const mailAttachmentInput = document.getElementById("mailAttachmentInput");
const mailAttachmentsList = document.getElementById("mailAttachmentsList");

let selectedAttachments = [];
let activeFolder = "offer";
let emailMessagesCache = [];
let providerFoldersCache = [];
let importedFoldersCache = [];
let activeMessageId = null;
let moveTargetMessageId = null;
let selectedMoveFolder = null;
let renderEmailsRunning = false;
let renderEmailsPending = false;

const folderLabels = {
offer: "Angebote",
invoice: "Rechnungen",
appointment: "Termine",
other: "Sonstiges",
sent: "Gesendet",
trash: "Papierkorb"
};

const folderSubtitles = {
offer: "E-Mails, die zu Angeboten gehören.",
invoice: "E-Mails, die zu Rechnungen gehören.",
appointment: "E-Mails mit erkannten Terminen und Rücksprachen.",
other: "Sonstige Kundenkommunikation.",
sent: "Von WorkPilot gesendete E-Mails.",
trash: "Gelöschte E-Mails werden später nach 30 Tagen entfernt."
};

function formatFileSize(bytes){
if(bytes < 1024){
return bytes + " B";
}

if(bytes < 1024 * 1024){
return (bytes / 1024).toFixed(1) + " KB";
}

return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function renderActiveMailboxInfo() {

    if (!activeCommunicationInfo) {
        return;
    }

    const settings =
        JSON.parse(
            localStorage.getItem(
                "workpilot_company_settings"
            ) || "{}"
        );

    if (
        settings.mailboxConnected &&
        settings.mailboxEmail
    ) {

        activeCommunicationInfo.textContent =
            `Postfach verbunden: ${settings.mailboxEmail}`;

        return;
    }

    activeCommunicationInfo.textContent =
        "Keine E-Mail verbunden.";
}

async function getMessageAttachments(messageId) {
const response = await fetch(`/api/email-messages/${messageId}/attachments`);
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Anhänge konnten nicht geladen werden.");
}

return result.attachments || [];
}

async function openAttachment(attachmentId) {

    try {

        const attachmentResponse =
            await fetch(
                `/api/email-attachments/${attachmentId}/open`
            );

        const result =
            await attachmentResponse.json();

        if (!result.ok || !result.url) {
            throw new Error(
                result.error ||
                "Anhang konnte nicht geöffnet werden."
            );
        }

        const attachmentCard =
            document.querySelector(
                `.mailAttachmentCard[data-attachment-id="${attachmentId}"]`
            );

        const mimeType =
            attachmentCard?.dataset.mimeType ||
            "";

        const fileName =
            attachmentCard?.dataset.fileName ||
            "Anhang";

        if (
            mimeType.startsWith("image/")
        ) {

            openAttachmentViewer({
                url: result.url,
                fileName,
                type: "image"
            });

            return;
        }

        if (
            mimeType === "application/pdf" ||
            fileName.toLowerCase().endsWith(".pdf")
        ) {

            openAttachmentViewer({
                url: result.url,
                fileName,
                type: "pdf"
            });

            return;
        }

        const link =
            document.createElement("a");

        link.href =
            result.url;

        link.download =
            fileName;

        link.style.display =
            "none";

        document.body.appendChild(
            link
        );

        link.click();

        link.remove();


    } catch (error) {

        console.error(
            "Attachment Fehler:",
            error
        );

        throw error;

    }

}

function openAttachmentViewer({
    url,
    fileName,
    type
}) {

    const existingViewer =
        document.getElementById(
            "mailAttachmentViewer"
        );

    if (existingViewer) {
        existingViewer.remove();
    }


    const overlay =
        document.createElement("div");

    overlay.id =
        "mailAttachmentViewer";

    overlay.className =
        "mailAttachmentViewerOverlay";


    let content = "";


    if (type === "image") {

        content = `
            <div class="mailAttachmentViewerImageWrap">
                <img
                    src="${url}"
                    class="mailAttachmentViewerImage"
                    alt=""
                >
            </div>
        `;

    } else if (type === "pdf") {

        content = `
            <iframe
                src="${url}"
                class="mailAttachmentViewerPdf"
                title="${fileName}"
            ></iframe>
        `;

    }


    overlay.innerHTML = `
        <div class="mailAttachmentViewer">

            <div class="mailAttachmentViewerHeader">

                <div class="mailAttachmentViewerTitle">
                    ${escapeHtml(fileName)}
                </div>

                <div class="mailAttachmentViewerActions">

                    <a
                        href="${url}"
                        download="${escapeHtml(fileName)}"
                        class="mailAttachmentViewerDownload"
                    >
                        ↓
                    </a>

                    <button
                        type="button"
                        class="mailAttachmentViewerClose"
                    >
                        ×
                    </button>

                </div>

            </div>

            <div class="mailAttachmentViewerContent">
                ${content}
            </div>

        </div>
    `;


    document.body.appendChild(
        overlay
    );


    const closeButton =
        overlay.querySelector(
            ".mailAttachmentViewerClose"
        );

    closeButton.addEventListener(
        "click",
        () => {
            overlay.remove();
        }
    );


    overlay.addEventListener(
        "click",
        (event) => {

            if (event.target === overlay) {
                overlay.remove();
            }

        }
    );


    document.addEventListener(
        "keydown",
        function closeWithEscape(event) {

            if (event.key !== "Escape") {
                return;
            }

            overlay.remove();

            document.removeEventListener(
                "keydown",
                closeWithEscape
            );

        }
    );

}

function renderAttachments(){
mailAttachmentsList.innerHTML = "";

selectedAttachments.forEach((file, index) => {

const item = document.createElement("div");
item.className = "mailAttachmentItem";

item.innerHTML = `
<div>
<div class="mailAttachmentName">
${file.name}
</div>

<div class="mailAttachmentSize">
${formatFileSize(file.size)}
</div>
</div>

<button
class="mailAttachmentRemove"
data-index="${index}"
>
✕
</button>
`;

const removeBtn = item.querySelector(".mailAttachmentRemove");

removeBtn.addEventListener("click", () => {
selectedAttachments.splice(index, 1);
renderAttachments();
});

mailAttachmentsList.appendChild(item);
});
}

function getMessageFolder(message) {

const relatedType =
    message.email_threads?.related_type;

const manualFolder =
    message.email_threads?.manual_folder;

const aiCategory =
    message.email_threads?.ai_category;

const intent =
    message.ai_detected_intent;

const imapMailbox =
    message.imap_mailbox;


if (message.deleted_at) {
    return "trash";
}

const normalizedMailbox =
    String(
        message.imap_mailbox || ""
    )
        .trim()
        .toLowerCase();

if (
    normalizedMailbox === "spamverdacht" ||
    normalizedMailbox === "spam" ||
    normalizedMailbox === "junk" ||
    normalizedMailbox === "junk e-mail" ||
    normalizedMailbox === "junk email"
) {
    return "spam";
}

if (
    message.provider === "imap" &&
    imapMailbox &&
    String(imapMailbox).toUpperCase() !== "INBOX" &&
    Array.isArray(importedFoldersCache) &&
    importedFoldersCache.includes(
        imapMailbox
    )
) {
    return imapMailbox;
}

if (message.direction === "outbound") {
    return "sent";
}

if (manualFolder) {
if (manualFolder === "inbox") {
return "other";
}

return manualFolder;
}

if (
relatedType === "appointment" ||
relatedType === "schedule" ||
aiCategory === "appointment" ||
aiCategory === "schedule" ||
intent === "appointment"
) {
return "appointment";
}

if (
relatedType === "offer" ||
aiCategory === "offer" ||
intent === "offer_request"
) {
return "offer";
}

if (
relatedType === "invoice" ||
aiCategory === "invoice" ||
intent === "invoice_question"
) {
return "invoice";
}

return "other";
}

function isUnread(message) {
return message.direction === "inbound" && !message.read_at;
}

function getVisibleMessages() {
return emailMessagesCache.filter((message) => {
return getMessageFolder(message) === activeFolder;
});
}

function renderOriginalMailboxFolders() {

    const section =
        document.getElementById(
            "mailOriginalFoldersSection"
        );

    const container =
        document.getElementById(
            "mailOriginalFoldersList"
        );

    if (
        !section ||
        !container
    ) {
        return;
    }


    container.innerHTML = "";


const folderCounts =
    new Map();

for (
    const message
    of emailMessagesCache
) {

    if (
        !message.imap_mailbox
    ) {
        continue;
    }

    const folderName =
        message.imap_mailbox;

    folderCounts.set(
        folderName,
        (
            folderCounts.get(
                folderName
            ) || 0
        ) + 1
    );

}

const customFolders =
    Array.isArray(providerFoldersCache)
        ? providerFoldersCache.filter(
            folder => {

                const folderPath =
                    folder.path ||
                    folder.name;

                return importedFoldersCache.includes(
                    folderPath
                );
            }
        )
        : [];

if (!customFolders.length) {

    section.classList.add(
        "hidden"
    );

    return;
}

const sortedFolders =
    [...customFolders]
        .sort(
            (folderA, folderB) =>
                String(
                    folderA.name ||
                    folderA.path ||
                    ""
                ).localeCompare(
                    String(
                        folderB.name ||
                        folderB.path ||
                        ""
                    ),
                    "de"
                )
        )
        .map(
            folder => {

                const folderName =
                    folder.name ||
                    folder.path;

                return [
                    folderName,
                    folderCounts.get(
                        folder.path
                    ) ||
                    folderCounts.get(
                        folderName
                    ) ||
                    0
                ];

            }
        );


    for (
        const [
            folderName,
            count
        ]
        of sortedFolders
    ) {

        folderLabels[folderName] =
            folderName;

        folderSubtitles[folderName] =
            "Ordner aus deinem verbundenen Postfach.";


        const button =
            document.createElement(
                "button"
            );

        button.type =
            "button";

        button.className =
            "mailFolder mailOriginalFolder";

        button.dataset.folder =
            folderName;


        if (
            activeFolder ===
            folderName
        ) {
            button.classList.add(
                "active"
            );
        }


        const left =
            document.createElement(
                "span"
            );

        left.className =
            "mailOriginalFolderLeft";


        const icon =
            document.createElement(
                "span"
            );

        icon.className =
            "mailOriginalFolderIcon";

        icon.textContent =
            "📁";


        const name =
            document.createElement(
                "span"
            );

        name.className =
            "mailOriginalFolderName";

        name.textContent =
            folderName;


        const counter =
            document.createElement(
                "strong"
            );

        counter.className =
            "mailOriginalFolderCount";

        counter.textContent =
            String(count);


        left.appendChild(
            icon
        );

        left.appendChild(
            name
        );

        button.appendChild(
            left
        );

        button.appendChild(
            counter
        );


        button.addEventListener(
            "click",
            () => {

                activeFolder =
                    folderName;


                document
                    .querySelectorAll(
                        ".mailFolder"
                    )
                    .forEach(
                        entry => {

                            entry.classList.remove(
                                "active"
                            );

                        }
                    );


                button.classList.add(
                    "active"
                );


                activeMessageId =
                    null;

                mailDetailView
                    .classList
                    .add(
                        "hidden"
                    );

                emptyMailState
                    .classList
                    .remove(
                        "hidden"
                    );


                renderEmails();
            }
        );


        container.appendChild(
            button
        );
    }


    section.classList.remove(
        "hidden"
    );
}

function updateFolderCounts() {
const counts = {
offer: 0,
invoice: 0,
appointment: 0,
other: 0,
sent: 0,
trash: 0,
spam: 0
};

emailMessagesCache.forEach((message) => {
const folder = getMessageFolder(message);

if (counts[folder] !== undefined) {
counts[folder] += 1;
}
});

document.getElementById("countOffer").textContent = counts.offer;
document.getElementById("countInvoice").textContent = counts.invoice;
document.getElementById("countAppointment").textContent = counts.appointment;
document.getElementById("countOther").textContent = counts.other;
document.getElementById("countSent").textContent = counts.sent;
document.getElementById("countTrash").textContent = counts.trash;
document.getElementById("countSpam").textContent = counts.spam;
}

async function apiGetEmailMessages() {
const response = await fetch("/api/email-inbox");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mails konnten nicht geladen werden.");
}

return result.messages || [];
}

function createMailSyncSignature(messages) {

    if (!Array.isArray(messages)) {
        return "";
    }

    return messages
        .map((message) => {

return [
    message.id || "",
    message.message_status || "",
    message.read_at || "",
    message.deleted_at || "",
    message.imap_mailbox || "",
    message.updated_at || "",
    message.received_at || "",
    message.created_at || ""
].join("|");

        })
        .join("||");
}


let mailFrontendSyncSignature = "";
let mailFrontendSyncTimer = null;
let mailFrontendSyncRunning = false;


async function checkMailFrontendSync() {

    if (mailFrontendSyncRunning) {
        return;
    }

    mailFrontendSyncRunning = true;

    try {

        try {

            await fetch(
                "/api/mailbox/import-new",
                {
                    method: "POST"
                }
            );

        } catch (error) {

            console.error(
                "MAIL PROVIDER SYNC ERROR:",
                error
            );

        }

        const messages =
            await apiGetEmailMessages();

        const newSignature =
            createMailSyncSignature(messages);

        if (!mailFrontendSyncSignature) {

            mailFrontendSyncSignature =
                newSignature;

            return;
        }

        if (
            newSignature ===
            mailFrontendSyncSignature
        ) {
            return;
        }

        mailFrontendSyncSignature =
            newSignature;


        console.log(
            "📨 FRONTEND MAIL UPDATE ERKANNT"
        );


        await renderEmails();


        if (window.updateEmailCounter) {
            await window.updateEmailCounter();
        }


    } catch (error) {

        console.error(
            "MAIL FRONTEND LIVE SYNC ERROR:",
            error
        );

    } finally {

        mailFrontendSyncRunning =
            false;

    }

}


function startMailFrontendLiveSync() {

    if (mailFrontendSyncTimer) {
        return;
    }


    console.log(
        "📡 MAIL FRONTEND LIVE SYNC AKTIV"
    );

    checkMailFrontendSync();


    mailFrontendSyncTimer =
        setInterval(
            checkMailFrontendSync,
            3000
        );

}

async function moveMessageToTrash(messageId) {
const response = await fetch(`/api/email-messages/${messageId}/trash`, {
method: "PUT"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht gelöscht werden.");
}

return result.message;
}

async function restoreMessage(messageId) {
const response = await fetch(`/api/email-messages/${messageId}/restore`, {
method: "POST"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht wiederhergestellt werden.");
}
}

async function sendFreeEmail({ to, subject, body }) {
const response = await fetch("/api/send-email", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
to,
subject,
html: body.replaceAll("\n", "<br>")
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht gesendet werden.");
}

return result.email;
}

async function deleteMessageForever(messageId) {
const response = await fetch(`/api/email-messages/${messageId}`, {
method: "DELETE"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht gelöscht werden.");
}
}

async function renderEmails() {

    if (renderEmailsRunning) {
        renderEmailsPending = true;
        return;
    }

    renderEmailsRunning = true;

    try {

        emailThreadsList.innerHTML = "";

try {

    emailMessagesCache =
        await apiGetEmailMessages();

    await loadProviderFolders();

} catch (error) {

    showToast(
        error.message
    );

    return;
}

renderOriginalMailboxFolders();

updateFolderCounts();

currentFolderTitle.textContent =
    folderLabels[activeFolder];

currentFolderSubtitle.textContent =
    folderSubtitles[activeFolder];

        currentFolderSubtitle.textContent =
            folderSubtitles[activeFolder];

        const visibleMessages =
            getVisibleMessages();

        if (!visibleMessages.length) {
            emptyEmails.classList.remove("hidden");
            return;
        }

        emptyEmails.classList.add("hidden");


        visibleMessages.forEach((message) => {

            const item =
                document.createElement("div");

            item.dataset.messageId =
                message.id;

            item.className =
                `emailThreadItem ${isUnread(message) ? "unread" : ""}`;


            if (
                message.id ===
                activeMessageId
            ) {
                item.classList.add(
                    "selected"
                );
            }


            item.addEventListener(
                "click",
                async () => {

                    activeMessageId =
                        message.id;


                    document
                        .querySelectorAll(
                            ".emailThreadItem"
                        )
                        .forEach((entry) => {
                            entry.classList.remove(
                                "selected"
                            );
                        });


                    item.classList.add(
                        "selected"
                    );

                    item.classList.remove(
                        "unread"
                    );


                    if (isUnread(message)) {

                        try {

                            await markMessageAsRead(
                                message.id
                            );

                            message.read_at =
                                new Date()
                                    .toISOString();

                            updateFolderCounts();

                        } catch (error) {

                            console.error(
                                error
                            );

                        }

                    }


                    if (
                        window.updateEmailCounter
                    ) {
                        await window
                            .updateEmailCounter();
                    }


                    await openMailDetail(
                        message
                    );

                }
            );


            const subject =
                message.subject ||
                message.email_threads
                    ?.subject ||
                "Ohne Betreff";


            item.innerHTML = `
                <div class="threadTop">

                    <div class="threadSender">
                        ${
                            message.direction === "outbound"
                                ? message.recipient || "Unbekannt"
                                : message.sender || "Unbekannt"
                        }
                    </div>

                    <div class="threadDate">
                        ${
                            new Date(
                                message.received_at ||
                                message.created_at
                            )
                                .toLocaleDateString(
                                    "de-DE"
                                )
                        }
                    </div>

                </div>


                <div class="threadSubject">
                    ${subject}
                </div>


                <div class="threadPreview">
                    ${
                        stripHtml(
                            message.body || ""
                        ).slice(0, 120) ||
                        "Keine Vorschau verfügbar"
                    }
                </div>


                <div class="mailRowActions">

                    ${
                        !["sent", "trash"]
                            .includes(activeFolder)
                            ? `
                                <button
                                    class="mailRowMoveBtn"
                                    data-move-message="${message.id}"
                                >
                                    ↪
                                </button>
                            `
                            : ""
                    }

                    ${
                        activeFolder === "trash"
                            ? `
                                <button
                                    class="mailRowRestoreBtn"
                                >
                                    ↩
                                </button>
                            `
                            : ""
                    }

                    <button
                        class="mailRowDeleteBtn"
                    >
                        🗑
                    </button>

                </div>
            `;


            const deleteButton =
                item.querySelector(
                    ".mailRowDeleteBtn"
                );

            const moveButton =
                item.querySelector(
                    ".mailRowMoveBtn"
                );


            if (moveButton) {

                moveButton.addEventListener(
                    "click",
                    (event) => {

                        event.stopPropagation();

                        moveTargetMessageId =
                            message.id;

                        selectedMoveFolder =
                            null;

                        openMoveMailModal(
                            message
                        );

                    }
                );

            }


            deleteButton.addEventListener(
                "click",
                async (event) => {

                    event.stopPropagation();

                    try {

                        if (
                            activeFolder ===
                            "trash"
                        ) {

                            await deleteMessageForever(
                                message.id
                            );

                            showToast(
                                "E-Mail wurde endgültig gelöscht."
                            );

                        } else {

                            await moveMessageToTrash(
                                message.id
                            );

                            showToast(
                                "E-Mail wurde in den Papierkorb verschoben."
                            );

                        }


                        await renderEmails();


                        if (
                            window.updateEmailCounter
                        ) {
                            await window
                                .updateEmailCounter();
                        }


                    } catch (error) {

                        showToast(
                            error.message
                        );

                    }

                }
            );


            const restoreButton =
                item.querySelector(
                    ".mailRowRestoreBtn"
                );


            if (restoreButton) {

                restoreButton.addEventListener(
                    "click",
                    async (event) => {

                        event.stopPropagation();

                        try {

                            await restoreMessage(
                                message.id
                            );

                            showToast(
                                "E-Mail wurde wiederhergestellt."
                            );


                            await renderEmails();


                            if (
                                window.updateEmailCounter
                            ) {
                                await window
                                    .updateEmailCounter();
                            }


                        } catch (error) {

                            showToast(
                                error.message
                            );

                        }

                    }
                );

            }


            emailThreadsList
                .appendChild(item);

        });


    } finally {

        renderEmailsRunning =
            false;

        if (renderEmailsPending) {

            renderEmailsPending =
                false;

            await renderEmails();

        }

    }

}

function openMoveMailModal(message) {
    const existing = document.getElementById("moveMailModalOverlay");

    if (existing) {
        existing.remove();
    }

    selectedMoveFolder = null;

    const providerFolderButtons =
        Array.isArray(providerFoldersCache)
            ? providerFoldersCache
                .filter((folder) => {
                    const folderPath =
                        folder.path ||
                        folder.name;

                    return importedFoldersCache.includes(
                        folderPath
                    );
                })
                .map((folder) => {
                    const folderPath =
                        folder.path ||
                        folder.name;

                    const folderLabel =
                        folder.name ||
                        folder.path;

                    return `
                        <button
                            data-folder="${folderPath}"
                            data-folder-type="provider"
                        >
                            ${folderLabel}
                        </button>
                    `;
                })
                .join("")
            : "";

    const overlay = document.createElement("div");
    overlay.id = "moveMailModalOverlay";
    overlay.className = "moveMailModalOverlay";

    overlay.innerHTML = `
        <div class="moveMailModal">
            <div class="moveMailModalHeader">
                <div>
                    <h3>E-Mail verschieben</h3>
                    <p>Wähle den Zielordner für diese E-Mail.</p>
                </div>

                <button class="moveMailModalClose" type="button">×</button>
            </div>

            <div class="moveFolderOptions">
                <button
                    data-folder="offer"
                    data-folder-type="workpilot"
                >
                    Angebote
                </button>

                <button
                    data-folder="invoice"
                    data-folder-type="workpilot"
                >
                    Rechnungen
                </button>

                <button
                    data-folder="appointment"
                    data-folder-type="workpilot"
                >
                    Termine
                </button>

                <button
                    data-folder="other"
                    data-folder-type="workpilot"
                >
                    Sonstiges
                </button>

                ${
                    providerFolderButtons
                        ? `
                            <div class="moveFolderDivider"></div>

                            ${providerFolderButtons}
                        `
                        : ""
                }
            </div>

            <div class="moveMailModalActions">
                <button
                    class="btn btnSecondary"
                    id="cancelMoveMailBtn"
                >
                    Abbrechen
                </button>

                <button
                    class="btn btnPrimary"
                    id="confirmMoveMailBtn"
                    disabled
                >
                    Verschieben
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    let selectedMoveFolderType = null;

    overlay
        .querySelector(".moveMailModalClose")
        .addEventListener("click", () => {
            overlay.remove();
        });

    overlay
        .querySelector("#cancelMoveMailBtn")
        .addEventListener("click", () => {
            overlay.remove();
        });

    overlay
        .querySelectorAll("[data-folder]")
        .forEach((button) => {
            button.addEventListener("click", () => {
                selectedMoveFolder =
                    button.dataset.folder;

                selectedMoveFolderType =
                    button.dataset.folderType;

                overlay
                    .querySelectorAll("[data-folder]")
                    .forEach((entry) => {
                        entry.classList.remove("active");
                    });

                button.classList.add("active");

                overlay
                    .querySelector("#confirmMoveMailBtn")
                    .disabled = false;
            });
        });

    overlay
        .querySelector("#confirmMoveMailBtn")
        .addEventListener("click", async () => {
            if (
                !moveTargetMessageId ||
                !selectedMoveFolder ||
                !selectedMoveFolderType
            ) {
                return;
            }

            try {
                const targetMessage =
                    emailMessagesCache.find(
                        (entry) =>
                            entry.id === moveTargetMessageId
                    );

                if (!targetMessage) {
                    throw new Error(
                        "E-Mail konnte nicht gefunden werden."
                    );
                }

                let response;

                if (
                    selectedMoveFolderType === "provider"
                ) {
                    response = await fetch(
                        `/api/email-messages/${targetMessage.id}/move-folder`,
                        {
                            method: "PUT",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                folder:
                                    selectedMoveFolder
                            })
                        }
                    );
} else {
    const currentImapMailbox =
        targetMessage.imap_mailbox ||
        "INBOX";

    if (
        currentImapMailbox !== "INBOX"
    ) {
        const providerResponse =
            await fetch(
                `/api/email-messages/${targetMessage.id}/move-folder`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        folder:
                            "INBOX"
                    })
                }
            );

        const providerResult =
            await providerResponse.json();

        if (
            !providerResponse.ok ||
            providerResult.ok === false
        ) {
            throw new Error(
                providerResult.error ||
                "E-Mail konnte nicht zurück in den Posteingang verschoben werden."
            );
        }
    }

    response = await fetch(
        `/api/email-threads/${targetMessage.thread_id}/folder`,
        {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                folder:
                    selectedMoveFolder
            })
        }
    );
}

                const result =
                    await response.json();

                if (
                    !response.ok ||
                    result.ok === false
                ) {
                    throw new Error(
                        result.error ||
                        "E-Mail konnte nicht verschoben werden."
                    );
                }

                showToast(
                    "E-Mail wurde verschoben."
                );

                overlay.remove();

                await renderEmails();

                if (
                    window.updateEmailCounter
                ) {
                    await window.updateEmailCounter();
                }

            } catch (error) {
                showToast(
                    error.message
                );
            }
        });
}

async function openEmailFromUrl() {
const params = new URLSearchParams(window.location.search);

const messageId = params.get("message");
const threadId = params.get("thread");

if (!messageId && !threadId) return;

let message = null;

if (messageId) {
message = emailMessagesCache.find((entry) => {
return entry.id === messageId;
});
} else {
message = emailMessagesCache.find((entry) => {
return entry.thread_id === threadId;
});
}

if (!message) return;

const targetFolder = getMessageFolder(message);

activeFolder = targetFolder;

document.querySelectorAll(".mailFolder").forEach((button) => {
button.classList.toggle(
"active",
button.dataset.folder === targetFolder
);
});

activeMessageId = message.id;

await renderEmails();

if (window.updateEmailCounter) {
await window.updateEmailCounter();
}

const updatedMessage = emailMessagesCache.find((entry) => {
return entry.id === message.id;
});

if (!updatedMessage) return;

const matchingItem = document.querySelector(
`[data-message-id="${updatedMessage.id}"]`
);

if (matchingItem) {
matchingItem.classList.add("selected");
matchingItem.classList.remove("unread");

matchingItem.scrollIntoView({
behavior: "smooth",
block: "center"
});
}

if (isUnread(updatedMessage)) {
try {
await markMessageAsRead(updatedMessage.id);
updatedMessage.read_at = new Date().toISOString();
updateFolderCounts();
} catch (error) {
console.error(error);
}
}

if (window.updateEmailCounter) {
await window.updateEmailCounter();
}

await openMailDetail(updatedMessage);
}

async function markMessageAsRead(messageId) {
const response = await fetch(`/api/email-messages/${messageId}/read`, {
method: "PUT"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht als gelesen markiert werden.");
}

return result.message;
}

function stripHtml(value) {
const div = document.createElement("div");
div.innerHTML = value;
return div.textContent || div.innerText || "";
}

async function loadProviderFolders() {

    try {

        const response =
            await fetch(
                "/api/mailbox/folders"
            );

        const result =
            await response.json();

        if (
            !response.ok ||
            !result.success
        ) {
            throw new Error(
                result.message ||
                "Ordner konnten nicht geladen werden."
            );
        }

        providerFoldersCache =
            Array.isArray(
                result.customFolders
            )
                ? result.customFolders
                : [];

                importedFoldersCache =
    Array.isArray(result.importedFolders)
        ? result.importedFolders
        : [];

    } catch (error) {

        console.error(
            "PROVIDER FOLDER LOAD ERROR:",
            error
        );

        providerFoldersCache = [];

    }

}

async function openMailDetail(message) {

if (
    message.provider === "imap" &&
    message.content_loaded !== true
) {
    try {

        const response = await fetch(
            `/api/mailbox/message/${message.id}/content`
        );

        const result = await response.json();

        if (!result.success) {
            throw new Error(
                result.message ||
                "Der Inhalt konnte nicht geladen werden."
            );
        }

        message.body = result.message.body;
        message.body_html = result.message.body_html;
        message.content_loaded = true;

    } catch (error) {

        console.error(error);

        showToast(error.message);

    }
}
emptyMailState.classList.add("hidden");
mailDetailView.classList.remove("hidden");

const relatedThread = message.email_threads || {};
const subject =
message.subject ||
relatedThread.subject ||
"Ohne Betreff";

let attachments = [];

try {
attachments = await getMessageAttachments(message.id);
} catch (error) {
console.error(error);
}

let matchedContact = null;

if (message.contact_id) {
try {

const response = await fetch(`/api/contacts/${message.contact_id}`);
const result = await response.json();

if (result.ok) {
matchedContact = result.contact;
}

} catch (error) {
console.error(error);
}
}

const folder = getMessageFolder(message);

const messageText = `
${message.subject || ""}
${message.body || ""}
${message.ai_summary || ""}
${message.email_threads?.ai_summary || ""}
`.toLowerCase();

const showOfferButton =
folder === "offer" ||
message.email_threads?.related_type === "offer" ||
message.email_threads?.ai_category === "offer" ||
message.ai_detected_intent === "offer_request" ||
messageText.includes("angebot") ||
messageText.includes("kostenvoranschlag");

const showCalendarButton =
folder === "appointment" ||
message.email_threads?.related_type === "appointment" ||
message.email_threads?.ai_category === "appointment" ||
message.ai_detected_intent === "appointment" ||
message.calendar_suggestion?.date ||
message.calendar_suggestion?.time;

const showNoteButton =
message.direction === "inbound";

const showReplyBox =
message.direction === "inbound";

const contactEmail =
message.direction === "outbound"
? message.recipient
: message.sender;

const useFrame =
    shouldRenderMailAsHtml(
        message
    );


const parsedBody =
    useFrame
        ? await parseMailBody(message)
        : renderTextMail(message);

mailDetailView.innerHTML = `

<div class="mailDetailHeader">

    <div>

        <div class="mailDetailType">
            ${folderLabels[getMessageFolder(message)] || "E-Mail"}
        </div>

        <h2>${subject}</h2>

        <p>
            Von: ${message.sender || "Unbekannt"}<br>
            An: ${message.recipient || "Unbekannt"}
        </p>

        ${
            matchedContact
            ? `
                <div class="mailLinkedContact">

                    <strong>Kontakt:</strong>

                    ${matchedContact.name || matchedContact.email}

                    <button
                        class="mailOpenContactBtn"
                        data-contact-id="${matchedContact.id}"
                    >
                        Kontakt öffnen
                    </button>

                </div>
            `
            : `
                <div class="mailNoContact">

                    <div>
                        Kein Kontakt zugeordnet.
                    </div>

                    <button
                        class="mailCreateContactBtn"
                        data-name="${contactEmail || ""}"
                        data-email="${contactEmail || ""}"
                    >
                        Kontakt erstellen
                    </button>

                </div>
            `
        }

    </div>

    <div class="mailDetailDate">
        ${
            new Date(
                message.received_at || message.created_at
            ).toLocaleDateString("de-DE")
        }
    </div>

</div>


<div class="mailMessagesDetailList">

    <div class="detailMessageItem">

        <div class="detailMessageTop">

            <strong>
                ${
                    message.direction === "inbound"
                    ? "Eingegangen"
                    : "Gesendet"
                }
            </strong>

            <span>
                ${
                    new Date(
                        message.received_at || message.created_at
                    ).toLocaleString("de-DE")
                }
            </span>

        </div>


        ${
            attachments.length
            ? `
                <div class="mailAttachmentsHeader">

                    <h4>
                        📎 Anhänge (${attachments.length})
                    </h4>

                    <div class="mailAttachmentsGrid">

                        ${
                            attachments.map((attachment) => {

                                const size =
                                    formatAttachmentSize(
                                        attachment.file_size || 0
                                    );

                                const icon =
                                    getAttachmentIcon(
                                        attachment.mime_type,
                                        attachment.file_name
                                    );

                                return `
                                <div
    class="mailAttachmentCard"
    data-attachment-id="${attachment.id}"
    data-mime-type="${attachment.mime_type || ""}"
    data-file-name="${escapeHtml(attachment.file_name || "Anhang")}"
>

                                        ${(() => {

    const mimeType =
        attachment.mime_type || "";

    const fileName =
        attachment.file_name || "Anhang";

    const isImage =
        mimeType.startsWith("image/");

    const isPdf =
        mimeType === "application/pdf" ||
        fileName
            .toLowerCase()
            .endsWith(".pdf");


    if (isImage) {

        return `
            <div class="mailAttachmentPreview">

                <img
                    class="mailAttachmentLazyPreview"
                    data-attachment-id="${attachment.id}"
                    alt="${escapeHtml(fileName)}"
                >

            </div>
        `;

    }


    if (isPdf) {

        return `
            <div
                class="mailAttachmentPreview mailAttachmentPdfPreview"
                data-attachment-id="${attachment.id}"
            >

                <div class="mailAttachmentPdfPlaceholder">
                    PDF
                </div>

            </div>
        `;

    }


    return `
        <div class="mailAttachmentPreview mailAttachmentFilePreview">

            <div class="mailAttachmentIcon">
                ${icon}
            </div>

        </div>
    `;

})()}


<div class="mailAttachmentInfo">

    <div class="mailAttachmentName">
        ${escapeHtml(
            attachment.file_name ||
            "Anhang"
        )}
    </div>

    <div class="mailAttachmentSize">
        ${size}
    </div>

</div>

                                    </div>
                                `;

                            }).join("")
                        }

                    </div>

                </div>
            `
            : ""
        }


        <div class="detailMessageBody">

            ${
                useFrame
                ? `<div id="mailBodyContainer"></div>`
                : parsedBody
            }

        </div>


        ${
            showReplyBox && message.ai_suggested_reply
            ? `
                <div class="detailAiReply">

                    <div class="aiReplyHeader">

                        <strong>
                            KI-Antwortvorschlag:
                        </strong>

                        <button
                            id="useAiSuggestionBtn"
                            class="btn btnSecondary"
                        >
                            Vorschlag übernehmen
                        </button>

                    </div>

                    <div class="aiSuggestedReplyText">
    ${escapeHtml(
        String(message.ai_suggested_reply || "")
            .split("\n")
            .map((line) => line.trim())
            .join("\n")
            .trim()
    )}
</div>

                </div>
            `
            : ""
        }

    </div>

</div>


${
    showReplyBox
    ? `
        <div class="mailReplyBox">

            <textarea
                id="mailReplyTextarea"
                class="mailReplyTextarea"
                placeholder="Antwort schreiben..."
            ></textarea>

            <div class="mailReplyActions">

                ${
                    showOfferButton
                    ? `
                        <button
                            id="createOfferFromEmailBtn"
                            class="btn btnSecondary"
                        >
                            📄 Angebot
                        </button>
                    `
                    : ""
                }

                ${
                    showCalendarButton
                    ? `
                        <button
                            id="createCalendarFromEmailBtn"
                            class="btn btnSecondary"
                        >
                            📅 Termin
                        </button>
                    `
                    : ""
                }

                ${
                    showNoteButton
                    ? `
                        <button
                            id="createNoteFromEmailBtn"
                            class="btn btnSecondary"
                        >
                            📝 Notiz
                        </button>
                    `
                    : ""
                }

                <button
                    id="sendMailReplyBtn"
                    class="btn btnPrimary"
                >
                    Senden
                </button>

            </div>

        </div>
    `
    : ""
}
`;

document
    .querySelectorAll(".mailAttachmentLazyPreview")
    .forEach((img) => {
        loadAttachmentPreview(img);
    });

    document
    .querySelectorAll(".mailAttachmentPdfPreview")
    .forEach((container) => {
        loadPdfAttachmentPreview(
            container
        );
    });

if (useFrame) {

    const container =
        document.getElementById(
            "mailBodyContainer"
        );

    await renderMailFrame(
        container,
        message.body_html
    );

}

bindReplyActions(message, subject);

document.querySelectorAll(".mailOpenContactBtn").forEach((button) => {
button.addEventListener("click", () => {
const contactId = button.dataset.contactId;

window.location.href = `/contact-detail?id=${contactId}`;
});
});

document.querySelectorAll(".mailCreateContactBtn").forEach((button) => {
button.addEventListener("click", async () => {
try {
const response = await fetch("/api/contacts", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
name: button.dataset.name,
email: button.dataset.email
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakt konnte nicht erstellt werden.");
}

showToast("Kontakt wurde erstellt.");

await renderEmails();

if (window.updateEmailCounter) {
await window.updateEmailCounter();
}

} catch (error) {
showToast(error.message);
}
});
});

document.querySelectorAll(".mailAttachmentCard").forEach((card) => {

card.addEventListener("click", async () => {

try {

await openAttachment(card.dataset.attachmentId);

} catch (error) {

showToast(error.message);

}

});

});
}

function shouldRenderMailAsHtml(message) {

    const html =
        String(
            message.body_html || ""
        ).trim();

    const text =
        String(
            message.body || ""
        ).trim();


    if (!html) {
        return false;
    }

    const richHtmlPattern =
        /<(img|table|picture|video|svg|iframe|button)\b|background-image\s*:|cid:/i;


    if (
        richHtmlPattern.test(html)
    ) {
        return true;
    }

    const linkCount =
        (
            html.match(
                /<a\b/gi
            ) || []
        ).length;


    if (linkCount >= 2) {
        return true;
    }

    if (text) {
        return false;
    }

    return true;
}

async function loadAttachmentPreview(img) {

    const attachmentId =
        img.dataset.attachmentId;

    if (!attachmentId) {
        return;
    }

    try {

        const response =
            await fetch(
                `/api/email-attachments/${attachmentId}/open`
            );

        const result =
            await response.json();

        if (!result.ok || !result.url) {
            throw new Error(
                result.error ||
                "Vorschau konnte nicht geladen werden."
            );
        }

        img.src = result.url;

    } catch (error) {

        console.error(
            "Attachment Preview Fehler:",
            error
        );

    }
}

async function loadPdfAttachmentPreview(container) {

    const attachmentId =
        container.dataset.attachmentId;

    if (!attachmentId) {
        return;
    }

    try {

        const response =
            await fetch(
                `/api/email-attachments/${attachmentId}/open`
            );

        const result =
            await response.json();

        if (!result.ok || !result.url) {
            throw new Error(
                result.error ||
                "PDF-Vorschau konnte nicht geladen werden."
            );
        }


        const loadingTask =
            pdfjsLib.getDocument(
                result.url
            );


        const pdf =
            await loadingTask.promise;


        const page =
            await pdf.getPage(1);


        const baseViewport =
            page.getViewport({
                scale: 1
            });


        const maxWidth =
            container.clientWidth || 170;

        const maxHeight =
            container.clientHeight || 95;


        const scale =
            Math.min(
                maxWidth /
                    baseViewport.width,

                maxHeight /
                    baseViewport.height
            );


        const viewport =
            page.getViewport({
                scale
            });


        const canvas =
            document.createElement(
                "canvas"
            );


        const context =
            canvas.getContext(
                "2d"
            );


        canvas.width =
            Math.ceil(
                viewport.width
            );

        canvas.height =
            Math.ceil(
                viewport.height
            );


        canvas.className =
            "mailAttachmentPdfCanvas";


        container.innerHTML =
            "";


        container.appendChild(
            canvas
        );


        await page.render({
            canvasContext:
                context,

            viewport
        }).promise;


    } catch (error) {

        console.error(
            "PDF Preview Fehler:",
            error
        );

    }

}

function formatAttachmentSize(bytes) {

if (!bytes) return "";

if (bytes < 1024) {
return `${bytes} B`;
}

if (bytes < 1024 * 1024) {
return `${(bytes / 1024).toFixed(1)} KB`;
}

return `${(bytes / 1024 / 1024).toFixed(1)} MB`;

}

function getAttachmentIcon(mime, name) {

const file =
(name || "").toLowerCase();

if (mime?.startsWith("image/"))
return "🖼️";

if (mime === "application/pdf")
return "📕";

if (
file.endsWith(".doc") ||
file.endsWith(".docx")
)
return "📘";

if (
file.endsWith(".xls") ||
file.endsWith(".xlsx")
)
return "📗";

if (
file.endsWith(".ppt") ||
file.endsWith(".pptx")
)
return "📙";

if (
file.endsWith(".zip") ||
file.endsWith(".rar")
)
return "🗜️";

return "📄";

}

function getCalendarSuggestionFromMessage(message, subject) {

const suggestion = message.calendar_suggestion || {};

console.log(
    "CALENDAR SUGGESTION DEBUG:",
    message.calendar_suggestion,
    typeof message.calendar_suggestion
);

return {
title:
suggestion.title ||
`Rücksprache ${message.sender || "Kunde"}`,

date:
suggestion.date ||
"",

time:
suggestion.time ||
"",

description:
suggestion.description ||
`E-Mail: ${subject}`
};
}

function bindReplyActions(message, subject) {
const replyTextarea = document.getElementById("mailReplyTextarea");
const useAiSuggestionBtn = document.getElementById("useAiSuggestionBtn");
const sendMailReplyBtn = document.getElementById("sendMailReplyBtn");

const createOfferFromEmailBtn = document.getElementById("createOfferFromEmailBtn");
const createCalendarFromEmailBtn = document.getElementById("createCalendarFromEmailBtn");

if (message.direction !== "inbound") {
return;
}

if (createOfferFromEmailBtn) {
createOfferFromEmailBtn.addEventListener("click", async () => {
try {
const response = await fetch("/api/dashboard-actions", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
actionTarget: "create_offer_draft",
actionPayload: {
messageId: message.id,
threadId: message.thread_id
}
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Angebotsvorschlag konnte nicht erstellt werden.");
}

if (result.target) {
window.location.href = result.target;
return;
}

showToast(result.message || "Angebotsvorschlag wurde erstellt.");
} catch (error) {
showToast(error.message);
}
});
}

if (createCalendarFromEmailBtn) {
createCalendarFromEmailBtn.addEventListener("click", () => {
const calendarSuggestion =
getCalendarSuggestionFromMessage(message, subject);

const params = new URLSearchParams();

if (calendarSuggestion.title) {
params.set("title", calendarSuggestion.title);
}

if (calendarSuggestion.date) {
params.set("date", calendarSuggestion.date);
}

if (calendarSuggestion.time) {
params.set("time", calendarSuggestion.time);
}

if (calendarSuggestion.description) {
params.set("description", calendarSuggestion.description);
}

window.location.href = `/calendar-create?${params.toString()}`;
});
}

const createNoteFromEmailBtn =
document.getElementById("createNoteFromEmailBtn");

if (createNoteFromEmailBtn) {
createNoteFromEmailBtn.addEventListener("click", () => {
const params = new URLSearchParams();

if (message.contact_id) {
params.set("contactId", message.contact_id);
}

params.set("source", "email");

if (message.id) {
params.set("messageId", message.id);
}

const noteSummary =
message.ai_summary ||
message.email_threads?.ai_summary ||
"";

if (noteSummary) {
params.set("note", noteSummary);
}

window.location.href =
`/note-create?${params.toString()}`;
});
}

if (useAiSuggestionBtn) {
useAiSuggestionBtn.addEventListener("click", () => {
if (!message.ai_suggested_reply) {
showToast("Kein KI-Vorschlag vorhanden.");
return;
}

replyTextarea.value = message.ai_suggested_reply;
});
}

sendMailReplyBtn.addEventListener("click", async () => {
const text = replyTextarea.value.trim();

if (!text) {
showToast("Bitte eine Antwort eingeben.");
return;
}

try {
await sendReply(
message.thread_id,
text,
subject,
message.sender
);

showToast("E-Mail wurde gesendet.");
await renderEmails();

if (window.updateEmailCounter) {
await window.updateEmailCounter();
}

} catch (error) {
showToast(error.message);
}
});
}

async function sendReply(
    threadId,
    body,
    subject,
    recipient
) {

    const formData =
        new FormData();

    formData.append(
        "to",
        recipient
    );

    formData.append(
        "subject",
        subject
            .toLowerCase()
            .startsWith("re:")
                ? subject
                : `Re: ${subject}`
    );

    formData.append(
        "html",
        body.replaceAll(
            "\n",
            "<br>"
        )
    );

    if (threadId) {
        formData.append(
            "threadId",
            threadId
        );
    }


    const response =
        await fetch(
            "/api/send-email",
            {
                method: "POST",
                body: formData
            }
        );


    const result =
        await response.json();


    if (!result.ok) {
        throw new Error(
            result.error ||
            "Antwort konnte nicht gesendet werden."
        );
    }


    return result.message;
}

function bindFolders() {
document.querySelectorAll(".mailFolder").forEach((button) => {
button.addEventListener("click", () => {
activeFolder = button.dataset.folder;

document.querySelectorAll(".mailFolder").forEach((entry) => {
entry.classList.remove("active");
});

button.classList.add("active");

activeMessageId = null;
mailDetailView.classList.add("hidden");
emptyMailState.classList.remove("hidden");

renderEmails();
});
});
}

document.addEventListener("DOMContentLoaded", () => {
bindFolders();

renderActiveMailboxInfo();

renderEmails().then(async () => {
await openEmailFromUrl();

startMailFrontendLiveSync();
});

addAttachmentBtn.addEventListener("click", () => {
mailAttachmentInput.click();
});

mailAttachmentInput.addEventListener("change", (event) => {

const files = Array.from(event.target.files);

selectedAttachments.push(...files);

renderAttachments();

mailAttachmentInput.value = "";
});

const newMailBtn = document.getElementById("newMailBtn");
const composeMailModal = document.getElementById("composeMailModal");
const closeComposeMailBtn = document.getElementById("closeComposeMailBtn");

const mailOriginalFolderAddBtn =
    document.getElementById(
        "mailOriginalFolderAddBtn"
    );

if (mailOriginalFolderAddBtn) {

    mailOriginalFolderAddBtn.addEventListener(
        "click",
        async () => {

            const rawName =
                window.prompt(
                    "Name des neuen Ordners:"
                );

            if (rawName === null) {
                return;
            }

            const folderName =
                rawName.trim();

            if (!folderName) {
                return;
            }

            if (folderName.length > 50) {

                alert(
                    "Der Ordnername darf maximal 50 Zeichen lang sein."
                );

                return;
            }

            try {

                const response =
                    await fetch(
                        "/api/mailbox/folders",
                        {
                            method:
                                "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({
                                    name:
                                        folderName
                                })
                        }
                    );

                const result =
                    await response.json();

                if (
                    !response.ok ||
                    result.success === false
                ) {

                    throw new Error(
                        result.message ||
                        "Ordner konnte nicht erstellt werden."
                    );

                }

                await loadProviderFolders();

                renderOriginalMailboxFolders();

            } catch (error) {

                console.error(
                    "FOLDER CREATE ERROR:",
                    error
                );

                alert(
                    error.message ||
                    "Ordner konnte nicht erstellt werden."
                );

            }

        }
    );

}

newMailBtn.addEventListener("click", () => {
composeMailModal.classList.remove("hidden");
});

newMailBtn.addEventListener("click", () => {
composeMailModal.classList.remove("hidden");
});

closeComposeMailBtn.addEventListener("click", () => {
composeMailModal.classList.add("hidden");
});

newMailBtn.addEventListener("click", () => {
composeRecipient.value = "";
composeSubject.value = "";
composeBody.value = "";

composeMailModal.classList.remove("hidden");
});

closeComposeMailBtn.addEventListener("click", () => {
composeMailModal.classList.add("hidden");
});

sendComposeMailBtn.addEventListener("click", async () => {

const recipient = composeRecipient.value.trim();
const subject = composeSubject.value.trim();
const body = composeBody.value.trim();

const profileSettings = JSON.parse(
localStorage.getItem("workpilot_company_settings") || "{}"
);

if (!profileSettings.mailboxConnected) {
showToast("Bitte verbinde zuerst ein Postfach im Profil.");
return;
}

if (!recipient || !subject || !body) {
showToast("Bitte alle Felder ausfüllen.");
return;
}

sendComposeMailBtn.disabled = true;
sendComposeMailBtn.textContent = "Wird gesendet...";

try {

const formData = new FormData();

formData.append("to", recipient);
formData.append("subject", subject);
formData.append("html", body);

selectedAttachments.forEach((file) => {
formData.append("attachments", file);
});

const response = await fetch("/api/send-email", {
method: "POST",
body: formData
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "E-Mail konnte nicht gesendet werden.");
}

showToast("E-Mail wurde versendet.");

composeMailModal.classList.add("hidden");

composeRecipient.value = "";
composeSubject.value = "";
composeBody.value = "";

selectedAttachments = [];
renderAttachments();

await renderEmails();

if (window.updateEmailCounter) {
await window.updateEmailCounter();
}

} catch (error) {
showToast(error.message);

} finally {
sendComposeMailBtn.disabled = false;
sendComposeMailBtn.textContent = "Senden";
}

});
});
