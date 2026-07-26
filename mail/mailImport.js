const { ImapFlow } = require("imapflow");

async function importMailbox(connection) {
    switch (connection.provider) {
        case "google":
            throw new Error("Google-Import noch nicht implementiert.");

        case "microsoft":
            throw new Error("Microsoft-Import noch nicht implementiert.");

        case "imap":
            return await importImapMailbox(connection);

        default:
            throw new Error(`Unbekannter Provider: ${connection.provider}`);
    }
}

const { ImapFlow } = require("imapflow");

async function importImapMailbox(connection) {

    const client = new ImapFlow({
        host: connection.imap_host,
        port: connection.imap_port,
        secure: connection.imap_secure,

        auth: {
            user: connection.email,
            pass: connection.password
        }
    });

    await client.connect();

    const mailbox = await client.mailboxOpen("INBOX");

    console.log(`📥 ${mailbox.exists} Nachrichten gefunden.`);

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

            date: message.envelope?.date || null,

            flags: message.flags || [],

            raw: message.source.toString()

        });

    }

    await client.logout();

    return mails;

}

module.exports = {
    importMailbox
};