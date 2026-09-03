const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const puppeteer = require("puppeteer");
const multer = require("multer");
const crypto = require("crypto");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");
const { discoverMailProvider } = require("./public/mail/core/mailDiscovery");
const {
    createImapClient,
    moveImapMessageToTrash,
    discoverImapFolders,
    importMailbox,
    importImapFolder,
    importNewImapMessages,
    loadImapMessage,
    findImapSentMailbox,
    findImapTrashMailbox,
    findImapSpamMailbox,
    saveSentMailToImap
} = require("./public/mail/core/mailImport");
const { simpleParser } = require("mailparser");

const MailComposer =
    require("nodemailer/lib/mail-composer");

const upload = multer({
storage: multer.memoryStorage()
});

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

const {
    encryptMailPassword,
    decryptMailPassword
} = require("./public/mail/core/mailCrypto");

const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const emailVerificationCodes = new Map();

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

const {
    createGoogleAuthUrl,
    exchangeGoogleCode
} = require("./google/googleMail");

let connectedGoogleTokens = null;

app.use(express.json());

app.use((req, res, next) => {
console.log("REQUEST:", req.method, req.url);
next();
});

async function verifyImapConnection({
    email,
    password,
    configuration
}) {
    const client = new ImapFlow({
        host: configuration.imap.host,
        port: configuration.imap.port,
        secure: configuration.imap.secure,

        auth: {
            user: email,
            pass: password
        },

        logger: false,
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 60000
    });

    let imapError = null;

    client.on("error", (error) => {
        imapError = error;

        console.error("IMAP CLIENT ERROR:", {
            message: error.message,
            code: error.code,
            authenticationFailed: error.authenticationFailed
        });
    });

    try {
        await client.connect();

        if (imapError) {
            throw imapError;
        }
    } finally {
        if (client.usable) {
            await client.logout().catch(() => {});
        } else {
            client.close();
        }
    }
}

async function verifySmtpConnection({
    email,
    password,
    configuration
}) {
    const transporter = nodemailer.createTransport({
        host: configuration.smtp.host,
        port: configuration.smtp.port,
        secure: configuration.smtp.secure,
        requireTLS: configuration.smtp.requireTLS,

        auth: {
            user: email,
            pass: password
        },

        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000
    });

    await transporter.verify();
}

app.get(
    "/api/mailbox/google/start",
    (req, res) => {

        try {

            const url =
                createGoogleAuthUrl();

            res.json({
                ok: true,
                url
            });

        } catch (error) {

            console.error(
                "GOOGLE AUTH START ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "Google-Verbindung konnte nicht gestartet werden."
            });

        }

    }
);

app.get(
    "/api/mailbox/google/callback",
    async (req, res) => {

        const code =
            req.query.code;

        if (!code) {

            return res.redirect(
                "/settings?google=error"
            );

        }

        try {

            const {
                email,
                tokens
            } =
                await exchangeGoogleCode(
                    code
                );


            if (!email) {

                throw new Error(
                    "Google hat keine E-Mail-Adresse zurückgegeben."
                );

            }


            const {
                error: mailboxError
            } = await supabase
                .from(
                    "mailbox_connections"
                )
                .upsert(
                    [
                        {
                            provider:
                                "google",

                            provider_name:
                                "Google",

                            email,

                            auth_method:
                                "oauth",

                            access_token:
                                tokens.access_token ||
                                null,

                            refresh_token:
                                tokens.refresh_token ||
                                null,

                            scope:
                                tokens.scope ||
                                null,

                            token_type:
                                tokens.token_type ||
                                null,

                            expiry_date:
                                tokens.expiry_date ||
                                null,

                            is_active:
                                true,

                            updated_at:
                                new Date()
                                    .toISOString()
                        }
                    ],
                    {
                        onConflict:
                            "provider,email"
                    }
                );


            if (mailboxError) {
                throw mailboxError;
            }


            console.log(
                "GOOGLE MAILBOX SAVED:",
                {
                    email,
                    provider:
                        "google"
                }
            );


            res.redirect(
                `/settings?google=connected&email=${encodeURIComponent(email)}`
            );


        } catch (error) {

            console.error(
                "GOOGLE AUTH CALLBACK ERROR:",
                {
                    message:
                        error.message,

                    details:
                        error.details,

                    hint:
                        error.hint,

                    code:
                        error.code
                }
            );


            res.redirect(
                "/settings?google=error"
            );

        }

    }
);

async function sendEmailFromActiveMailbox({
    to,
    subject,
    html,
    attachments = []
}) {

    const mailbox =
        await getActiveMailboxConnection();

    if (!mailbox) {
        throw new Error(
            "Kein aktives Postfach verbunden."
        );
    }

    if (mailbox.provider === "google") {

        await sendEmailWithGoogle({
            to,
            subject,
            html
        });

        return {
            sender: mailbox.email,
            provider: "google",
            messageId: null
        };
    }

    if (mailbox.provider !== "imap") {
        throw new Error(
            `Nicht unterstützter Mail-Provider: ${mailbox.provider}`
        );
    }


    const password =
        decryptMailPassword(
            mailbox.encrypted_password
        );


    const transporter =
        nodemailer.createTransport({

            host:
                mailbox.smtp_host,

            port:
                Number(mailbox.smtp_port),

            secure:
                Boolean(mailbox.smtp_secure),

            auth: {
                user:
                    mailbox.username ||
                    mailbox.email,

                pass:
                    password
            },

            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 20000

        });

    const mailOptions = {

        from:
            mailbox.email,

        to,
        subject,
        html,

        attachments:
            attachments.map((file) => ({
                filename:
                    file.originalname,

                content:
                    file.buffer,

                contentType:
                    file.mimetype
            }))

    };

const result =
    await transporter.sendMail(
        mailOptions
    );

mailOptions.messageId =
    result.messageId;

try {

    const rawMessage =
        await new MailComposer(
            mailOptions
        )
                .compile()
                .build();

        await saveSentMailToImap({
            mailbox,
            password,
            rawMessage
        });


        console.log(
            "SENT MAIL SAVED TO IMAP:",
            {
                email:
                    mailbox.email,

                recipient:
                    to,

                subject
            }
        );

    } catch (error) {

        console.error(
            "SENT MAIL IMAP SAVE ERROR:",
            error
        );

    }

    return {

        sender:
            mailbox.email,

        provider:
            mailbox.provider,

        messageId:
            result.messageId

    };

}

function extractFirstEmail(addresses) {

    if (
        !Array.isArray(addresses) ||
        !addresses.length
    ) {
        return null;
    }

    return addresses[0]?.address || null;
}

async function getLastImapUid(
    mailboxEmail,
    mailboxPath = "INBOX"
) {

    const {
        data,
        error
    } = await supabase
        .from("email_messages")
        .select("imap_uid")
        .eq(
            "provider",
            "imap"
        )
        .eq(
            "mailbox_email",
            mailboxEmail
        )
        .eq(
            "imap_mailbox",
            mailboxPath
        )
        .not(
            "imap_uid",
            "is",
            null
        )
        .order(
            "imap_uid",
            {
                ascending: false
            }
        )
        .limit(1)
        .maybeSingle();


    if (error) {
        throw error;
    }


    return Number(
        data?.imap_uid || 0
    );
}

function reportImapProgress(
    onProgress,
    processed,
    total,
    saved
) {

    if (
        typeof onProgress !== "function"
    ) {
        return;
    }

    onProgress({
        processed,
        total,
        saved
    });

}

