const { ImapFlow } = require("imapflow");

async function importMailbox(connection) {
    switch (connection.provider) {
        case "google":
            throw new Error("Google-Import noch nicht implementiert.");

        case "microsoft":
            throw new Error("Microsoft-Import noch nicht implementiert.");

        case "imap":
            return importImapMailbox(connection);

        default:
            throw new Error(
                `Unbekannter Provider: ${connection.provider}`
            );
    }
}

async function importImapMailbox(connection) {
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

    try {
        await client.connect();

        const mailbox = await client.mailboxOpen("INBOX");

        console.log(`📥 ${mailbox.exists} Nachrichten gefunden.`);

        if (!mailbox.exists) {
            return [];
        }

        const mails = [];

        for await (const message of client.fetch("1:*", {
            uid: true,
            envelope: true,
            source: true,
            flags: true
        })) {
            mails.push({
                uid: message.uid,

                subject: message.envelope?.subject || "",

                from: message.envelope?.from || [],
                to: message.envelope?.to || [],
                cc: message.envelope?.cc || [],
                bcc: message.envelope?.bcc || [],

                date: message.envelope?.date || null,

                flags: Array.from(message.flags || []),

                raw: message.source
                    ? message.source.toString("utf8")
                    : ""
            });
        }

        return mails;
    } finally {
        if (client.usable) {
            await client.logout().catch(() => {});
        } else {
            client.close();
        }
    }
}

module.exports = {
    importMailbox
};