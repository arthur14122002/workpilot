const { ImapFlow } = require("imapflow");

function createImapClient(connection) {
    const client = new ImapFlow({
        host: connection.imap_host,
        port: Number(connection.imap_port),
        secure: Boolean(connection.imap_secure),

        auth: {
            user: connection.username || connection.email,
            pass: connection.password
        },

        logger: false,

        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 120000
    });

    client.on("error", (error) => {
        console.error("IMAP CLIENT ERROR:", {
            message: error.message,
            code: error.code,
            authenticationFailed: error.authenticationFailed
        });
    });

    return client;
}

async function findSentMailbox(client) {

    const mailboxes =
        await client.list();

    const sentByFlag =
        mailboxes.find((mailbox) => {

            return (
                Array.isArray(mailbox.specialUse)
                    ? mailbox.specialUse.includes("\\Sent")
                    : mailbox.specialUse === "\\Sent"
            );

        });

    if (sentByFlag) {
        return sentByFlag.path;
    }

    const fallbackNames = [
        "Sent",
        "Gesendet",
        "Sent Messages",
        "Sent Mail"
    ];

    for (const name of fallbackNames) {

        const found =
            mailboxes.find((mailbox) =>
                String(mailbox.path || "")
                    .toLowerCase() ===
                name.toLowerCase()
            );

        if (found) {
            return found.path;
        }

    }


    throw new Error(
        "Der Ordner für gesendete E-Mails wurde nicht gefunden."
    );
}

async function saveSentMailToImap({
    mailbox,
    password,
    rawMessage
}) {

    const client =
        createImapClient({
            imap_host:
                mailbox.imap_host,

            imap_port:
                mailbox.imap_port,

            imap_secure:
                mailbox.imap_secure,

            username:
                mailbox.username ||
                mailbox.email,

            email:
                mailbox.email,

            password
        });


    try {

        await client.connect();

        const sentMailbox =
            await findSentMailbox(client);

        await client.append(
            sentMailbox,
            rawMessage,
            ["\\Seen"],
            new Date()
        );

    } finally {

        try {
            await client.logout();
        } catch (error) {
            console.error(
                "IMAP LOGOUT ERROR:",
                error
            );
        }

    }
}

async function importMailbox(connection, range = "30") {

    switch (connection.provider) {

        case "google":
            throw new Error(
                "Google-Import noch nicht implementiert."
            );

        case "microsoft":
            throw new Error(
                "Microsoft-Import noch nicht implementiert."
            );

        case "imap":
            return importImapMailbox(
                connection,
                range
            );

        default:
            throw new Error(
                `Unbekannter Provider: ${connection.provider}`
            );

    }

}