async function saveImportedImapMails({
    mailbox,
    mails,
    onProgress,
    createDashboardNotificationEntry = true
}) {

let savedCount = 0;
let analyzedCount = 0;
let processedCount = 0;

    const password =
        decryptMailPassword(
            mailbox.encrypted_password
        );


    for (const mail of mails) {

    processedCount++;

    const mailboxPath =
    mail.mailboxPath ||
    "INBOX";

const direction =
    mail.mailboxRole === "sent"
        ? "outbound"
        : "inbound";

const externalMessageId =
    `imap:${mailbox.email}:${mailboxPath}:${mail.uid}`;

const rfcMessageId =
    mail.messageId ||
    null;

const {
    data: existingMessage,
    error: existingMessageError
} = await supabase
    .from("email_messages")
    .select("id")
    .eq(
        "external_message_id",
        externalMessageId
    )
    .maybeSingle();


if (existingMessageError) {

    console.error(
        "EMAIL EXISTENCE CHECK ERROR:",
        {
            uid:
                mail.uid,

            subject:
                mail.subject,

            error:
                existingMessageError
        }
    );

    reportImapProgress(
        onProgress,
        processedCount,
        mails.length,
        savedCount
    );

    continue;
}


if (existingMessage) {

    console.log(
        "EMAIL ALREADY EXISTS:",
        {
            uid:
                mail.uid,

            subject:
                mail.subject,

            reason:
                "external_message_id"
        }
    );

    reportImapProgress(
        onProgress,
        processedCount,
        mails.length,
        savedCount
    );

    continue;
}

if (rfcMessageId) {

    const {
        data: existingRfcMessage,
        error: existingRfcMessageError
    } = await supabase
        .from("email_messages")
        .select("id")
        .eq(
            "rfc_message_id",
            rfcMessageId
        )
        .maybeSingle();


    if (existingRfcMessageError) {

        console.error(
            "RFC MESSAGE EXISTENCE CHECK ERROR:",
            {
                uid:
                    mail.uid,

                subject:
                    mail.subject,

                rfcMessageId,

                error:
                    existingRfcMessageError
            }
        );

        reportImapProgress(
            onProgress,
            processedCount,
            mails.length,
            savedCount
        );

        continue;
    }


if (existingRfcMessage) {

    if (
        mail.mailboxRole === "trash" ||
        mail.mailboxRole === "spam"
    ) {

        const {
            error: folderUpdateError
        } = await supabase
            .from("email_messages")
            .update({
                deleted_at:
                    mail.mailboxRole === "trash"
                        ? new Date().toISOString()
                        : null,

                imap_mailbox:
                    mailboxPath,

                imap_uid:
                    mail.uid,

                mailbox_email:
                    mailbox.email,

                provider:
                    "imap"
            })
            .eq(
                "id",
                existingRfcMessage.id
            );


        if (folderUpdateError) {

            console.error(
                "SYSTEM FOLDER SYNC UPDATE ERROR:",
                {
                    messageId:
                        existingRfcMessage.id,

                    uid:
                        mail.uid,

                    subject:
                        mail.subject,

                    mailboxRole:
                        mail.mailboxRole,

                    error:
                        folderUpdateError
                }
            );

        } else {

            console.log(
                "📁 EMAIL SYSTEM FOLDER UPDATED:",
                {
                    messageId:
                        existingRfcMessage.id,

                    subject:
                        mail.subject,

                    mailboxRole:
                        mail.mailboxRole,

                    mailbox:
                        mailboxPath
                }
            );

        }

    } else {

        console.log(
            "EMAIL ALREADY EXISTS:",
            {
                uid:
                    mail.uid,

                subject:
                    mail.subject,

                rfcMessageId,

                reason:
                    "rfc_message_id"
            }
        );

    }


    reportImapProgress(
        onProgress,
        processedCount,
        mails.length,
        savedCount
    );

    continue;
}

}

        const senderEmail =
            extractFirstEmail(
                mail.from
            );

        const recipientEmail =
            extractFirstEmail(
                mail.to
            );


const contactEmail =
    direction === "outbound"
        ? recipientEmail
        : senderEmail;

const matchedContact =
    contactEmail
        ? await findMatchingContact(
            contactEmail
        )
        : null;

        let thread = null;


        if (mail.inReplyTo) {

            const {
    data: parentMessage,
    error: parentMessageError
} = await supabase
    .from("email_messages")
    .select(`
        thread_id
    `)
    .eq(
        "rfc_message_id",
        mail.inReplyTo
    )
    .maybeSingle();


            if (parentMessageError) {

                console.error(
                    "PARENT MAIL LOOKUP ERROR:",
                    parentMessageError
                );

            } else if (
                parentMessage?.thread_id
            ) {

                const {
                    data: existingThread,
                    error: existingThreadError
                } = await supabase
                    .from("email_threads")
                    .select("*")
                    .eq(
                        "id",
                        parentMessage.thread_id
                    )
                    .maybeSingle();


                if (
                    !existingThreadError &&
                    existingThread
                ) {
                    thread =
                        existingThread;
                }

            }

        }

        if (!thread) {

            const {
                data: newThread,
                error: threadError
            } = await supabase
                .from("email_threads")
                .insert([
                    {
                        contact_id:
                            matchedContact?.id ||
                            null,

                        related_type:
                            "general",

                        related_id:
                            null,

                        subject:
                            mail.subject ||
                            "Ohne Betreff",

                        status:
                            "open",

                        ai_summary:
                            null,

                        ai_category:
                            null
                    }
                ])
                .select()
                .single();


            if (threadError) {

                console.error(
                    "EMAIL THREAD CREATE ERROR:",
                    {
                        uid:
                            mail.uid,

                        subject:
                            mail.subject,

                        error:
                            threadError
                    }
                );

        reportImapProgress(
        onProgress,
        processedCount,
        mails.length,
        savedCount
    );


                continue;
            }


            thread =
                newThread;

        }

        const {
            data: message,
            error: messageError
        } = await supabase
            .from("email_messages")
            .insert([
                {
                    thread_id:
                        thread.id,

                    contact_id:
                        matchedContact?.id ||
                        null,

                    direction:
                       direction,

                    sender:
                        senderEmail,

                    recipient:
                        recipientEmail,

                    subject:
                        mail.subject,

                    body:
                        null,

                    body_html:
                        null,

                    provider:
                        "imap",

                    mailbox_email:
                        mailbox.email,

external_message_id:
    externalMessageId,

rfc_message_id:
    rfcMessageId,

external_thread_id:
    mail.inReplyTo ||
    null,

                    imap_uid:
                        mail.uid,

                    imap_mailbox:
                        mailboxPath,

                    deleted_at:
    mail.mailboxRole === "trash"
        ? new Date().toISOString()
        : null,

                    has_attachments:
                        mail.hasAttachments,

                    content_loaded:
                        false,

                    received_at:
                        mail.date,

                    message_status:
                        mail.isRead
                            ? "read"
                            : "unread"
                }
            ])
            .select()
            .single();


        if (messageError) {

            console.error(
                "EMAIL SAVE ERROR:",
                {
                    uid:
                        mail.uid,

                    subject:
                        mail.subject,

                    error:
                        messageError
                }
            );

        reportImapProgress(
        onProgress,
        processedCount,
        mails.length,
        savedCount
    );


            continue;
        }


        savedCount++;

        try {

            const loaded =
                await loadImapMessage(
                    {
                        provider:
                            "imap",

                        email:
                            mailbox.email,

                        username:
                            mailbox.username ||
                            mailbox.email,

                        password,

                        imap_host:
                            mailbox.imap_host,

                        imap_port:
                            mailbox.imap_port,

                        imap_secure:
                            mailbox.imap_secure
                    },

                    mail.uid,
                    mailboxPath
                );


            if (!loaded?.raw) {

                throw new Error(
                    "E-Mail-Inhalt konnte nicht geladen werden."
                );

            }


            const parsed =
                await simpleParser(
                    loaded.raw
                );


            const body =
                parsed.text ||
                "";


            const bodyHtml =
                parsed.html ||
                "";

const parsedAttachments =
    parsed.attachments || [];


for (
    const attachment
    of parsedAttachments
) {

    try {

        const fileName =
            attachment.filename ||
            `attachment-${Date.now()}`;

        const mimeType =
            attachment.contentType ||
            "application/octet-stream";

        const disposition =
            attachment.contentDisposition ||
            "attachment";

        const contentId =
            attachment.cid
                ? String(
                    attachment.cid
                ).replace(
                    /^<|>$/g,
                    ""
                )
                : null;

        const isInline =
            disposition === "inline" ||
            Boolean(contentId);

        const safeFileName =
            fileName
                .replace(
                    /[^\p{L}\p{N}._-]+/gu,
                    "_"
                )
                .slice(
                    0,
                    180
                );


        const filePath =
            `${message.id}/${Date.now()}-${safeFileName}`;

        const {
            error: uploadError
        } = await supabase.storage
            .from(
                "email-attachments"
            )
            .upload(
                filePath,
                attachment.content,
                {
                    contentType:
                        mimeType,

                    upsert:
                        false
                }
            );


        if (uploadError) {

            console.error(
                "INBOUND ATTACHMENT UPLOAD ERROR:",
                {
                    messageId:
                        message.id,

                    fileName,

                    error:
                        uploadError
                }
            );

            continue;
        }

        const {
            error: attachmentError
        } = await supabase
            .from(
                "email_attachments"
            )
            .insert([
                {
                    message_id:
                        message.id,

                    file_name:
                        fileName,

                    file_size:
                        attachment.size ||
                        attachment.content?.length ||
                        0,

                    file_path:
                        filePath,

                    mime_type:
                        mimeType,

                    content_id:
                        contentId,

                    disposition:
                        disposition,

                    is_inline:
                        isInline
                }
            ]);


        if (attachmentError) {

            console.error(
                "INBOUND ATTACHMENT DB ERROR:",
                {
                    messageId:
                        message.id,

                    fileName,

                    error:
                        attachmentError
                }
            );

            continue;
        }


        console.log(
            "📎 INBOUND ATTACHMENT SAVED:",
            {
                messageId:
                    message.id,

                fileName,

                mimeType,

                isInline
            }
        );


    } catch (attachmentImportError) {

        console.error(
            "INBOUND ATTACHMENT IMPORT ERROR:",
            {
                messageId:
                    message.id,

                subject:
                    mail.subject,

                error:
                    attachmentImportError
            }
        );

    }

}

            const {
                error: contentUpdateError
            } = await supabase
                .from("email_messages")
                .update({
                    body,
                    body_html:
                        bodyHtml,

                    content_loaded:
                        true
                })
                .eq(
                    "id",
                    message.id
                );


            if (contentUpdateError) {
                throw contentUpdateError;
            }

const messageForAnalysis = {
    ...message,

    body,

    body_html:
        bodyHtml,

    contact_name:
        matchedContact?.name ||
        null
};

reportImapProgress(
    onProgress,
    processedCount,
    mails.length,
    savedCount
);

if (
    mail.mailboxRole !== "custom" &&
    mail.mailboxRole !== "spam" &&
    mail.mailboxRole !== "trash" &&
    direction === "inbound"
) {

    await analyzeInboundEmail(
        messageForAnalysis,
        thread,
        {
            createDashboardNotificationEntry
        }
    );

    analyzedCount++;

}

            console.log(
                "🤖 EMAIL AI ANALYSIS COMPLETE:",
                {
                    uid:
                        mail.uid,

                    messageId:
                        message.id,

                    subject:
                        mail.subject
                }
            );


        } catch (analysisError) {

            console.error(
                "EMAIL AI PIPELINE ERROR:",
                {
                    uid:
                        mail.uid,

                    messageId:
                        message.id,

                    subject:
                        mail.subject,

                    error:
                        analysisError
                }
            );

        }


        console.log(
            "EMAIL SAVED:",
            {
                uid:
                    mail.uid,

                subject:
                    mail.subject,

                messageId:
                    message.id,

                threadId:
                    thread.id
            }
        );

    }


    return {
        savedCount,
        analyzedCount
    };

}

app.post("/api/mailbox/import", async (req, res) => {

const {
    range = "30",
    selectedFolders = []
} = req.body || {};

if (
    !Array.isArray(
        selectedFolders
    )
) {

    return res.status(400).json({
        success: false,
        message:
            "selectedFolders muss eine Liste von Ordnern sein."
    });

}

    mailboxImportProgress = {
        running: true,
        total: 0,
        processed: 0,
        saved: 0,
        finished: false,
        error: null
    };

    try {

        const mailbox =
            await getActiveMailboxConnection();


        console.log(
            "MAILBOX IMPORT START:",
            {
                provider:
                    mailbox.provider,

                providerName:
                    mailbox.provider_name,

                email:
                    mailbox.email
            }
        );

        if (
            mailbox.provider === "imap"
        ) {

            const password =
                decryptMailPassword(
                    mailbox.encrypted_password
                );


const connection = {
    provider:
        "imap",

    email:
        mailbox.email,

    username:
        mailbox.username ||
        mailbox.email,

    password,

    imap_host:
        mailbox.imap_host,

    imap_port:
        mailbox.imap_port,

    imap_secure:
        mailbox.imap_secure,

    smtp_host:
        mailbox.smtp_host,

    smtp_port:
        mailbox.smtp_port,

    smtp_secure:
        mailbox.smtp_secure
};

const inboxMails =
    await importMailbox(
        connection,
        range
    );

const discoveryClient =
    createImapClient(
        connection
    );

let sentMailbox =
null;

let trashMailbox =
null;

let spamMailbox =
null;

try {

    await discoveryClient.connect();

    sentMailbox =
        await findImapSentMailbox(
            discoveryClient
        );

    trashMailbox =
        await findImapTrashMailbox(
            discoveryClient
        );

        spamMailbox =
await findImapSpamMailbox(
discoveryClient
);

} finally {

    try {

        await discoveryClient.logout();

    } catch (error) {

        console.error(
            "IMAP DISCOVERY LOGOUT ERROR:",
            error
        );

    }

}

const sentMails =
    sentMailbox
        ? await importImapFolder(
            connection,
            sentMailbox,
            "sent"
        )
        : [];

const trashMails =
trashMailbox
? await importImapFolder(
connection,
trashMailbox,
"trash"
)
: [];

const spamMails =
spamMailbox
? await importImapFolder(
connection,
spamMailbox,
"spam"
)
: [];

const folderMails = [];

for (
    const folderPath
    of selectedFolders
) {

if (
folderPath === sentMailbox ||
folderPath === trashMailbox ||
folderPath === spamMailbox
) {
continue;
}

    const importedFolderMails =
        await importImapFolder(
            connection,
            folderPath
        );

    folderMails.push(
        ...importedFolderMails
    );

}

const mails = [
...inboxMails,
...sentMails,
...trashMails,
...spamMails,
...folderMails
];

mailboxImportProgress.total =
    mails.length;


const {
    savedCount
} = await saveImportedImapMails({
    mailbox,
    mails,
    createDashboardNotificationEntry: false,

    onProgress: ({
        processed,
        total,
        saved
    }) => {

        mailboxImportProgress.processed =
            processed;

        mailboxImportProgress.total =
            total;

        mailboxImportProgress.saved =
            saved;
    }
});

const existingImportedFolders =
    Array.isArray(
        mailbox.imported_folders
    )
        ? mailbox.imported_folders
        : [];

const updatedImportedFolders =
    Array.from(
        new Set([
            ...existingImportedFolders,
            ...selectedFolders
        ])
    );

const {
    error: importedFoldersUpdateError
} = await supabase
    .from("mailbox_connections")
    .update({
        imported_folders:
            updatedImportedFolders
    })
    .eq(
        "id",
        mailbox.id
    );

if (importedFoldersUpdateError) {
    throw importedFoldersUpdateError;
}

            mailboxImportProgress = {
                running: false,

                total:
                    mails.length,

                processed:
                    mails.length,

                saved:
                    savedCount,

                finished:
                    true,

                error:
                    null
            };


            console.log(
                "IMAP IMPORT SUCCESS:",
                {
                    email:
                        mailbox.email,

                    fetched:
                        mails.length,

                    saved:
                        savedCount
                }
            );


            return res.json({
                success: true,

                imported:
                    mails.length,

                saved:
                    savedCount,

                provider:
                    "imap"
            });

        }

        if (
    mailbox.provider === "google"
) {

    const allowedRanges = [
        "30",
        "60",
        "90",
        "all"
    ];


    if (
        !allowedRanges.includes(
            String(range)
        )
    ) {

        throw new Error(
            "Ungültiger Importzeitraum."
        );

    }


    const {
        auth
    } =
        await getActiveGoogleMailboxAuth();


    const gmail =
        google.gmail({
            version: "v1",
            auth
        });


const query =
    String(range) === "all"
        ? "in:inbox"
        : `in:inbox newer_than:${Number(range)}d`;

    const gmailMessages = [];

    let pageToken = null;


    do {

        const listResponse =
            await gmail.users.messages.list({
                userId: "me",

                maxResults: 500,

                q: query,

                pageToken:
                    pageToken ||
                    undefined
            });


        gmailMessages.push(
            ...(
                listResponse
                    .data
                    .messages ||
                []
            )
        );


        pageToken =
            listResponse
                .data
                .nextPageToken ||
            null;


    } while (pageToken);


    mailboxImportProgress.total =
        gmailMessages.length;


    let processedCount = 0;
    let savedCount = 0;
    let skippedCount = 0;


    for (
        const gmailMessage
        of gmailMessages
    ) {

        const importedMessage =
            await importSingleGoogleMessage(
                gmail,
                gmailMessage.id,
                {
                    createDashboardNotificationEntry:
                        false
                }
            );


        processedCount++;


        if (importedMessage) {

            savedCount++;

        } else {

            skippedCount++;

        }


        mailboxImportProgress.processed =
            processedCount;

        mailboxImportProgress.saved =
            savedCount;

    }


    mailboxImportProgress = {
        running: false,

        total:
            gmailMessages.length,

        processed:
            processedCount,

        saved:
            savedCount,

        finished:
            true,

        error:
            null
    };


    console.log(
        "GOOGLE IMPORT SUCCESS:",
        {
            email:
                mailbox.email,

            fetched:
                gmailMessages.length,

            saved:
                savedCount,

            skipped:
                skippedCount
        }
    );


    return res.json({
        success: true,

        imported:
            gmailMessages.length,

        saved:
            savedCount,

        skipped:
            skippedCount,

        provider:
            "google"
    });

}

        if (
            mailbox.provider === "microsoft"
        ) {

            mailboxImportProgress = {
                running: false,
                total: 0,
                processed: 0,
                saved: 0,
                finished: true,
                error:
                    "Der Microsoft-Import ist noch nicht implementiert."
            };


            return res.status(501).json({
                success: false,

                message:
                    "Der Microsoft-Import ist noch nicht implementiert."
            });

        }

        const providerError =
            `Unbekannter Mail-Anbieter: ${mailbox.provider}`;


        mailboxImportProgress = {
            running: false,
            total: 0,
            processed: 0,
            saved: 0,
            finished: true,
            error:
                providerError
        };


        return res.status(400).json({
            success: false,
            message:
                providerError
        });


    } catch (error) {

        console.error(
            "MAILBOX IMPORT ERROR:",
            {
                message:
                    error.message,

                code:
                    error.code,

                authenticationFailed:
                    error.authenticationFailed
            }
        );


        mailboxImportProgress.running =
            false;

        mailboxImportProgress.finished =
            true;

        mailboxImportProgress.error =
            error.message ||
            "Das Postfach konnte nicht importiert werden.";


        return res.status(500).json({
            success: false,

            message:
                error.message ||
                "Das Postfach konnte nicht importiert werden."
        });

    }

});