async function importImapMailbox(
    connection,
    range = "30"
) {

    const client =
        createImapClient(
            connection
        );

    try {

        await client.connect();

        const mailbox =
            await client.mailboxOpen(
                "INBOX"
            );


        console.log(
            `📥 ${mailbox.exists} Nachrichten gefunden.`
        );


        if (!mailbox.exists) {
            return [];
        }

        let sinceDate =
            null;


        if (
            range !== "all"
        ) {

            const days =
                Number(range);


            if (
                Number.isFinite(days) &&
                days > 0
            ) {

                sinceDate =
                    new Date();

                sinceDate.setDate(
                    sinceDate.getDate() -
                    days
                );

                sinceDate.setHours(
                    0,
                    0,
                    0,
                    0
                );

            }

        }

        let uids = [];


        if (sinceDate) {

uids =
    await client.search(
        {
            since:
                sinceDate
        },
        {
            uid: true
        }
    );

        } else {

uids =
    await client.search(
        {
            all: true
        },
        {
            uid: true
        }
    );

        }


        console.log(
            "📥 IMAP IMPORT RANGE:",
            {
                range,
                sinceDate,
                found:
                    uids.length
            }
        );


        if (!uids.length) {
            return [];
        }

        const mails = [];


        for await (
            const message
            of client.fetch(
                uids,
                {
                    uid: true,
                    envelope: true,
                    flags: true,
                    size: true,
                    bodyStructure: true
                },
                {
                    uid: true
                }
            )
        ) {

            const flags =
                Array.from(
                    message.flags || []
                );


            const bodyStructure =
                message.bodyStructure ||
                null;


            mails.push({
                provider:
                    "imap",

                externalId:
                    `imap:${connection.email}:${message.uid}`,

                uid:
                    message.uid,

                messageId:
                    message.envelope?.messageId ||
                    null,

                inReplyTo:
                    message.envelope?.inReplyTo ||
                    null,

                subject:
                    message.envelope?.subject ||
                    "",

                from:
                    message.envelope?.from ||
                    [],

                to:
                    message.envelope?.to ||
                    [],

                cc:
                    message.envelope?.cc ||
                    [],

                bcc:
                    message.envelope?.bcc ||
                    [],

                date:
                    message.envelope?.date ||
                    null,

                size:
                    Number(
                        message.size || 0
                    ),

                flags,

                isRead:
                    flags.includes(
                        "\\Seen"
                    ),

                isStarred:
                    flags.includes(
                        "\\Flagged"
                    ),

                hasAttachments:
                    bodyStructureHasAttachments(
                        bodyStructure
                    ),

                text:
                    null,

                html:
                    null,

                contentLoaded:
                    false
            });

        }


        return mails;


    } finally {

        await closeImapClient(
            client
        );

    }

}

async function importImapFolder(
    connection,
    folderPath,
    mailboxRole = "custom"
) {

    const client =
        createImapClient(
            connection
        );

    try {

        await client.connect();

        const mailbox =
            await client.mailboxOpen(
                folderPath
            );

        if (!mailbox.exists) {
            return [];
        }

        const uids =
            await client.search(
                {
                    all: true
                },
                {
                    uid: true
                }
            );

        if (!uids.length) {
            return [];
        }

        const mails = [];

        for await (
            const message
            of client.fetch(
                uids,
                {
                    uid: true,
                    envelope: true,
                    flags: true,
                    size: true,
                    bodyStructure: true
                },
                {
                    uid: true
                }
            )
        ) {

            const flags =
                Array.from(
                    message.flags || []
                );

            const bodyStructure =
                message.bodyStructure ||
                null;

            mails.push({
                provider:
                    "imap",

                mailboxPath:
                    folderPath,

                mailboxRole:
                    mailboxRole,

                externalId:
                    `imap:${connection.email}:${folderPath}:${message.uid}`,

                uid:
                    message.uid,

                messageId:
                    message.envelope?.messageId ||
                    null,

                inReplyTo:
                    message.envelope?.inReplyTo ||
                    null,

                subject:
                    message.envelope?.subject ||
                    "",

                from:
                    message.envelope?.from ||
                    [],

                to:
                    message.envelope?.to ||
                    [],

                cc:
                    message.envelope?.cc ||
                    [],

                bcc:
                    message.envelope?.bcc ||
                    [],

                date:
                    message.envelope?.date ||
                    null,

                size:
                    Number(
                        message.size || 0
                    ),

                flags,

                isRead:
                    flags.includes(
                        "\\Seen"
                    ),

                isStarred:
                    flags.includes(
                        "\\Flagged"
                    ),

                hasAttachments:
                    bodyStructureHasAttachments(
                        bodyStructure
                    ),

                text:
                    null,

                html:
                    null,

                contentLoaded:
                    false
            });

        }

        return mails;

    } finally {

        await closeImapClient(
            client
        );

    }

}

async function importNewImapMessages(
    connection,
    lastUid = 0
) {

    const client =
        createImapClient(connection);

    try {

        await client.connect();

        const trashMailbox =
    await findImapTrashMailbox(client);

                const sentMailbox =
    await findImapSentMailbox(client);

console.log(
    "📤 IMAP SENT MAILBOX:",
    {
        email: connection.email,
        sentMailbox
    }
);

        const mailbox =
            await client.mailboxOpen(
                "INBOX"
            );

        if (!mailbox.exists) {

            return [];

        }


        const startUid =
            Number(lastUid || 0) + 1;

        console.log(
            "LIVE IMAP FETCH:",
            {
                email:
                    connection.email,

                lastUid:
                    Number(lastUid || 0),

                startUid
            }
        );


        const mails = [];

        for await (
            const message
            of client.fetch(
                `${startUid}:*`,
                {
                    uid: true,
                    envelope: true,
                    flags: true,
                    size: true,
                    bodyStructure: true
                },
                {
                    uid: true
                }
            )
        ) {

            if (
                Number(message.uid) <=
                Number(lastUid || 0)
            ) {
                continue;
            }


            const flags =
                Array.from(
                    message.flags || []
                );

            const bodyStructure =
                message.bodyStructure ||
                null;


            mails.push({

                provider:
                    "imap",

                externalId:
                    `imap:${connection.email}:${message.uid}`,

                uid:
                    message.uid,

                messageId:
                    message.envelope?.messageId ||
                    null,

                inReplyTo:
                    message.envelope?.inReplyTo ||
                    null,

                subject:
                    message.envelope?.subject ||
                    "",

                from:
                    message.envelope?.from ||
                    [],

                to:
                    message.envelope?.to ||
                    [],

                cc:
                    message.envelope?.cc ||
                    [],

                bcc:
                    message.envelope?.bcc ||
                    [],

                date:
                    message.envelope?.date ||
                    null,

                size:
                    Number(
                        message.size || 0
                    ),

                flags,

                isRead:
                    flags.includes(
                        "\\Seen"
                    ),

                isStarred:
                    flags.includes(
                        "\\Flagged"
                    ),

                hasAttachments:
                    bodyStructureHasAttachments(
                        bodyStructure
                    ),

                text:
                    null,

                html:
                    null,

                contentLoaded:
                    false

            });

        }


        console.log(
            "LIVE IMAP FETCH COMPLETE:",
            {
                email:
                    connection.email,

                newMessages:
                    mails.length
            }
        );

if (sentMailbox) {

    await client.mailboxOpen(
        sentMailbox
    );

    const sentUids =
        await client.search(
            {
                all: true
            },
            {
                uid: true
            }
        );

    const latestSentUids =
        sentUids.slice(-5);

    if (latestSentUids.length > 0) {

        for await (
            const message
            of client.fetch(
                latestSentUids,
                {
                    uid: true,
                    envelope: true,
                    flags: true,
                    size: true,
                    bodyStructure: true
                },
                {
                    uid: true
                }
            )
        ) {

            const flags =
                Array.from(
                    message.flags || []
                );

            const bodyStructure =
                message.bodyStructure ||
                null;

            mails.push({

                provider:
                    "imap",

                mailboxRole:
                    "sent",

                mailboxPath:
                    sentMailbox,

                externalId:
                    `imap:${connection.email}:${sentMailbox}:${message.uid}`,

                uid:
                    message.uid,

                messageId:
                    message.envelope?.messageId ||
                    null,

                inReplyTo:
                    message.envelope?.inReplyTo ||
                    null,

                subject:
                    message.envelope?.subject ||
                    "",

                from:
                    message.envelope?.from ||
                    [],

                to:
                    message.envelope?.to ||
                    [],

                cc:
                    message.envelope?.cc ||
                    [],

                bcc:
                    message.envelope?.bcc ||
                    [],

                date:
                    message.envelope?.date ||
                    null,

                size:
                    Number(
                        message.size || 0
                    ),

                flags,

                isRead:
                    true,

                isStarred:
                    flags.includes(
                        "\\Flagged"
                    ),

                hasAttachments:
                    bodyStructureHasAttachments(
                        bodyStructure
                    ),

                text:
                    null,

                html:
                    null,

                contentLoaded:
                    false

            });

        }

    }

}

if (trashMailbox) {

    await client.mailboxOpen(
        trashMailbox
    );

    const trashUids =
        await client.search(
            {
                all: true
            },
            {
                uid: true
            }
        );

    const latestTrashUids =
        trashUids.slice(-5);

    if (latestTrashUids.length > 0) {

        for await (
            const message
            of client.fetch(
                latestTrashUids,
                {
                    uid: true,
                    envelope: true,
                    flags: true,
                    size: true,
                    bodyStructure: true
                },
                {
                    uid: true
                }
            )
        ) {

            const flags =
                Array.from(
                    message.flags || []
                );

            const bodyStructure =
                message.bodyStructure ||
                null;

            mails.push({

                provider:
                    "imap",

                mailboxRole:
                    "trash",

                mailboxPath:
                    trashMailbox,

                externalId:
                    `imap:${connection.email}:${trashMailbox}:${message.uid}`,

                uid:
                    message.uid,

                messageId:
                    message.envelope?.messageId ||
                    null,

                inReplyTo:
                    message.envelope?.inReplyTo ||
                    null,

                subject:
                    message.envelope?.subject ||
                    "",

                from:
                    message.envelope?.from ||
                    [],

                to:
                    message.envelope?.to ||
                    [],

                cc:
                    message.envelope?.cc ||
                    [],

                bcc:
                    message.envelope?.bcc ||
                    [],

                date:
                    message.envelope?.date ||
                    null,

                size:
                    Number(
                        message.size || 0
                    ),

                flags,

                isRead:
                    flags.includes(
                        "\\Seen"
                    ),

                isStarred:
                    flags.includes(
                        "\\Flagged"
                    ),

                hasAttachments:
                    bodyStructureHasAttachments(
                        bodyStructure
                    ),

                text:
                    null,

                html:
                    null,

                contentLoaded:
                    false

            });

        }

    }

}

        return mails;


    } finally {

        await closeImapClient(
            client
        );

    }

}