app.get(
    "/api/mailbox/import-progress",
    (req, res) => {

        res.json({
            success: true,

            progress:
                mailboxImportProgress
        });

    }
);

app.post("/api/mailbox/connect", async (req, res) => {
    const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();

    const password = String(req.body?.password || "");

    if (!email || !password) {
        return res.status(400).json({
            ok: false,
            error: "Bitte gib eine E-Mail-Adresse und ein Passwort ein."
        });
    }

    try {
        const configuration = await discoverMailProvider(email);

        console.log("MAIL PROVIDER DISCOVERED:", {
            email,
            provider: configuration.providerName,
            source: configuration.source,
            domain: configuration.domain
        });

        await verifyImapConnection({
            email,
            password,
            configuration
        });

        console.log("IMAP LOGIN SUCCESS:", email);

        await verifySmtpConnection({
            email,
            password,
            configuration
        });

        console.log("SMTP LOGIN SUCCESS:", email);

        const encryptedPassword = encryptMailPassword(password);

const { error: mailboxError } = await supabase
    .from("mailbox_connections")
    .upsert(
        [
            {
                provider: "imap",
                provider_name: configuration.providerName,
                email,
                username: email,
                auth_method: "password",
                encrypted_password: encryptedPassword,

                imap_host: configuration.imap.host,
                imap_port: configuration.imap.port,
                imap_secure: configuration.imap.secure,

                smtp_host: configuration.smtp.host,
                smtp_port: configuration.smtp.port,
                smtp_secure: configuration.smtp.secure,

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

console.log("IMAP MAILBOX SAVED:", {
    email,
    providerName: configuration.providerName
});

        return res.json({
            ok: true,
            message: "Das Postfach wurde erfolgreich geprüft.",
            provider: configuration.provider,
            providerName: configuration.providerName,
            email
        });
    } catch (error) {
        console.error("MAILBOX CONNECT ERROR:", {
            message: error.message,
            code: error.code,
            responseCode: error.responseCode,
            authenticationFailed: error.authenticationFailed
        });

        const authenticationFailed =
            error.authenticationFailed === true ||
            error.code === "EAUTH" ||
            error.responseCode === 534 ||
            error.responseCode === 535;

        if (authenticationFailed) {
            return res.status(401).json({
                ok: false,
                error:
                    "Die Anmeldung wurde vom E-Mail-Anbieter abgelehnt. Bitte überprüfe E-Mail-Adresse, Passwort und die IMAP-Freigabe."
            });
        }

        return res.status(400).json({
            ok: false,
            error:
                error.message ||
                "Das Postfach konnte nicht verbunden werden."
        });
    }
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
throw new Error("Bitte verbinde zuerst ein Postfach.");
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

async function getActiveMailboxConnection() {

    const { data: mailboxes, error } = await supabase
        .from("mailbox_connections")
        .select("*")
        .eq("is_active", true)
        .order("updated_at", {
            ascending: false
        });

    if (error) {
        throw error;
    }

    if (!mailboxes || mailboxes.length === 0) {
        throw new Error("Bitte verbinde zuerst ein Postfach.");
    }

    if (mailboxes.length > 1) {

        console.warn(
            "⚠️ Mehrere aktive Mailboxen gefunden:",
            mailboxes.map(mailbox => mailbox.email)
        );

        return mailboxes[0];
    }

    return mailboxes[0];
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

function normalizeMicrosoftFolders(
    folders
) {

    const systemFolders = [];
    const customFolders = [];

    const roleMap = {
        inbox:
            "inbox",

        sentitems:
            "sent",

        drafts:
            "drafts",

        deleteditems:
            "trash",

        junkemail:
            "junk",

        archive:
            "archive",

        outbox:
            "outbox"
    };

    for (
        const folder
        of folders
    ) {

        const wellKnownName =
            folder.wellKnownName
                ? String(
                    folder.wellKnownName
                ).toLowerCase()
                : null;

        const role =
            wellKnownName
                ? (
                    roleMap[
                        wellKnownName
                    ] ||
                    null
                )
                : null;

        const normalizedFolder = {

            id:
                folder.id,

            name:
                folder.displayName ||
                folder.id,

            path:
                folder.id,

            role,

            selectable:
                !wellKnownName,

            providerType:
                "microsoft",

            specialUse:
                wellKnownName,

            parentId:
                folder.parentFolderId ||
                null,

            childFolderCount:
                Number(
                    folder.childFolderCount ||
                    0
                )

        };

        if (wellKnownName) {

            systemFolders.push(
                normalizedFolder
            );

        } else {

            customFolders.push(
                normalizedFolder
            );

        }

    }

    return {
        systemFolders,
        customFolders
    };
}

app.get(
    "/api/mailbox/folders",
    async (req, res) => {

        let client = null;

        try {

            const mailbox =
                await getActiveMailboxConnection();

if (
    mailbox.provider === "google"
) {

    const {
        auth
    } =
        await getActiveGoogleMailboxAuth();

    const gmail =
        google.gmail({
            version: "v1",
            auth
        });

    const labelsResponse =
        await gmail.users.labels.list({
            userId: "me"
        });

    const labels =
        labelsResponse
            .data
            .labels ||
        [];

    const systemFolders = [];
    const customFolders = [];

    const systemRoleMap = {
        INBOX:
            "inbox",

        SENT:
            "sent",

        TRASH:
            "trash",

        DRAFT:
            "drafts",

        DRAFTS:
            "drafts",

        SPAM:
            "junk",

        STARRED:
            "flagged",

        IMPORTANT:
            "important",

        ALL:
            "all",

        ALL_MAIL:
            "all"
    };

    for (
        const label
        of labels
    ) {

        const labelType =
            String(
                label.type ||
                ""
            ).toLowerCase();

        if (
            labelType === "user"
        ) {

            customFolders.push({
                id:
                    label.id,

                name:
                    label.name ||
                    label.id,

                path:
                    label.id,

                role:
                    null,

                selectable:
                    true,

                providerType:
                    "google",

                specialUse:
                    null
            });

            continue;
        }

        const role =
            systemRoleMap[
                String(
                    label.id ||
                    label.name ||
                    ""
                ).toUpperCase()
            ] ||
            null;

        systemFolders.push({
            id:
                label.id,

            name:
                label.name ||
                label.id,

            path:
                label.id,

            role:
                role,

            selectable:
                false,

            providerType:
                "google",

            specialUse:
                label.id ||
                null
        });

    }

return res.json({
    success: true,

    provider:
        "google",

    email:
        mailbox.email,

    systemFolders,

    customFolders,

    importedFolders:
        Array.isArray(
            mailbox.imported_folders
        )
            ? mailbox.imported_folders
            : []
});

}

if (
    mailbox.provider !== "imap"
) {

    return res
        .status(400)
        .json({
            success: false,
            message:
                "Für diesen Anbieter ist die Ordner-Erkennung noch nicht aktiviert."
        });

}

            const password =
                decryptMailPassword(
                    mailbox.encrypted_password
                );

            client =
                createImapClient({
                    provider:
                        "imap",

                    email:
                        mailbox.email,

                    username:
                        mailbox.username ||
                        mailbox.email,

                    password,

                    imap_host:
                        mailbox.imap_host,

                    imap_port:
                        mailbox.imap_port,

                    imap_secure:
                        mailbox.imap_secure
                });

            await client.connect();

            const folders =
                await discoverImapFolders(
                    client
                );

return res.json({
    success: true,

    provider:
        "imap",

    email:
        mailbox.email,

    systemFolders:
        folders.systemFolders,

    customFolders:
        folders.customFolders,

    importedFolders:
        Array.isArray(
            mailbox.imported_folders
        )
            ? mailbox.imported_folders
            : []
});

        } catch (error) {

            console.error(
                "MAILBOX FOLDER DISCOVERY ERROR:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        error.message ||
                        "Die Postfachordner konnten nicht geladen werden."
                });

        } finally {

            if (client) {

                try {

                    await client.logout();

                } catch (error) {

                }

            }

        }

    }
);

app.post("/api/mailbox/import-new", async (req, res) => {

    try {

        const mailbox =
            await getActiveMailboxConnection();


if (
    mailbox.provider === "google"
) {

    const {
        auth
    } =
        await getActiveGoogleMailboxAuth();


    const gmail =
        google.gmail({
            version: "v1",
            auth
        });


    const listResponse =
        await gmail.users.messages.list({
            userId: "me",

            maxResults: 50,

            q: "newer_than:1d"
        });


    const gmailMessages =
        listResponse
            .data
            .messages ||
        [];


    let savedCount = 0;
    let skippedCount = 0;


    for (
        const gmailMessage
        of gmailMessages
    ) {

        const importedMessage =
            await importSingleGoogleMessage(
                gmail,
                gmailMessage.id,
                {
                    createDashboardNotificationEntry:
                        false
                }
            );


        if (importedMessage) {

            savedCount++;

        } else {

            skippedCount++;

        }

    }


    return res.json({
        success: true,

        fetched:
            gmailMessages.length,

        saved:
            savedCount,

        skipped:
            skippedCount,

        provider:
            "google"
    });

}


if (
    mailbox.provider !== "imap"
) {

    return res.status(400).json({
        success: false,

        message:
            "Für dieses Postfach ist noch kein Live-Sync verfügbar."
    });

}


        const password =
            decryptMailPassword(
                mailbox.encrypted_password
            );


        const lastUid =
            await getLastImapUid(
                mailbox.email
            );


        console.log(
            "LIVE IMPORT CHECK:",
            {
                email:
                    mailbox.email,

                lastUid
            }
        );


        const mails =
            await importNewImapMessages(
                {
                    provider:
                        "imap",

                    email:
                        mailbox.email,

                    username:
                        mailbox.username ||
                        mailbox.email,

                    password,

                    imap_host:
                        mailbox.imap_host,

                    imap_port:
                        mailbox.imap_port,

                    imap_secure:
                        mailbox.imap_secure,

                    smtp_host:
                        mailbox.smtp_host,

                    smtp_port:
                        mailbox.smtp_port,

                    smtp_secure:
                        mailbox.smtp_secure
                },

                lastUid
            );


        const {
            savedCount
        } = await saveImportedImapMails({
            mailbox,
            mails
        });


        return res.json({
            success: true,

            previousUid:
                lastUid,

            fetched:
                mails.length,

            saved:
                savedCount
        });


    } catch (error) {

        console.error(
            "LIVE IMPORT TEST ERROR:",
            error
        );


        return res.status(500).json({
            success: false,

            message:
                error.message ||
                "Neue E-Mails konnten nicht geprüft werden."
        });

    }

});

app.post("/api/mailbox/google/import", async (req, res) => {
const { range } = req.body;

const allowedRanges = ["30", "60", "90", "all"];

if (!allowedRanges.includes(String(range))) {
return res.status(400).json({
ok: false,
error: "Ungültiger Importzeitraum."
});
}

try {
const { auth } = await getActiveGoogleMailboxAuth();

const gmail = google.gmail({
version: "v1",
auth
});

const query =
String(range) === "all"
? ""
: `newer_than:${Number(range)}d`;

let pageToken = null;
let foundCount = 0;
let importedCount = 0;
let skippedCount = 0;

do {
const listResponse = await gmail.users.messages.list({
userId: "me",
maxResults: 500,
q: query,
pageToken: pageToken || undefined
});

const gmailMessages = listResponse.data.messages || [];

foundCount += gmailMessages.length;

for (const gmailMessage of gmailMessages) {
const importedMessage = await importSingleGoogleMessage(
gmail,
gmailMessage.id
);

if (importedMessage) {
importedCount++;
} else {
skippedCount++;
}
}

pageToken = listResponse.data.nextPageToken || null;

} while (pageToken);

res.json({
ok: true,
range,
found: foundCount,
count: importedCount,
skipped: skippedCount
});

} catch (error) {
console.error("GOOGLE IMPORT ERROR:", error);

res.status(500).json({
ok: false,
error:
error.message ||
"Google-E-Mails konnten nicht importiert werden."
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

app.put(
    "/api/email-messages/:id/trash",
    async (req, res) => {

        const { id } =
            req.params;

        try {

            const {
                data: message,
                error: messageLoadError
            } = await supabase
                .from("email_messages")
                .select(`
                    id,
                    provider,
                    mailbox_email,
                    imap_uid,
                    imap_mailbox
                `)
                .eq(
                    "id",
                    id
                )
                .single();


            if (messageLoadError) {

                return res
                    .status(500)
                    .json({
                        ok: false,
                        error:
                            messageLoadError.message
                    });

            }


            let providerTrashMailbox =
                message.imap_mailbox ||
                null;

            if (
                message.provider === "imap" &&
                message.imap_uid
            ) {

                const mailbox =
                    await getActiveMailboxConnection();


                if (
                    message.mailbox_email &&
                    mailbox.email !==
                        message.mailbox_email
                ) {

                    throw new Error(
                        "Die Mail gehört nicht zum aktuell verbundenen Postfach."
                    );

                }


                const password =
                    decryptMailPassword(
                        mailbox.encrypted_password
                    );


                const connection = {
                    provider:
                        "imap",

                    email:
                        mailbox.email,

                    username:
                        mailbox.username ||
                        mailbox.email,

                    password,

                    imap_host:
                        mailbox.imap_host,

                    imap_port:
                        mailbox.imap_port,

                    imap_secure:
                        mailbox.imap_secure,

                    smtp_host:
                        mailbox.smtp_host,

                    smtp_port:
                        mailbox.smtp_port,

                    smtp_secure:
                        mailbox.smtp_secure
                };


                const moveResult =
                    await moveImapMessageToTrash(
                        connection,
                        message.imap_mailbox ||
                            "INBOX",
                        message.imap_uid
                    );


                providerTrashMailbox =
                    moveResult.trashMailbox;

            }


            const {
                data,
                error
            } = await supabase
                .from("email_messages")
                .update({
                    deleted_at:
                        new Date().toISOString(),

                    imap_mailbox:
                        providerTrashMailbox
                })
                .eq(
                    "id",
                    id
                )
                .select()
                .single();


            if (error) {

                return res
                    .status(500)
                    .json({
                        ok: false,
                        error:
                            error.message
                    });

            }


            res.json({
                ok: true,
                message:
                    data
            });


        } catch (error) {

            console.error(
                "EMAIL TRASH MOVE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    error.message
            });

        }

    }
);

async function moveImapMessageToFolder(
    connection,
    sourceMailbox,
    uid,
    destinationMailbox
) {

    const client =
        createImapClient(
            connection
        );

    try {

        await client.connect();

        await client.mailboxOpen(
            sourceMailbox
        );

        await client.messageMove(
            Number(uid),
            destinationMailbox,
            {
                uid: true
            }
        );

        return {
            sourceMailbox,
            destinationMailbox
        };

    } finally {

        try {

            await client.logout();

        } catch (error) {

        }

    }

}

app.put(
    "/api/email-messages/:id/move-folder",
    async (req, res) => {

        const { id } =
            req.params;

        const {
            folder
        } = req.body || {};

        if (
            !folder ||
            typeof folder !== "string"
        ) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error:
                        "Ungültiger Zielordner."
                });

        }

        try {

            const {
                data: message,
                error: messageLoadError
            } = await supabase
                .from("email_messages")
                .select(`
                    id,
                    provider,
                    mailbox_email,
                    imap_uid,
                    imap_mailbox
                `)
                .eq(
                    "id",
                    id
                )
                .single();


            if (messageLoadError) {

                return res
                    .status(500)
                    .json({
                        ok: false,
                        error:
                            messageLoadError.message
                    });

            }


            if (
                message.provider !== "imap" ||
                !message.imap_uid
            ) {

                return res
                    .status(400)
                    .json({
                        ok: false,
                        error:
                            "Diese E-Mail kann aktuell nicht providerseitig verschoben werden."
                    });

            }


            const mailbox =
                await getActiveMailboxConnection();


            if (
                message.mailbox_email &&
                mailbox.email !==
                    message.mailbox_email
            ) {

                throw new Error(
                    "Die Mail gehört nicht zum aktuell verbundenen Postfach."
                );

            }


            const importedFolders =
                Array.isArray(
                    mailbox.imported_folders
                )
                    ? mailbox.imported_folders
                    : [];


            if (
                !importedFolders.includes(
                    folder
                )
            ) {

                return res
                    .status(400)
                    .json({
                        ok: false,
                        error:
                            "Der Zielordner ist in WorkPilot nicht aktiviert."
                    });

            }


            const password =
                decryptMailPassword(
                    mailbox.encrypted_password
                );


            const connection = {
                provider:
                    "imap",

                email:
                    mailbox.email,

                username:
                    mailbox.username ||
                    mailbox.email,

                password,

                imap_host:
                    mailbox.imap_host,

                imap_port:
                    mailbox.imap_port,

                imap_secure:
                    mailbox.imap_secure,

                smtp_host:
                    mailbox.smtp_host,

                smtp_port:
                    mailbox.smtp_port,

                smtp_secure:
                    mailbox.smtp_secure
            };


            await moveImapMessageToFolder(
                connection,
                message.imap_mailbox ||
                    "INBOX",
                message.imap_uid,
                folder
            );


            const {
                data,
                error
            } = await supabase
                .from("email_messages")
                .update({
                    imap_mailbox:
                        folder,

                    deleted_at:
                        null
                })
                .eq(
                    "id",
                    id
                )
                .select()
                .single();


            if (error) {

                return res
                    .status(500)
                    .json({
                        ok: false,
                        error:
                            error.message
                    });

            }


            return res.json({
                ok: true,
                message:
                    data
            });


        } catch (error) {

            console.error(
                "EMAIL CUSTOM FOLDER MOVE ERROR:",
                error
            );

            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        error.message
                });

        }

    }
);

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

async function saveEmailAnalysis(
    message,
    thread,
    analysis,
    {
        createDashboardNotificationEntry = true
    } = {}
) {

    await supabase
        .from("email_messages")
        .update({
            ai_detected_intent:
                analysis.intent,

            ai_summary:
                analysis.summary,

            ai_suggested_reply:
                analysis.suggestedReply,

            calendar_suggestion:
                analysis.calendarSuggestion
        })
        .eq(
            "id",
            message.id
        );


    await supabase
        .from("email_threads")
        .update({
            related_type:
                analysis.category,

            ai_category:
                analysis.category,

            ai_summary:
                analysis.summary
        })
        .eq(
            "id",
            thread.id
        );

    if (!createDashboardNotificationEntry) {
        return;
    }


    const dashboardEvent =
        await createDashboardEvent({
            type:
                "email_ai_analysis",

            title:
                analysis.dashboardTitle ||
                "E-Mail analysiert",

            description:
                analysis.dashboardMessage ||
                analysis.summary ||
                "",

            relatedType:
                "email",

            relatedId:
                message.id,

            priority:
                analysis.priority ||
                "normal",

            actionType:
                analysis.actionTarget ||
                "open_email_thread",

            metadata: {
                threadId:
                    thread.id,

                messageId:
                    message.id,

                category:
                    analysis.category ||
                    "other",

                intent:
                    analysis.intent ||
                    "other",

                calendarSuggestion:
                    analysis.calendarSuggestion ||
                    null
            }
        });


    if (dashboardEvent) {

        await createDashboardNotification({
            eventId:
                dashboardEvent.id,

            title:
                analysis.dashboardTitle ||
                "Neue E-Mail erkannt",

            message:
                analysis.dashboardMessage ||
                "Eine neue E-Mail wurde analysiert.",

            type:
                "email",

            priority:
                analysis.priority ||
                "normal",

            metadata: {
                threadId:
                    thread.id,

                messageId:
                    message.id,

                actionLabel:
                    analysis.actionLabel ||
                    "E-Mail öffnen",

                actionTarget:
                    analysis.actionTarget ||
                    "open_email_thread",

                calendarSuggestion:
                    analysis.calendarSuggestion ||
                    null
            }
        });

    }

}

async function analyzeInboundEmail(
    message,
    thread,
    {
        createDashboardNotificationEntry = true
    } = {}
) {
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
- Verwende für suggestedReply immer genau diese Struktur:

Guten Tag [Kontaktname],

[Antworttext]

Mit freundlichen Grüßen

- Wenn Kontaktname = "nicht bekannt", lautet die Anrede exakt:
"Guten Tag,"

- Wenn ein Kontaktname bekannt ist, lautet die Anrede exakt:
"Guten Tag [Kontaktname],"

- Verwende niemals "Sehr geehrte Damen und Herren".
- Verwende niemals "Sehr geehrter Herr" oder "Sehr geehrte Frau".
- Erfinde niemals einen Namen aus der E-Mail-Adresse.
- Zwischen Anrede und Antworttext muss genau eine Leerzeile stehen.
- Zwischen Antworttext und "Mit freundlichen Grüßen" muss genau eine Leerzeile stehen.
- Nach "Mit freundlichen Grüßen" darf nichts mehr folgen.
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
Kontaktname: ${message.contact_name || "nicht bekannt"}
Betreff: ${message.subject}

Nachricht:
${message.body}
`
}
]
});

const analysis = JSON.parse(response.output_text);

analysis.suggestedReply =
    normalizeSuggestedReply(
        analysis.suggestedReply,
        message.contact_name
    );

const safeAnalysis = {
...getFallbackEmailAnalysis(message),
...analysis,
calendarSuggestion: analysis.calendarSuggestion || null
};

console.log("EMAIL AI RAW:", response.output_text);
console.log("EMAIL AI PARSED:", safeAnalysis);

await saveEmailAnalysis(
    message,
    thread,
    safeAnalysis,
    {
        createDashboardNotificationEntry
    }
);

return safeAnalysis;

} catch (error) {
console.error("EMAIL AGENT ERROR:", error);
console.error("EMAIL AI RAW FAILED:", response?.output_text);

const fallbackAnalysis = getFallbackEmailAnalysis(message);

await saveEmailAnalysis(
    message,
    thread,
    fallbackAnalysis,
    {
        createDashboardNotificationEntry
    }
);

return fallbackAnalysis;
}
}

function normalizeSuggestedReply(
    suggestedReply,
    contactName = null
) {

    let text =
        String(suggestedReply || "")
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .trim();

    text = text.replace(
        /^(Sehr geehrte Damen und Herren,?|Sehr geehrter Herr[^,\n]*,?|Sehr geehrte Frau[^,\n]*,?|Guten Tag[^,\n]*,?)\s*/i,
        ""
    );

    text = text.replace(
        /\s*Mit freundlichen Grüßen(?:\s+Ihr WorkPilot-Team|\s+WorkPilot-Team)?\s*$/i,
        ""
    );

    text = text
        .replace(/\n{3,}/g, "\n\n")
        .trim();


    const greeting =
        contactName
            ? `Guten Tag ${contactName},`
            : "Guten Tag,";


    return [
        greeting,
        "",
        text,
        "",
        "Mit freundlichen Grüßen"
    ].join("\n");
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

const email =
    await sendEmailFromActiveMailbox({
        to,
        subject,
        html,

        attachments: [
            {
                originalname:
                    `Angebot-${offer.offerNumber || offer.id}.pdf`,

                mimetype:
                    "application/pdf",

                size:
                    pdfBuffer.length,

                buffer:
                    Buffer.from(pdfBuffer)
            }
        ]
    });

await supabase
    .from("email_messages")
    .insert([
        {
            thread_id:
                thread.id,

            direction:
                "outbound",

            sender:
                email.sender,

            recipient:
                to,

            subject,

            body:
                message,

            body_html:
                html,

            content_loaded:
                true,

            message_status:
                "sent"
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

const email =
    await sendEmailFromActiveMailbox({
        to,
        subject,
        html,

        attachments: [
            {
                originalname:
                    `Rechnung-${invoice.invoiceNumber || invoice.id}.pdf`,

                mimetype:
                    "application/pdf",

                size:
                    pdfBuffer.length,

                buffer:
                    Buffer.from(pdfBuffer)
            }
        ]
    });

await supabase
    .from("email_messages")
    .insert([
        {
            thread_id:
                thread.id,

            direction:
                "outbound",

            sender:
                email.sender,

            recipient:
                to,

            subject,

            body:
                message,

            body_html:
                html,

            content_loaded:
                true,

            message_status:
                "sent"
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
const {
    to,
    subject,
    html,
    threadId
} = req.body;
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

const email =
    await sendEmailFromActiveMailbox({
        to,
        subject,
        html,
        attachments: uploadedFiles
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

    body: html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .trim(),

    body_html: html,

    content_loaded: true,

    message_status: "sent",

    rfc_message_id:
    email.messageId || null
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

    file_name:
        file.originalname,

    file_size:
        file.size,

    file_path:
        filePath,

    mime_type:
        file.mimetype,

    disposition:
        "attachment",

    is_inline:
        false
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

async function importSingleGoogleMessage(
    gmail,
    gmailMessageId,
    {
        createDashboardNotificationEntry = true
    } = {}
) {
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

const sender = extractEmailAddress(getHeader("From"));
const recipient = extractEmailAddress(getHeader("To"));
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

await analyzeInboundEmail(
    message,
    thread,
    {
        createDashboardNotificationEntry
    }
);

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

app.delete("/api/mailbox/disconnect", async (req, res) => {
try {
let auth = null;

try {
const googleMailbox = await getActiveGoogleMailboxAuth();
auth = googleMailbox.auth;
} catch {
auth = null;
}

if (auth) {
try {
const gmail = google.gmail({
version: "v1",
auth
});

await gmail.users.stop({
userId: "me"
});
} catch (stopError) {
console.error("GOOGLE WATCH STOP ERROR:", stopError);
}
}

const { data: attachments, error: attachmentsLoadError } =
await supabase
.from("email_attachments")
.select("file_path");

if (attachmentsLoadError) {
throw attachmentsLoadError;
}

const attachmentPaths = (attachments || [])
.map((attachment) => attachment.file_path)
.filter(Boolean);

if (attachmentPaths.length) {
const { error: storageError } = await supabase.storage
.from("email-attachments")
.remove(attachmentPaths);

if (storageError) {
throw storageError;
}
}

const { error: attachmentDeleteError } = await supabase
.from("email_attachments")
.delete()
.not("id", "is", null);

if (attachmentDeleteError) {
throw attachmentDeleteError;
}

const { error: messageDeleteError } = await supabase
.from("email_messages")
.delete()
.not("id", "is", null);

if (messageDeleteError) {
throw messageDeleteError;
}

const { error: threadDeleteError } = await supabase
.from("email_threads")
.delete()
.not("id", "is", null);

if (threadDeleteError) {
throw threadDeleteError;
}

const { error: mailboxDeleteError } = await supabase
.from("mailbox_connections")
.delete()
.not("id", "is", null);

if (mailboxDeleteError) {
throw mailboxDeleteError;
}

connectedGoogleTokens = null;

res.json({
ok: true
});

} catch (error) {
console.error("MAILBOX DISCONNECT ERROR:", error);

res.status(500).json({
ok: false,
error:
error.message ||
"Das Postfach konnte nicht vollständig entfernt werden."
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

const normalizedMessages = (data || []).map((message) => ({
...message,
sender: extractEmailAddress(message.sender || ""),
recipient: extractEmailAddress(message.recipient || "")
}));

res.json({
ok: true,
messages: normalizedMessages
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

app.post("/api/mailbox/discover", async (req, res) => {

    try {

        const provider = await discoverMailProvider(
            req.body.email
        );

        return res.json({
            ok: true,
            provider
        });

    } catch (error) {

        return res.status(400).json({
            ok: false,
            error: error.message
        });

    }

});

app.get("/api/mailbox/message/:id/content", async (req, res) => {
    try {

        const { id } = req.params;

        const {
            data: message,
            error: messageError
        } = await supabase
            .from("email_messages")
            .select("*")
            .eq("id", id)
            .single();

        if (messageError || !message) {
            return res.status(404).json({
                success: false,
                message: "Nachricht nicht gefunden."
            });
        }

        const {
            data: existingAttachments,
            error: existingAttachmentError
        } = await supabase
            .from("email_attachments")
            .select("id")
            .eq("message_id", message.id);

        if (existingAttachmentError) {
            throw existingAttachmentError;
        }

        const attachmentsAlreadyLoaded =
            Array.isArray(existingAttachments) &&
            existingAttachments.length > 0;

        const needsAttachmentImport =
            Boolean(message.has_attachments) &&
            !attachmentsAlreadyLoaded;

        if (
            message.content_loaded &&
            !needsAttachmentImport
        ) {

            return res.json({
                success: true,

                message: {
                    body:
                        message.body || "",

                    body_html:
                        message.body_html || ""
                }
            });

        }

        const mailbox =
            await getActiveMailboxConnection();

        if (!mailbox) {
            throw new Error(
                "Keine aktive Mailbox-Verbindung gefunden."
            );
        }

        const password =
            decryptMailPassword(
                mailbox.encrypted_password
            );

        const loaded =
    await loadImapMessage(
        {
            provider:
                "imap",

            email:
                mailbox.email,

            username:
                mailbox.username ||
                mailbox.email,

            password,

            imap_host:
                mailbox.imap_host,

            imap_port:
                mailbox.imap_port,

            imap_secure:
                mailbox.imap_secure
        },

        message.imap_uid,

        message.imap_mailbox ||
            "INBOX"
    );


        if (!loaded?.raw) {
            throw new Error(
                "Die vollständige E-Mail konnte nicht geladen werden."
            );
        }

        const parsed =
            await simpleParser(
                loaded.raw
            );

        const body =
            parsed.text || "";

        const body_html =
            parsed.html || "";

        const parsedAttachments =
            Array.isArray(parsed.attachments)
                ? parsed.attachments
                : [];

        if (
            parsedAttachments.length > 0 &&
            !attachmentsAlreadyLoaded
        ) {

            for (
                const attachment
                of parsedAttachments
            ) {

                if (
                    !attachment ||
                    !attachment.content
                ) {
                    continue;
                }

                const originalFileName =
                    attachment.filename ||
                    "anhang";

                const safeFileName =
                    originalFileName
                        .replace(
                            /[^a-zA-Z0-9äöüÄÖÜß._-]/g,
                            "_"
                        )
                        .replace(
                            /_+/g,
                            "_"
                        );

                const mimeType =
                    attachment.contentType ||
                    "application/octet-stream";

                const contentId =
                    attachment.cid ||
                    null;

                const disposition =
                    attachment.contentDisposition ||
                    (
                        contentId
                            ? "inline"
                            : "attachment"
                    );

                const isInline =
                    disposition === "inline" ||
                    Boolean(contentId);

                const uniqueId =
                    crypto.randomUUID();

                const storagePath =
                    `${message.id}/${uniqueId}-${safeFileName}`;

                const {
                    error: uploadError
                } = await supabase.storage
                    .from("email-attachments")
                    .upload(
                        storagePath,
                        attachment.content,
                        {
                            contentType:
                                mimeType,

                            upsert:
                                false
                        }
                    );

                if (uploadError) {
                    throw uploadError;
                }

                const {
                    error: insertError
                } = await supabase
                    .from("email_attachments")
                    .insert({
                        message_id:
                            message.id,

                        file_name:
                            originalFileName,

                        file_size:
                            attachment.size ||
                            attachment.content.length ||
                            0,

                        file_path:
                            storagePath,

                        mime_type:
                            mimeType,

                        content_id:
                            contentId,

                        disposition:
                            disposition,

                        is_inline:
                            isInline
                    });

                if (insertError) {

                    await supabase.storage
                        .from("email-attachments")
                        .remove([
                            storagePath
                        ]);

                    throw insertError;
                }

            }

        }

        const {
            error: updateError
        } = await supabase
            .from("email_messages")
            .update({
                body,
                body_html,
                content_loaded: true
            })
            .eq(
                "id",
                message.id
            );

        if (updateError) {
            throw updateError;
        }

        return res.json({
            success: true,

            message: {
                body,
                body_html
            }
        });


    } catch (error) {

        console.error(
            "MAIL CONTENT LOAD ERROR:",
            error
        );

        return res
            .status(500)
            .json({
                success: false,

                message:
                    error.message ||
                    "E-Mail konnte nicht geladen werden."
            });

    }
});

let mailboxLiveSyncClient = null;
let mailboxLiveSyncRunning = false;

let mailboxImportProgress = {
    running: false,
    total: 0,
    processed: 0,
    saved: 0,
    finished: false,
    error: null
};


async function startMailboxLiveSync() {

    if (mailboxLiveSyncRunning) {
        console.log("📡 MAIL LIVE SYNC läuft bereits.");
        return;
    }


    let mailbox = null;

    try {

        mailbox =
            await getActiveMailboxConnection();


        if (
            !mailbox ||
            mailbox.provider !== "imap"
        ) {

            console.log(
                "📡 MAIL LIVE SYNC: Kein aktives IMAP-Postfach."
            );

            return;
        }


        const password =
            decryptMailPassword(
                mailbox.encrypted_password
            );


        const client =
            createImapClient({
                email:
                    mailbox.email,

                username:
                    mailbox.username ||
                    mailbox.email,

                password,

                imap_host:
                    mailbox.imap_host,

                imap_port:
                    mailbox.imap_port,

                imap_secure:
                    mailbox.imap_secure
            });


        mailboxLiveSyncClient =
            client;

        mailboxLiveSyncRunning =
            true;

        client.on(
            "exists",
            async (event) => {

                console.log(
                    "📨 IMAP LIVE EVENT:",
                    {
                        email:
                            mailbox.email,

                        count:
                            event.count,

                        previousCount:
                            event.prevCount
                    }
                );


                try {

                    const lastUid =
                        await getLastImapUid(
                            mailbox.email
                        );


                    const mails =
                        await importNewImapMessages(
                            {
                                provider:
                                    "imap",

                                email:
                                    mailbox.email,

                                username:
                                    mailbox.username ||
                                    mailbox.email,

                                password,

                                imap_host:
                                    mailbox.imap_host,

                                imap_port:
                                    mailbox.imap_port,

                                imap_secure:
                                    mailbox.imap_secure,

                                smtp_host:
                                    mailbox.smtp_host,

                                smtp_port:
                                    mailbox.smtp_port,

                                smtp_secure:
                                    mailbox.smtp_secure
                            },

                            lastUid
                        );


                    if (!mails.length) {
                        return;
                    }


                    const {
                        savedCount
                    } = await saveImportedImapMails({
                        mailbox,
                        mails
                    });


                    console.log(
                        "✅ LIVE MAIL IMPORT:",
                        {
                            email:
                                mailbox.email,

                            fetched:
                                mails.length,

                            saved:
                                savedCount
                        }
                    );


                } catch (error) {

                    console.error(
                        "LIVE MAIL IMPORT ERROR:",
                        error
                    );

                }

            }
        );

        client.on(
            "close",
            () => {

                console.log(
                    "📡 MAIL LIVE SYNC Verbindung geschlossen."
                );

                mailboxLiveSyncClient =
                    null;

                mailboxLiveSyncRunning =
                    false;

                setTimeout(() => {

                    startMailboxLiveSync()
                        .catch((error) => {

                            console.error(
                                "MAIL LIVE SYNC RESTART ERROR:",
                                error
                            );

                        });

                }, 5000);

            }
        );


        await client.connect();

        await client.mailboxOpen(
            "INBOX"
        );


        console.log(
            "📡 MAIL LIVE SYNC AKTIV:",
            mailbox.email
        );


    } catch (error) {

        mailboxLiveSyncClient =
            null;

        mailboxLiveSyncRunning =
            false;


        console.error(
            "MAIL LIVE SYNC START ERROR:",
            error
        );

        setTimeout(() => {

            startMailboxLiveSync()
                .catch((restartError) => {

                    console.error(
                        "MAIL LIVE SYNC RETRY ERROR:",
                        restartError
                    );

                });

        }, 10000);

    }

}

app.use((req, res) => {
console.log("404 ROUTE:", req.method, req.url);
res.status(404).json({
ok: false,
message: "Route nicht gefunden",
path: req.url
});
});

app.listen(PORT, async () => {

    console.log(
        `WorkPilot läuft auf Port ${PORT}`
    );


    try {

        await startMailboxLiveSync();

    } catch (error) {

        console.error(
            "MAIL LIVE SYNC STARTUP ERROR:",
            error
        );

    }

});