async function findImapSentMailbox(client) {
    const mailboxes = await client.list();

    const sentBySpecialUse = mailboxes.find(
        mailbox =>
            mailbox.specialUse === "\\Sent"
    );

    if (sentBySpecialUse) {
        return sentBySpecialUse.path;
    }

    const fallbackNames = [
        "sent",
        "sent items",
        "sent messages",
        "gesendet",
        "gesendete elemente"
    ];

    const sentByName = mailboxes.find(
        mailbox =>
            fallbackNames.includes(
                String(mailbox.path || "")
                    .trim()
                    .toLowerCase()
            )
    );

    return sentByName?.path || null;
}

async function findImapTrashMailbox(client) {
    const mailboxes = await client.list();

    const trashBySpecialUse = mailboxes.find(
        mailbox =>
            mailbox.specialUse === "\\Trash"
    );

    if (trashBySpecialUse) {
        return trashBySpecialUse.path;
    }

    const fallbackNames = [
        "trash",
        "deleted",
        "deleted items",
        "deleted messages",
        "gelöscht",
        "gelöschte elemente",
        "papierkorb"
    ];

    const trashByName = mailboxes.find(
        mailbox =>
            fallbackNames.includes(
                String(mailbox.path || "")
                    .trim()
                    .toLowerCase()
            )
    );

    return trashByName?.path || null;
}

async function moveImapMessageToTrash(
    connection,
    mailboxPath,
    uid
) {

    const client =
        createImapClient(connection);

    try {

        await client.connect();

        const trashMailbox =
            await findImapTrashMailbox(
                client
            );

        if (!trashMailbox) {
            throw new Error(
                "Kein Papierkorb im Postfach gefunden."
            );
        }

        const sourceMailbox =
            mailboxPath || "INBOX";

        if (
            String(sourceMailbox) ===
            String(trashMailbox)
        ) {
            return {
                trashMailbox
            };
        }

        await client.mailboxOpen(
            sourceMailbox
        );

        await client.messageMove(
            Number(uid),
            trashMailbox,
            {
                uid: true
            }
        );

        return {
            trashMailbox
        };

    } finally {

        await closeImapClient(
            client
        );

    }

}

async function discoverImapFolders(
    client
) {

    const mailboxes =
        await client.list();

    const systemFolders = [];
    const customFolders = [];

    const getSystemRole = mailbox => {

        const specialUse =
            String(
                mailbox.specialUse ||
                ""
            ).toLowerCase();

        if (
            String(mailbox.path)
                .toUpperCase() ===
            "INBOX"
        ) {
            return "inbox";
        }

        if (
            specialUse === "\\sent"
        ) {
            return "sent";
        }

        if (
            specialUse === "\\trash"
        ) {
            return "trash";
        }

        if (
            specialUse === "\\drafts"
        ) {
            return "drafts";
        }

        if (
            specialUse === "\\junk"
        ) {
            return "junk";
        }

        if (
            specialUse === "\\archive"
        ) {
            return "archive";
        }

        if (
            specialUse === "\\all"
        ) {
            return "all";
        }

        if (
            specialUse === "\\flagged"
        ) {
            return "flagged";
        }

        return null;
    };

    for (
        const mailbox
        of mailboxes
    ) {

        const role =
            getSystemRole(
                mailbox
            );

        const folder = {

            id:
                mailbox.path,

            name:
                mailbox.name ||
                mailbox.path,

            path:
                mailbox.path,

            role:
                role,

            selectable:
                role === null,

            providerType:
                "imap",

            specialUse:
                mailbox.specialUse ||
                null

        };

        if (role) {

            systemFolders.push(
                folder
            );

        } else {

            customFolders.push(
                folder
            );

        }

    }

    return {
        systemFolders,
        customFolders
    };
}

async function loadImapMessage(
    connection,
    uid,
    mailboxPath = "INBOX"
) {
    const client = createImapClient(connection);

    try {
        await client.connect();

        await client.mailboxOpen(
            mailboxPath
        );

        const message = await client.fetchOne(
            String(uid),
            {
                uid: true,
                envelope: true,
                flags: true,
                source: true,
                bodyStructure: true
            },
            {
                uid: true
            }
        );

        if (!message) {
            throw new Error(
                `Die IMAP-Nachricht mit UID ${uid} wurde in ${mailboxPath} nicht gefunden.`
            );
        }

        return {
            uid: message.uid,

            envelope:
                message.envelope || null,

            flags:
                Array.from(
                    message.flags || []
                ),

            bodyStructure:
                message.bodyStructure || null,

            raw:
                message.source
                    ? message.source.toString("utf8")
                    : ""
        };
    } finally {
        await closeImapClient(client);
    }
}

function bodyStructureHasAttachments(part) {
    if (!part) {
        return false;
    }

    const disposition = String(
        part.disposition || ""
    ).toLowerCase();

    if (
        disposition === "attachment" ||
        part.dispositionParameters?.filename ||
        part.parameters?.name
    ) {
        return true;
    }

    if (Array.isArray(part.childNodes)) {
        return part.childNodes.some(
            bodyStructureHasAttachments
        );
    }

    return false;
}

async function closeImapClient(client) {
    if (client.usable) {
        await client.logout().catch(() => {});
        return;
    }

    client.close();
}

module.exports = {
    findImapSentMailbox,
    importImapFolder,
    moveImapMessageToTrash,
    findImapTrashMailbox,
    discoverImapFolders,
    createImapClient,
    importMailbox,
    importNewImapMessages,
    loadImapMessage,
    saveSentMailToImap
};
