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
    streamImapFolderBatches,
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

const supabaseAuth = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        }
    }
);

const {
    createGoogleAuthUrl,
    exchangeGoogleCode
} = require("./google/googleMail");

let connectedGoogleTokens = null;

app.use(express.json());

const WORKPILOT_ORIGINS = new Set([
    "https://workpilot-app.de",
    "https://www.workpilot-app.de"
]);

app.use((req, res, next) => {
    const safeMethods = ["GET", "HEAD", "OPTIONS"];

    if (safeMethods.includes(req.method)) {
        return next();
    }

    if (!req.path.startsWith("/api/")) {
        return next();
    }

    const origin = req.get("Origin");

    if (!WORKPILOT_ORIGINS.has(origin)) {
        return res.status(403).json({
            ok: false,
            error: "Anfrage aus Sicherheitsgründen blockiert."
        });
    }

    next();
});

const AUTH_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/"
};

function getCookie(req, name) {
    const cookieHeader = req.headers.cookie || "";

    const cookies = cookieHeader.split(";");

    for (const cookie of cookies) {
        const separator = cookie.indexOf("=");

        if (separator === -1) continue;

        const key = cookie.slice(0, separator).trim();
        const value = cookie.slice(separator + 1).trim();

        if (key === name) {
            try {
                return decodeURIComponent(value);
            } catch {
                return null;
            }
        }
    }

    return null;
}

app.use((req, res, next) => {
console.log("REQUEST:", req.method, req.url);
next();
});

const pendingSessionRefreshes = new Map();

async function refreshSupabaseToken(refreshToken) {
    const tokenKey = crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex");

    if (pendingSessionRefreshes.has(tokenKey)) {
        return pendingSessionRefreshes.get(tokenKey);
    }

    const refreshPromise = (async () => {
        const { data, error } =
            await supabaseAuth.auth.refreshSession({
                refresh_token: refreshToken
            });

        if (error || !data?.session) {
            return null;
        }

        return data.session;
    })();

    pendingSessionRefreshes.set(tokenKey, refreshPromise);

    try {
        return await refreshPromise;
    } finally {
        if (pendingSessionRefreshes.get(tokenKey) === refreshPromise) {
            pendingSessionRefreshes.delete(tokenKey);
        }
    }
}

async function refreshAuthSession(req, res) {
    const refreshToken = getCookie(req, "wp_refresh_token");

    if (!refreshToken) {
        return null;
    }

    try {
const session = await refreshSupabaseToken(refreshToken);

if (!session) {
    res.clearCookie("wp_access_token", AUTH_COOKIE_OPTIONS);
    res.clearCookie("wp_refresh_token", AUTH_COOKIE_OPTIONS);
    return null;
}

        res.cookie("wp_access_token", session.access_token, {
            ...AUTH_COOKIE_OPTIONS,
            maxAge: session.expires_in * 1000
        });

        res.cookie("wp_refresh_token", session.refresh_token, {
            ...AUTH_COOKIE_OPTIONS,
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        return session.access_token;

    } catch (error) {
        console.error("SESSION REFRESH ERROR:", error.message);
        return null;
    }
}

async function requireAuth(req, res, next) {
    try {

let token = getCookie(req, "wp_access_token");

let user = null;

if (token) {
    const { data, error } = await supabase.auth.getUser(token);

    if (!error && data?.user) {
        user = data.user;
    }
}

if (!user) {
    token = await refreshAuthSession(req, res);

    if (token) {
        const { data, error } = await supabase.auth.getUser(token);

        if (!error && data?.user) {
            user = data.user;
        }
    }
}

if (!user) {
    return res.status(401).json({
        ok: false,
        error: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an."
    });
}

req.user = user;

return next();

    } catch (error) {
        console.error("AUTH ERROR:", error.message);

        return res.status(500).json({
            ok: false,
            error: "Anmeldung konnte nicht überprüft werden."
        });
    }
}


async function requireCompany(req, res, next) {
    try {
        if (!req.user?.id) {
            return res.status(401).json({
                ok: false,
                error: "Bitte melde dich an."
            });
        }

        if (!req.user.email_confirmed_at) {
            return res.status(403).json({
                ok: false,
                error: "Bitte bestätige deine E-Mail-Adresse."
            });
        }

        const { data, error } = await supabase
            .from("company_members")
            .select("company_id, role")
            .eq("user_id", req.user.id)
            .limit(2);

        if (error) {
            throw error;
        }

        if (!data || data.length === 0) {
            return res.status(403).json({
                ok: false,
                code: "COMPANY_SETUP_REQUIRED",
                error: "Bitte richte zuerst dein Firmenkonto ein."
            });
        }

        if (data.length !== 1) {
            return res.status(403).json({
                ok: false,
                error: "Die Firmenzuordnung ist nicht eindeutig."
            });
        }

        req.companyId = data[0].company_id;
        req.companyRole = data[0].role;

        return next();

    } catch (error) {
        console.error("COMPANY AUTH ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Firmenzugriff konnte nicht überprüft werden."
        });
    }
}

app.use("/api", (req, res, next) => {
    const publicRoutes = new Set([
        "POST /auth/register",
        "POST /auth/login"
    ]);

    const authOnlyRoutes = new Set([
        "GET /auth/me",
        "POST /auth/setup-company",
        "POST /auth/logout"
    ]);

const routeKey = `${req.method} ${req.path}`;

if (routeKey === "GET /mailbox/google/callback") {
    return next();
}

if (publicRoutes.has(routeKey)) {
    return next();
}

requireAuth(req, res, () => {
        if (authOnlyRoutes.has(routeKey)) {
            return next();
        }

        return requireCompany(req, res, next);
    });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({
        ok: true,
        user: {
            id: req.user.id,
            email: req.user.email,
            emailConfirmed: Boolean(req.user.email_confirmed_at)
        }
    });
});

app.post("/api/auth/setup-company", requireAuth, async (req, res) => {
    try {
        const user = req.user;

        if (!user.email_confirmed_at) {
            return res.status(403).json({
                ok: false,
                error: "Bitte bestätige zuerst deine E-Mail-Adresse."
            });
        }

        const companyName = String(
            req.body?.companyName || ""
        ).trim();

        if (companyName.length < 2 || companyName.length > 150) {
            return res.status(400).json({
                ok: false,
                error: "Bitte gib einen gültigen Firmennamen ein."
            });
        }

        const { data: existingMember, error: memberCheckError } =
            await supabase
                .from("company_members")
                .select("company_id, role")
                .eq("user_id", user.id)
                .limit(1)
                .maybeSingle();

        if (memberCheckError) {
            throw memberCheckError;
        }

        if (existingMember) {
            return res.json({
                ok: true,
                alreadyExists: true,
                companyId: existingMember.company_id
            });
        }

        const trialEndsAt = new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
        ).toISOString();

        const { data: company, error: companyError } =
            await supabase
                .from("companies")
                .insert({
                    name: companyName,
                    plan: "starter",
                    subscription_status: "trialing",
                    trial_ends_at: trialEndsAt
                })
                .select("id, name")
                .single();

        if (companyError) {
            throw companyError;
        }

        const { error: membershipError } =
            await supabase
                .from("company_members")
                .insert({
                    company_id: company.id,
                    user_id: user.id,
                    role: "owner"
                });

        if (membershipError) {
            await supabase
                .from("companies")
                .delete()
                .eq("id", company.id);

            throw membershipError;
        }

        return res.status(201).json({
            ok: true,
            company: company,
            role: "owner",
            trialEndsAt: trialEndsAt
        });

    } catch (error) {
        console.error("COMPANY SETUP ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Firmenkonto konnte nicht eingerichtet werden."
        });
    }
});

app.post("/api/auth/register", async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim();
        const companyName = String(req.body?.companyName || "").trim();
        const email = String(req.body?.email || "").trim().toLowerCase();
        const password = String(req.body?.password || "");

        if (
            name.length < 2 ||
            name.length > 100 ||
            companyName.length < 2 ||
            companyName.length > 150 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            password.length < 12
        ) {
            return res.status(400).json({
                ok: false,
                error: "Bitte überprüfe deine Registrierungsdaten."
            });
        }

        const { error } = await supabaseAuth.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: "https://workpilot-app.de/login",
                data: {
                    full_name: name,
                    company_name: companyName
                }
            }
        });

        if (error) {
            console.error("REGISTER ERROR:", error.message);

            return res.status(400).json({
                ok: false,
                error: "Registrierung konnte nicht abgeschlossen werden."
            });
        }

        return res.json({
            ok: true,
            message: "Bitte prüfe dein E-Mail-Postfach."
        });

    } catch (error) {
        console.error("REGISTER ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Registrierung derzeit nicht möglich."
        });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const email = String(req.body?.email || "").trim();
        const password = String(req.body?.password || "");

        if (!email || !password) {
            return res.status(400).json({
                ok: false,
                error: "E-Mail und Passwort fehlen."
            });
        }

        const { data, error } =
            await supabaseAuth.auth.signInWithPassword({
                email,
                password
            });

        if (error || !data?.session) {
            return res.status(401).json({
                ok: false,
                error: "Anmeldung fehlgeschlagen. Prüfe deine Zugangsdaten und E-Mail-Bestätigung."
            });
        }

res.cookie("wp_access_token", data.session.access_token, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: data.session.expires_in * 1000
});

res.cookie("wp_refresh_token", data.session.refresh_token, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: 30 * 24 * 60 * 60 * 1000
});

return res.json({
    ok: true,
    message: "Anmeldung erfolgreich."
});

    } catch (error) {
        console.error("LOGIN ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Anmeldung derzeit nicht möglich."
        });
    }
});

app.post("/api/auth/logout", async (req, res) => {
    try {
        const accessToken = getCookie(req, "wp_access_token");

        res.clearCookie("wp_access_token", AUTH_COOKIE_OPTIONS);
        res.clearCookie("wp_refresh_token", AUTH_COOKIE_OPTIONS);

        if (accessToken) {
            const { error } = await supabase.auth.admin.signOut(
                accessToken,
                "local"
            );

            if (error) {
                console.error("LOGOUT REVOCATION ERROR:", error.message);
            }
        }

        return res.json({
            ok: true,
            message: "Du wurdest abgemeldet."
        });

    } catch (error) {
        console.error("LOGOUT ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Abmeldung konnte nicht vollständig abgeschlossen werden."
        });
    }
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


app.get("/api/mailbox/google/start", async (req, res) => {
    try {
        if (!req.companyId || !req.user?.id) {
            return res.status(403).json({
                ok: false,
                error: "Firmenzuordnung fehlt."
            });
        }

        const state = crypto.randomBytes(32).toString("hex");
        const stateHash = crypto
            .createHash("sha256")
            .update(state)
            .digest("hex");

        const expiresAt = new Date(
            Date.now() + 10 * 60 * 1000
        ).toISOString();

        const { error } = await supabase
            .from("google_oauth_states")
            .insert({
                state_hash: stateHash,
                company_id: req.companyId,
                user_id: req.user.id,
                expires_at: expiresAt
            });

        if (error) throw error;

        const url = createGoogleAuthUrl(state);

        return res.json({
            ok: true,
            url
        });

    } catch (error) {
        console.error("GOOGLE AUTH START ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Google-Verbindung konnte nicht gestartet werden."
        });
    }
});

app.get(
    "/api/mailbox/google/callback",
    requireAuth,
    async (req, res) => {
        try {
            const code = req.query.code;
            const state = req.query.state;

            if (
                typeof code !== "string" ||
                !code ||
                typeof state !== "string" ||
                !/^[a-f0-9]{64}$/.test(state)
            ) {
                return res.redirect("/settings?google=error");
            }

            const stateHash = crypto
                .createHash("sha256")
                .update(state)
                .digest("hex");

            const { data: states, error: stateError } =
                await supabase
                    .from("google_oauth_states")
                    .delete()
                    .eq("state_hash", stateHash)
                    .eq("user_id", req.user.id)
                    .gt("expires_at", new Date().toISOString())
                    .select("company_id, user_id");

            if (stateError) throw stateError;

            if (!states || states.length !== 1) {
                return res.redirect("/settings?google=error");
            }

            const companyId = states[0].company_id;

            const { data: membership, error: membershipError } =
                await supabase
                    .from("company_members")
                    .select("company_id")
                    .eq("company_id", companyId)
                    .eq("user_id", req.user.id)
                    .maybeSingle();

            if (membershipError) throw membershipError;

            if (!membership) {
                return res.redirect("/settings?google=error");
            }

            const { email, tokens } =
                await exchangeGoogleCode(code);

            if (!email || !tokens) {
                throw new Error("Ungültige Google-Antwort.");
            }

            const normalizedEmail =
                String(email).trim().toLowerCase();

            const { data: existing, error: existingError } =
                await supabase
                    .from("mailbox_connections")
                    .select("id, refresh_token")
                    .eq("company_id", companyId)
                    .eq("provider", "google")
                    .eq("email", normalizedEmail)
                    .maybeSingle();

            if (existingError) throw existingError;

            const refreshToken =
                tokens.refresh_token ||
                existing?.refresh_token ||
                null;

            if (!refreshToken) {
                throw new Error(
                    "Google hat keinen Refresh-Token zurückgegeben."
                );
            }

            const mailboxData = {
                company_id: companyId,
                provider: "google",
                provider_name: "Google",
                email: normalizedEmail,
                auth_method: "oauth",
                access_token: tokens.access_token || null,
                refresh_token: refreshToken,
                scope: tokens.scope || null,
                token_type: tokens.token_type || null,
                expiry_date: tokens.expiry_date || null,
                is_active: true,
                updated_at: new Date().toISOString()
            };

            const { error: mailboxError } =
                await supabase
                    .from("mailbox_connections")
                    .upsert(mailboxData, {
                        onConflict: "company_id,provider,email"
                    });

            if (mailboxError) throw mailboxError;

            console.log("GOOGLE MAILBOX SAVED:", {
                companyId,
                email: normalizedEmail
            });

            return res.redirect(
                `/settings?google=connected&email=${encodeURIComponent(normalizedEmail)}`
            );

        } catch (error) {
            console.error("GOOGLE AUTH CALLBACK ERROR:", {
                message: error.message,
                code: error.code
            });

            return res.redirect("/settings?google=error");
        }
    }
);



async function sendEmailFromActiveMailbox({
    companyId,
    to,
    subject,
    html,
    attachments = []
}) {
    if (!companyId) {
        throw new Error("Firmenzuordnung beim E-Mail-Versand fehlt.");
    }


const mailbox =
    await getActiveMailboxConnection(companyId);

    if (!mailbox) {
        throw new Error(
            "Kein aktives Postfach verbunden."
        );
    }

if (mailbox.provider === "google") {

const googleResult =
await sendEmailWithGoogle({
    companyId,
    to,
    subject,
    html,
    attachments
});

    return {
        sender:
            googleResult.sender,

        provider:
            "google",

        messageId:
            null,

        externalMessageId:
            googleResult.email?.id ||
            null,

        externalThreadId:
            googleResult.email?.threadId ||
            null
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
    companyId,
    mailboxEmail,
    mailboxPath = "INBOX"
) {

    if (!companyId) {
        throw new Error(
            "companyId fehlt bei getLastImapUid."
        );
    }

    const {
        data,
        error
    } = await supabase
.from("email_messages")
.select("imap_uid")
.eq(
    "company_id",
    companyId
)
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

async function countNewImapMails(
    mailbox,
    mails,
    sharedSeenExternalIds = new Set(),
    sharedSeenRfcIds = new Set()
) {
    if (!mailbox?.company_id) {
        throw new Error("Firmenzuordnung beim IMAP-Import fehlt.");
    }
    let newCount = 0;
    let existingCount = 0;

    const batchSize = 100;
    const seenExternalIds = sharedSeenExternalIds;
    const seenRfcIds = sharedSeenRfcIds;

    for (let i = 0; i < mails.length; i += batchSize) {
        const batch = mails.slice(i, i + batchSize);

        const externalIds = [...new Set(
            batch.map(mail => {
                const path = mail.mailboxPath || "INBOX";
                return `imap:${mailbox.email}:${path}:${mail.uid}`;
            })
        )];

        const rfcIds = [...new Set(
            batch.map(mail => mail.messageId).filter(Boolean)
        )];

        const { data: externalRows, error: externalError } =
            await supabase
                .from("email_messages")
.select("external_message_id")
.eq("company_id", mailbox.company_id)
.in("external_message_id", externalIds);

        if (externalError) {
            throw externalError;
        }

        let rfcRows = [];

        if (rfcIds.length) {
            const { data, error } = await supabase
                .from("email_messages")
.select("rfc_message_id")
.eq("company_id", mailbox.company_id)
.in("rfc_message_id", rfcIds);

            if (error) {
                throw error;
            }

            rfcRows = data || [];
        }

        const existingExternalIds = new Set(
            (externalRows || []).map(
                row => row.external_message_id
            )
        );

        const existingRfcIds = new Set(
            rfcRows.map(row => row.rfc_message_id)
        );

        for (const mail of batch) {
            const path = mail.mailboxPath || "INBOX";

            const externalId =
                `imap:${mailbox.email}:${path}:${mail.uid}`;

            const rfcId = mail.messageId || null;

const alreadyExists =
    seenExternalIds.has(externalId) ||
    existingExternalIds.has(externalId);

            if (alreadyExists) {
                existingCount++;
                continue;
            }

            newCount++;

            seenExternalIds.add(externalId);

            if (rfcId) {
                seenRfcIds.add(rfcId);
            }
        }

        console.log("📦 IMAP DB CHECK BATCH:", {
            batch: Math.floor(i / batchSize) + 1,
            checked: Math.min(i + batch.length, mails.length),
            total: mails.length
        });
    }

    console.log("📊 IMAP IMPORT VORPRÜFUNG:", {
        total: mails.length,
        new: newCount,
        existing: existingCount
    });

    return {
        newCount,
        existingCount
    };
}

async function saveImportedImapMails({
    mailbox,
    mails,
    onProgress,
    createDashboardNotificationEntry = true,
    manualImportNewCount = null,
    manualProgressOffset = 0,
    manualProgressTotal = manualImportNewCount,
    completedCountOffset = 0
}) {
    if (!mailbox?.company_id) {
        throw new Error("Firmenzuordnung beim IMAP-Speichern fehlt.");
    }

let savedCount = 0;
let analyzedCount = 0;
let processedCount = 0;
let completedCount = 0;

const isManualImport =
    Number.isInteger(manualImportNewCount) &&
    manualImportNewCount >= 0;

let manualProcessedCount = 0;

function reportCurrentImportProgress() {

if (isManualImport) {

    reportImapProgress(
        onProgress,
        manualProgressOffset + manualProcessedCount,
        manualProgressTotal,
        completedCountOffset + completedCount
    );

    return;
}

    reportImapProgress(
        onProgress,
        processedCount,
        mails.length,
        savedCount
    );
}

    const password =
        decryptMailPassword(
            mailbox.encrypted_password
        );


    const IMAP_SAVE_BATCH_SIZE = 100;

    for (
        let batchStart = 0;
        batchStart < mails.length;
        batchStart += IMAP_SAVE_BATCH_SIZE
    ) {
        const batch = mails.slice(
            batchStart,
            batchStart + IMAP_SAVE_BATCH_SIZE
        );

        const externalIds = [...new Set(
            batch.map(mail =>
                `imap:${mailbox.email}:${mail.mailboxPath || "INBOX"}:${mail.uid}`
            )
        )];

        const rfcIds = [...new Set(
            batch.map(mail => mail.messageId).filter(Boolean)
        )];

        const { data: externalRows, error: externalError } =
            await supabase
                .from("email_messages")
.select("id, external_message_id")
.eq("company_id", mailbox.company_id)
.eq("provider", "imap")
.eq("mailbox_email", mailbox.email)
.in("external_message_id", externalIds);

        if (externalError) {
            throw externalError;
        }

        let rfcRows = [];

        if (rfcIds.length) {
            const { data, error } = await supabase
                .from("email_messages")
.select("id, rfc_message_id")
.eq("company_id", mailbox.company_id)
.eq("provider", "imap")
.eq("mailbox_email", mailbox.email)
.in("rfc_message_id", rfcIds);

            if (error) {
                throw error;
            }

            rfcRows = data || [];
        }

        const existingExternalMap = new Map(
            (externalRows || []).map(row => [
                row.external_message_id,
                row
            ])
        );

        const existingRfcMap = new Map(
            rfcRows.map(row => [
                row.rfc_message_id,
                row
            ])
        );

        console.log("📦 IMAP SAVE BATCH:", {
            batch: Math.floor(batchStart / IMAP_SAVE_BATCH_SIZE) + 1,
            count: batch.length,
            total: mails.length
        });

        for (const mail of batch) {

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

const existingMessage =
    existingExternalMap.get(externalMessageId) || null;

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

reportCurrentImportProgress();

    continue;
}

// Eine RFC-Message-ID ist kein eindeutiger
// IMAP-Nachrichtenschlüssel.
//
// Insbesondere bei Kopien in mehreren Ordnern
// oder nach einem MOVE darf sie nicht allein
// zum Überschreiben bestehender Datensätze
// verwendet werden.
//
// Die bereits vorhandene Prüfung über
// external_message_id bleibt aktiv.
//
// Eine sichere Wiederzuordnung nach einem MOVE
// erfolgt separat anhand der Provider-Identität.

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
            contactEmail,
            mailbox.company_id
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
.eq("company_id", mailbox.company_id)
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
.eq("company_id", mailbox.company_id)
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
            company_id: mailbox.company_id,
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

if (isManualImport) {
    manualProcessedCount++;
}

reportCurrentImportProgress();

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
            company_id: mailbox.company_id,
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

imap_uidvalidity:
    mail.uidValidity || null,

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
            uid: mail.uid,
            subject: mail.subject,
            error: messageError
        }
    );

    if (isManualImport) {
        manualProcessedCount++;
    }

    reportCurrentImportProgress();

    continue;
}

savedCount++;

existingExternalMap.set(externalMessageId, {
    id: message.id,
    external_message_id: externalMessageId
});

if (rfcMessageId) {
    existingRfcMap.set(rfcMessageId, {
        id: message.id,
        rfc_message_id: rfcMessageId
    });
}

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
                    mailboxPath,
                    mail.uidValidity
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

let attachmentImportFailed = false;

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

        attachmentImportFailed = true;

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
        company_id: mailbox.company_id,
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

        attachmentImportFailed = true;

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

    attachmentImportFailed = true;

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
)
.eq(
    "company_id",
    mailbox.company_id
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

const isSpamOrTrash =
    mail.mailboxRole === "spam" ||
    mail.mailboxRole === "trash";

if (!isSpamOrTrash) {

    const allowClassification =
        direction === "inbound" &&
        String(mailboxPath)
            .toUpperCase() === "INBOX";

    await analyzeInboundEmail(
        messageForAnalysis,
        thread,
        {
            createDashboardNotificationEntry,
            allowClassification
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

if (!attachmentImportFailed) {
    completedCount++;
} else {
    console.warn(
        "⚠️ IMAP IMPORT UNVOLLSTÄNDIG – ANHANG FEHLGESCHLAGEN:",
        {
            uid: mail.uid,
            subject: mail.subject,
            messageId: message.id
        }
    );
}

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

if (isManualImport) {
    manualProcessedCount++;

    console.log(
        "📬 MANUELLER IMAP-FORTSCHRITT:",
        {
            processed: manualProcessedCount,
            total: manualImportNewCount,
            saved: savedCount
        }
    );
}

reportCurrentImportProgress();

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

    }

return {
    savedCount,
    analyzedCount,
    manualProcessedCount,
    completedCount
};

}

async function countNewGoogleMessages(mailbox, gmailMessages) {
    if (!mailbox?.company_id) {
        throw new Error("Firmenzuordnung beim Google-Import fehlt.");
    }

    const newMessages = [];
    let existingCount = 0;
    let incompleteCount = 0;

    const seenIds = new Set();
    const batchSize = 100;

    for (let i = 0; i < gmailMessages.length; i += batchSize) {
        const batch = gmailMessages.slice(i, i + batchSize);

        const ids = batch
            .map(message => message.id)
            .filter(Boolean);

        if (!ids.length) {
            existingCount += batch.length;
            continue;
        }

        const { data: existingRows, error } = await supabase
            .from("email_messages")
.select("external_message_id, content_loaded")
.eq("company_id", mailbox.company_id)
.eq("provider", "google")
.eq("mailbox_email", mailbox.email)
.in("external_message_id", ids);

        if (error) {
            throw error;
        }

        const existingMap = new Map(
            (existingRows || []).map(row => [
                row.external_message_id,
                row
            ])
        );

        for (const message of batch) {
            const id = message.id;

            if (!id || seenIds.has(id)) {
                existingCount++;
                continue;
            }

            seenIds.add(id);

            const existing = existingMap.get(id);

            if (!existing) {
                newMessages.push(message);
            } else if (existing.content_loaded !== true) {
                newMessages.push(message);
                incompleteCount++;
            } else {
                existingCount++;
            }
        }
    }

    console.log("📊 GOOGLE IMPORT VORPRÜFUNG:", {
        total: gmailMessages.length,
        pending: newMessages.length,
        incomplete: incompleteCount,
        existing: existingCount
    });

    return {
        newMessages,
        newCount: newMessages.length,
        existingCount,
        incompleteCount
    };
}

app.post("/api/mailbox/import", async (req, res) => {

let mailboxImportProgress = createEmptyMailboxImportProgress();
let mailboxProgressKey = null;
let lockedMailboxId = null;

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

    try {


const mailbox =
    await getActiveMailboxConnection(req.companyId);

if (!mailbox) {
    return res.status(404).json({
        success: false,
        message: "Kein aktives Postfach gefunden."
    });
}

mailboxProgressKey = getMailboxImportProgressKey(
    req.companyId,
    mailbox.id
);

if (
    activeManualMailboxImports.has(mailbox.id)
) {

    return res.status(409).json({
        success: false,
        message:
            "Für dieses Postfach läuft bereits ein manueller Import."
    });

}

activeManualMailboxImports.add(
    mailbox.id
);

console.log(
    "🔒 MANUELLER IMPORT GESPERRT:",
    mailbox.id,
    "AKTIVE SPERREN:",
    [...activeManualMailboxImports]
);

lockedMailboxId = mailbox.id;

    mailboxImportProgress = {
        running: true,
        total: 0,
        processed: 0,
        saved: 0,
        finished: false,
        error: null
    };

mailboxImportProgressByMailbox.set(
    mailboxProgressKey,
    mailboxImportProgress
);

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

const folderJobs = [
    {
        path: "INBOX",
        role: "inbox",
        range
    }
];

const scheduledPaths = new Set(["INBOX"]);

function addImportFolder(folderPath, role) {
    if (!folderPath || typeof folderPath !== "string") {
        return;
    }

    const normalized = folderPath.trim().toUpperCase();

    if (!normalized || scheduledPaths.has(normalized)) {
        return;
    }

    scheduledPaths.add(normalized);

    folderJobs.push({
        path: folderPath,
        role,
        range: "all"
    });
}

addImportFolder(sentMailbox, "sent");
addImportFolder(trashMailbox, "trash");
addImportFolder(spamMailbox, "spam");

for (const folderPath of selectedFolders) {
    addImportFolder(folderPath, "custom");
}

const sharedSeenExternalIds = new Set();
const sharedSeenRfcIds = new Set();

let newCount = 0;
let existingCount = 0;
let fetchedCount = 0;

for (const job of folderJobs) {

    for await (
        const { mails: batch }
        of streamImapFolderBatches(
            connection,
            job.path,
            job.role,
            job.range
        )
    ) {

        fetchedCount += batch.length;

        const result = await countNewImapMails(
            mailbox,
            batch,
            sharedSeenExternalIds,
            sharedSeenRfcIds
        );

        newCount += result.newCount;
        existingCount += result.existingCount;
    }
}

console.log(
    "📬 MANUELLER IMAP STREAM – VORPRÜFUNG:",
    {
        fetched: fetchedCount,
        new: newCount,
        existing: existingCount
    }
);

mailboxImportProgress.total = newCount;
mailboxImportProgress.processed = 0;
mailboxImportProgress.saved = 0;

let streamingProcessedCount = 0;
let streamingSavedCount = 0;
let streamingCompletedCount = 0;

for (const job of folderJobs) {

    for await (
        const { mails: batch }
        of streamImapFolderBatches(
            connection,
            job.path,
            job.role,
            job.range
        )
    ) {

        const result = await saveImportedImapMails({
            mailbox,
            mails: batch,

            manualImportNewCount: newCount,

            manualProgressOffset:
                streamingProcessedCount,

            manualProgressTotal:
                newCount,

            completedCountOffset:
                streamingCompletedCount,

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

        streamingProcessedCount +=
            result.manualProcessedCount;

        streamingSavedCount +=
            result.savedCount;

        streamingCompletedCount +=
            result.completedCount;
    }
}

const manualProcessedCount =
    streamingProcessedCount;

const savedCount =
    streamingSavedCount;

const completedCount =
    streamingCompletedCount;

const updatedImportedFolders =
    Array.from(
        new Set(
            selectedFolders
        )
    );

const {
    error: importedFoldersUpdateError
} = await supabase
    .from("mailbox_connections")
    .update({
        imported_folders:
            updatedImportedFolders
    })
    .eq("company_id", req.companyId)
    .eq(
        "id",
        mailbox.id
    );

if (importedFoldersUpdateError) {
    throw importedFoldersUpdateError;
}

mailboxImportProgress = {
    running: false,
    provider: "imap",
    total: newCount,
    processed: manualProcessedCount,
    saved: completedCount,
    failed: Math.max(
        0,
        manualProcessedCount - completedCount
    ),
    finished: true,
    error: null
};

mailboxImportProgressByMailbox.set(
    mailboxProgressKey,
    mailboxImportProgress
);

console.log(
    "📊 IMAP IMPORT ABGESCHLOSSEN:",
    {
        email: mailbox.email,
        fetched: fetchedCount,
        new: newCount,
        existing: existingCount,
        processed: manualProcessedCount,
        saved: savedCount,
        completed: completedCount,
        failed: Math.max(
            0,
            manualProcessedCount - completedCount
        )
    }
);

return res.json({
    success: true,

    imported: fetchedCount,
    new: newCount,
    existing: existingCount,

    processed: manualProcessedCount,
    saved: savedCount,
    completed: completedCount,

    failed: Math.max(
        0,
        manualProcessedCount - completedCount
    ),

    provider: "imap"
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

        const updatedImportedFolders =
        Array.from(
            new Set(
                Array.isArray(selectedFolders)
                    ? selectedFolders
                    : []
            )
        );


const {
    error: importedFoldersUpdateError
} =
    await supabase
        .from("mailbox_connections")
        .update({
            imported_folders:
                updatedImportedFolders
        })
        .eq("company_id", req.companyId)
        .eq(
            "id",
            mailbox.id
        );


    if (importedFoldersUpdateError) {
        throw importedFoldersUpdateError;
    }


const {
    auth
} =
    await getActiveGoogleMailboxAuth(req.companyId);


    const gmail =
        google.gmail({
            version: "v1",
            auth
        });


const query =
    String(range) === "all"
        ? "in:inbox"
        : `in:inbox newer_than:${Number(range)}d`;


const gmailMessageMap =
    new Map();

async function collectGoogleMessages({
    q,
    labelIds
}) {

    let pageToken = null;

    do {

        const listResponse =
            await gmail.users.messages.list({
                userId: "me",

                maxResults: 500,

                q,

                labelIds,

                pageToken:
                    pageToken ||
                    undefined
            });


        const messages =
            listResponse.data.messages ||
            [];


        for (
            const gmailMessage
            of messages
        ) {

            gmailMessageMap.set(
                gmailMessage.id,
                gmailMessage
            );

        }


        pageToken =
            listResponse.data.nextPageToken ||
            null;


    } while (pageToken);

}


await collectGoogleMessages({
    q: query
});


for (
    const folderId
    of selectedFolders
) {

const folderQuery = undefined;

    await collectGoogleMessages({
        q: folderQuery,
        labelIds: [
            folderId
        ]
    });

}


const gmailMessages =
    Array.from(
        gmailMessageMap.values()
    );

const {
    newMessages,
    newCount,
    existingCount
} = await countNewGoogleMessages(
    mailbox,
    gmailMessages
);

mailboxImportProgress.total = newCount;
mailboxImportProgress.processed = 0;
mailboxImportProgress.saved = 0;

let processedCount = 0;
let savedCount = 0;
let failedCount = 0;

for (const gmailMessage of newMessages) {

    try {

const importedMessage =
    await importSingleGoogleMessage(
        gmail,
        gmailMessage.id,
        {
            companyId: req.companyId,
            createDashboardNotificationEntry: false,
            manualFullContent: true
        }
    );

        if (importedMessage) {
            savedCount++;
        } else {
            failedCount++;
        }

    } catch (messageError) {

        failedCount++;

        console.error(
            "GOOGLE MANUAL IMPORT MESSAGE ERROR:",
            {
                messageId: gmailMessage.id,
                error: messageError
            }
        );

    }

    processedCount++;

    mailboxImportProgress.processed =
        processedCount;

    mailboxImportProgress.saved =
        savedCount;

    console.log(
        "📬 MANUELLER GOOGLE-FORTSCHRITT:",
        {
            processed: processedCount,
            total: newCount,
            saved: savedCount,
            failed: failedCount
        }
    );
}

mailboxImportProgress = {
    running: false,
    provider: "google",
    total: newCount,
    processed: processedCount,
    saved: savedCount,
    failed: failedCount,
    finished: true,
    error: null
};

mailboxImportProgressByMailbox.set(
    mailboxProgressKey,
    mailboxImportProgress
);

console.log(
    "📊 GOOGLE IMPORT ABGESCHLOSSEN:",
    {
        email: mailbox.email,
        fetched: gmailMessages.length,
        new: newCount,
        existing: existingCount,
        processed: processedCount,
        saved: savedCount,
        failed: failedCount
    }
);

return res.json({
    success: true,
    imported: gmailMessages.length,
    new: newCount,
    existing: existingCount,
    processed: processedCount,
    saved: savedCount,
    failed: failedCount,
    provider: "google"
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

mailboxImportProgressByMailbox.set(
    mailboxProgressKey,
    mailboxImportProgress
);


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

mailboxImportProgressByMailbox.set(
    mailboxProgressKey,
    mailboxImportProgress
);


        return res.status(400).json({
            success: false,
            message:
                providerError
        });


    } catch (error) {

        console.error(
            "MAILBOX IMPORT ERROR:",
            {
                message: error.message,
                code: error.code,
                authenticationFailed: error.authenticationFailed
            }
        );

        mailboxImportProgress.running = false;
        mailboxImportProgress.finished = true;
        mailboxImportProgress.error =
            error.message ||
            "Das Postfach konnte nicht importiert werden.";

        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: mailboxImportProgress.error
            });
        }

    } finally {

        if (lockedMailboxId !== null) {

            activeManualMailboxImports.delete(
                lockedMailboxId
            );

            console.log(
                "▶️ LIVE SYNC WIEDER FREIGEGEBEN:",
                lockedMailboxId
            );

        }

    }

});

app.get(
    "/api/mailbox/import-progress",
    async (req, res) => {
        try {
            const requestedMailboxId =
                String(req.query.mailboxId || "").trim();

            let mailbox;

            if (requestedMailboxId) {
                const { data, error } = await supabase
                    .from("mailbox_connections")
                    .select("id")
                    .eq("company_id", req.companyId)
                    .eq("id", requestedMailboxId)
                    .maybeSingle();

                if (error) throw error;

                mailbox = data;
            } else {
                mailbox =
                    await getActiveMailboxConnection(req.companyId);
            }

            if (!mailbox) {
                return res.status(404).json({
                    success: false,
                    message: "Postfach nicht gefunden."
                });
            }

            const key = getMailboxImportProgressKey(
                req.companyId,
                mailbox.id
            );

            const progress =
                mailboxImportProgressByMailbox.get(key) ||
                createEmptyMailboxImportProgress();

            return res.json({
                success: true,
                mailboxId: mailbox.id,
                progress
            });

        } catch (error) {
            console.error(
                "MAILBOX IMPORT PROGRESS ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Importfortschritt konnte nicht geladen werden."
            });
        }
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
                company_id: req.companyId,
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
            onConflict: "company_id,provider,email"
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

async function getActiveGoogleMailboxAuth(companyId) {
    if (!companyId) {
        throw new Error("Firmenzuordnung für Google-Postfach fehlt.");
    }

    const { data: mailbox, error } = await supabase
        .from("mailbox_connections")
        .select("*")
        .eq("company_id", companyId)
        .eq("provider", "google")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!mailbox) {
        throw new Error("Bitte verbinde zuerst ein Google-Postfach.");
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

    return { auth, mailbox };
}

async function getActiveMailboxConnection(companyId) {
    if (!companyId) {
        throw new Error("Firmenzuordnung für Postfachzugriff fehlt.");
    }

    const { data: mailboxes, error } = await supabase
        .from("mailbox_connections")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false });

    if (error) {
        throw error;
    }

    if (!mailboxes || mailboxes.length === 0) {
        throw new Error("Bitte verbinde zuerst ein Postfach.");
    }

    if (mailboxes.length > 1) {
        console.warn(
            "Mehrere aktive Postfächer innerhalb der Firma:",
            companyId
        );
    }

    return mailboxes[0];
}

async function startGoogleMailboxWatch(companyId) {
    if (!companyId) {
        throw new Error("Firmenzuordnung für Google-Watch fehlt.");
    }

    const { auth, mailbox } =
        await getActiveGoogleMailboxAuth(companyId);

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
.eq("id", mailbox.id)
.eq("company_id", companyId);

return response.data;
}

app.post("/api/mailbox/google/watch", async (req, res) => {
try {
const watch = await startGoogleMailboxWatch(req.companyId);

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

async function sendEmailWithGoogle({
    companyId,
    to,
    subject,
    html,
    attachments = []
}) {
    if (!companyId) {
        throw new Error("Firmenzuordnung beim Google-Versand fehlt.");
    }

    const {
        auth,
        mailbox
    } =
        await getActiveGoogleMailboxAuth(companyId);


    const gmail =
        google.gmail({
            version: "v1",
            auth
        });


    const mailOptions = {
        from:
            mailbox.email,

        to,
        subject,
        html,

        attachments:
            attachments.map(
                file => ({
                    filename:
                        file.originalname,

                    content:
                        file.buffer,

                    contentType:
                        file.mimetype
                })
            )
    };


    const rawMessage =
        await new MailComposer(
            mailOptions
        )
            .compile()
            .build();


    const result =
        await gmail.users.messages.send({
            userId: "me",

            requestBody: {
                raw:
                    makeBase64Url(
                        rawMessage
                    )
            }
        });


    return {
        provider:
            "google",

        email:
            result.data,

        sender:
            mailbox.email
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
    await getActiveMailboxConnection(req.companyId);

if (
    mailbox.provider === "google"
) {

    const {
        auth
    } =
await getActiveGoogleMailboxAuth(req.companyId);

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

app.post(
    "/api/mailbox/folders",
    async (req, res) => {

        let client = null;

        try {

            const mailbox =
                await getActiveMailboxConnection(req.companyId);




            const rawName =
                typeof req.body?.name === "string"
                    ? req.body.name
                    : "";

            const folderName =
                rawName.trim();


            if (!folderName) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Bitte einen Ordnernamen eingeben."
                    });

            }


            if (folderName.length > 50) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Der Ordnername darf maximal 50 Zeichen lang sein."
                    });

            }


            const importedFolders =
                Array.isArray(
                    mailbox.imported_folders
                )
                    ? mailbox.imported_folders
                    : [];

            if (
                mailbox.provider === "google"
            ) {

                const {
                    auth
                } =
                    await getActiveGoogleMailboxAuth(req.companyId);


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
                    labelsResponse.data.labels ||
                    [];


                const existingFolderNames =
                    labels
                        .map(
                            label =>
                                String(
                                    label.name ||
                                    ""
                                )
                                    .trim()
                                    .toLowerCase()
                        );


                if (
                    existingFolderNames.includes(
                        folderName.toLowerCase()
                    )
                ) {

                    return res
                        .status(409)
                        .json({
                            success: false,
                            message:
                                "Ein Ordner mit diesem Namen existiert bereits."
                        });

                }


                const createResponse =
                    await gmail.users.labels.create({
                        userId: "me",

                        requestBody: {
                            name:
                                folderName,

                            labelListVisibility:
                                "labelShow",

                            messageListVisibility:
                                "show"
                        }
                    });


                const createdLabel =
                    createResponse.data;


                if (!createdLabel?.id) {

                    throw new Error(
                        "Google hat keine Label-ID zurückgegeben."
                    );

                }


                const updatedImportedFolders =
                    Array.from(
                        new Set([
                            ...importedFolders,
                            createdLabel.id
                        ])
                    );


                const {
                    error: updateError
                } =
                    await supabase
                        .from(
                            "mailbox_connections"
                        )
                        .update({
                            imported_folders:
                                updatedImportedFolders
                        })
                        .eq(
                            "id",
                            mailbox.id
                        );


                if (updateError) {
                    throw updateError;
                }


                return res.json({
                    success: true,

                    folder: {
                        id:
                            createdLabel.id,

                        name:
                            createdLabel.name ||
                            folderName,

                        path:
                            createdLabel.id
                    },

                    importedFolders:
                        updatedImportedFolders
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
                            "Dieser Mail-Provider unterstützt das Erstellen von Ordnern aktuell nicht."
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


            const existingFolderNames = [
                ...folders.systemFolders,
                ...folders.customFolders
            ]
                .map(
                    folder =>
                        String(
                            folder.path ||
                            folder.name ||
                            ""
                        )
                            .trim()
                            .toLowerCase()
                );


            if (
                existingFolderNames.includes(
                    folderName.toLowerCase()
                )
            ) {

                return res
                    .status(409)
                    .json({
                        success: false,
                        message:
                            "Ein Ordner mit diesem Namen existiert bereits."
                    });

            }


            await client.mailboxCreate(
                folderName
            );


            const updatedImportedFolders =
                Array.from(
                    new Set([
                        ...importedFolders,
                        folderName
                    ])
                );


            const {
                error: updateError
            } =
                await supabase
                    .from(
                        "mailbox_connections"
                    )
                    .update({
                        imported_folders:
                            updatedImportedFolders
                    })
                    .eq(
                        "id",
                        mailbox.id
                    );


            if (updateError) {
                throw updateError;
            }


            return res.json({
                success: true,

                folder: {
                    name:
                        folderName,

                    path:
                        folderName
                },

                importedFolders:
                    updatedImportedFolders
            });


        } catch (error) {

            console.error(
                "MAILBOX FOLDER CREATE ERROR:",
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        error.message ||
                        "Der Ordner konnte nicht erstellt werden."
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

app.delete(
    "/api/mailbox/folders",
    async (req, res) => {

        let client = null;

        try {

            const mailbox =
                await getActiveMailboxConnection(req.companyId);

            const rawFolderPath =
                typeof req.body?.folderPath === "string"
                    ? req.body.folderPath
                    : "";

            const folderPath =
                rawFolderPath.trim();


            if (!folderPath) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Der Ordnerpfad fehlt."
                    });

            }


            const importedFolders =
                Array.isArray(
                    mailbox.imported_folders
                )
                    ? mailbox.imported_folders
                    : [];

            if (
                mailbox.provider === "google"
            ) {

                const {
                    auth
                } =
                    await getActiveGoogleMailboxAuth(req.companyId);


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
                    labelsResponse.data.labels ||
                    [];


                const existingLabel =
                    labels.find(
                        label =>
                            label.id ===
                                folderPath &&
                            String(
                                label.type ||
                                ""
                            ).toLowerCase() ===
                                "user"
                    );


                if (!existingLabel) {

                    return res
                        .status(404)
                        .json({
                            success: false,
                            message:
                                "Der Ordner wurde im Google-Postfach nicht gefunden."
                        });

                }


                await gmail.users.labels.delete({
                    userId: "me",
                    id:
                        folderPath
                });


                const updatedImportedFolders =
                    importedFolders.filter(
                        path =>
                            String(path) !==
                            folderPath
                    );


                const {
                    error: updateError
                } =
                    await supabase
                        .from(
                            "mailbox_connections"
                        )
                        .update({
                            imported_folders:
                                updatedImportedFolders
                        })
                        .eq(
                            "id",
                            mailbox.id
                        );


                if (updateError) {
                    throw updateError;
                }


                return res.json({
                    success: true,

                    deletedFolder:
                        folderPath,

                    importedFolders:
                        updatedImportedFolders
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
                            "Dieser Mail-Provider unterstützt das Löschen von Ordnern aktuell nicht."
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


            const existingFolder =
                folders.customFolders.find(
                    folder => {

                        const path =
                            String(
                                folder.path ||
                                folder.name ||
                                ""
                            ).trim();

                        return (
                            path.toLowerCase() ===
                            folderPath.toLowerCase()
                        );

                    }
                );


            if (!existingFolder) {

                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "Der Ordner wurde im Originalpostfach nicht gefunden."
                    });

            }


            const realFolderPath =
                String(
                    existingFolder.path ||
                    existingFolder.name
                ).trim();


            await client.mailboxDelete(
                realFolderPath
            );


            const updatedImportedFolders =
                importedFolders.filter(
                    path =>
                        String(path)
                            .toLowerCase() !==
                        realFolderPath
                            .toLowerCase()
                );


            const {
                error: updateError
            } =
                await supabase
                    .from(
                        "mailbox_connections"
                    )
                    .update({
                        imported_folders:
                            updatedImportedFolders
                    })
                    .eq(
                        "id",
                        mailbox.id
                    );


            if (updateError) {
                throw updateError;
            }


            return res.json({
                success: true,
                deletedFolder:
                    realFolderPath,
                importedFolders:
                    updatedImportedFolders
            });


        } catch (error) {

            console.error(
                "MAILBOX FOLDER DELETE ERROR:",
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        error.message ||
                        "Der Ordner konnte nicht gelöscht werden."
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

app.put(
    "/api/mailbox/folders/empty",
    async (req, res) => {

        let client = null;
        let lock = null;

        try {

            const mailbox =
                await getActiveMailboxConnection(req.companyId);

            const rawFolderPath =
                typeof req.body?.folderPath === "string"
                    ? req.body.folderPath
                    : "";

            const folderPath =
                rawFolderPath.trim();


            if (!folderPath) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Der Ordnerpfad fehlt."
                    });

            }

                        if (
                mailbox.provider === "google"
            ) {

                const {
                    auth
                } =
                    await getActiveGoogleMailboxAuth(req.companyId);


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
                    labelsResponse.data.labels ||
                    [];


                const existingLabel =
                    labels.find(
                        label =>
                            label.id ===
                            folderPath &&
                            String(
                                label.type ||
                                ""
                            ).toLowerCase() ===
                                "user"
                    );


                if (!existingLabel) {

                    return res
                        .status(404)
                        .json({
                            success: false,
                            message:
                                "Der Ordner wurde im Google-Postfach nicht gefunden."
                        });

                }


                let pageToken =
                    null;

                let moved =
                    0;


                do {

                    const messagesResponse =
                        await gmail.users.messages.list({
                            userId: "me",

                            labelIds: [
                                folderPath
                            ],

                            maxResults:
                                500,

                            pageToken:
                                pageToken ||
                                undefined
                        });


                    const messages =
                        messagesResponse
                            .data
                            .messages ||
                        [];


                    for (
                        const message
                        of messages
                    ) {

                        await gmail.users.messages.trash({
                            userId: "me",
                            id: message.id
                        });

                        moved++;

                    }


                    pageToken =
                        messagesResponse
                            .data
                            .nextPageToken ||
                        null;


                } while (pageToken);


                return res.json({
                    success: true,

                    folder:
                        folderPath,

                    trash:
                        "TRASH",

                    moved
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
                            "Dieser Mail-Provider unterstützt das Leeren von Ordnern aktuell nicht."
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


            const existingFolder =
                folders.customFolders.find(
                    folder => {

                        const path =
                            String(
                                folder.path ||
                                folder.name ||
                                ""
                            ).trim();

                        return (
                            path.toLowerCase() ===
                            folderPath.toLowerCase()
                        );

                    }
                );


            if (!existingFolder) {

                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "Der Ordner wurde im Originalpostfach nicht gefunden."
                    });

            }


            const realFolderPath =
                String(
                    existingFolder.path ||
                    existingFolder.name
                ).trim();


            const trashFolder =
                folders.systemFolders.find(
                    folder =>
                        String(
                            folder.role ||
                            folder.specialUse ||
                            ""
                        )
                            .toLowerCase()
                            .includes("trash")
                );


            if (!trashFolder) {

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "Der Papierkorb des Originalpostfachs konnte nicht gefunden werden."
                    });

            }


            const trashPath =
                String(
                    trashFolder.path ||
                    trashFolder.name ||
                    ""
                ).trim();


            if (!trashPath) {

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "Der Papierkorbpfad konnte nicht ermittelt werden."
                    });

            }


            lock =
                await client.getMailboxLock(
                    realFolderPath
                );


            const uids =
                await client.search(
                    {
                        all: true
                    },
                    {
                        uid: true
                    }
                );


            if (
                Array.isArray(uids) &&
                uids.length > 0
            ) {

                await client.messageMove(
                    uids,
                    trashPath,
                    {
                        uid: true
                    }
                );

            }


            return res.json({
                success: true,
                folder:
                    realFolderPath,
                trash:
                    trashPath,
                moved:
                    Array.isArray(uids)
                        ? uids.length
                        : 0
            });


        } catch (error) {

            console.error(
                "MAILBOX FOLDER EMPTY ERROR:",
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        error.message ||
                        "Der Ordner konnte nicht geleert werden."
                });


        } finally {

            if (lock) {

                try {
                    lock.release();
                } catch (error) {

                }

            }


            if (client) {

                try {
                    await client.logout();
                } catch (error) {

                }

            }

        }

    }
);

app.put(
    "/api/mailbox/folders/rename",
    async (req, res) => {

        let client = null;

        try {

            const mailbox =
                await getActiveMailboxConnection(req.companyId);

            const rawOldPath =
                typeof req.body?.oldPath === "string"
                    ? req.body.oldPath
                    : "";

            const rawNewName =
                typeof req.body?.newName === "string"
                    ? req.body.newName
                    : "";


            const oldPath =
                rawOldPath.trim();

            const newName =
                rawNewName.trim();


            if (!oldPath) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Der bisherige Ordnerpfad fehlt."
                    });

            }


            if (!newName) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Bitte einen neuen Ordnernamen eingeben."
                    });

            }


            if (newName.length > 50) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Der Ordnername darf maximal 50 Zeichen lang sein."
                    });

            }


            const importedFolders =
                Array.isArray(
                    mailbox.imported_folders
                )
                    ? mailbox.imported_folders
                    : [];

                        if (
                mailbox.provider === "google"
            ) {

                const {
                    auth
                } =
                    await getActiveGoogleMailboxAuth(req.companyId);


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
                    labelsResponse.data.labels ||
                    [];


                const existingLabel =
                    labels.find(
                        label =>
                            label.id ===
                            oldPath
                    );


                if (
                    !existingLabel ||
                    String(
                        existingLabel.type ||
                        ""
                    ).toLowerCase() !== "user"
                ) {

                    return res
                        .status(404)
                        .json({
                            success: false,
                            message:
                                "Der Ordner wurde im Google-Postfach nicht gefunden."
                        });

                }


                const duplicateLabel =
                    labels.find(
                        label =>
                            label.id !==
                                oldPath &&
                            String(
                                label.name ||
                                ""
                            )
                                .trim()
                                .toLowerCase() ===
                            newName.toLowerCase()
                    );


                if (duplicateLabel) {

                    return res
                        .status(409)
                        .json({
                            success: false,
                            message:
                                "Ein Ordner mit diesem Namen existiert bereits."
                        });

                }


                if (
                    String(
                        existingLabel.name ||
                        ""
                    ).trim() === newName
                ) {

                    return res.json({
                        success: true,

                        oldPath,

                        newPath:
                            oldPath,

                        importedFolders
                    });

                }


                await gmail.users.labels.update({
                    userId: "me",

                    id:
                        oldPath,

                    requestBody: {
                        name:
                            newName
                    }
                });


                return res.json({
                    success: true,

                    oldPath,

                    newPath:
                        oldPath,

                    name:
                        newName,

                    importedFolders
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
                            "Dieser Mail-Provider unterstützt das Umbenennen von Ordnern aktuell nicht."
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


            const customFolderPaths =
                folders.customFolders
                    .map(
                        folder =>
                            String(
                                folder.path ||
                                folder.name ||
                                ""
                            )
                                .trim()
                    )
                    .filter(Boolean);


            const existingOldFolder =
                customFolderPaths.find(
                    folderPath =>
                        folderPath.toLowerCase() ===
                        oldPath.toLowerCase()
                );


            if (!existingOldFolder) {

                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "Der Ordner wurde im Originalpostfach nicht gefunden."
                    });

            }


            const duplicateFolder =
                customFolderPaths.find(
                    folderPath =>
                        folderPath.toLowerCase() ===
                            newName.toLowerCase() &&
                        folderPath.toLowerCase() !==
                            existingOldFolder.toLowerCase()
                );


            if (duplicateFolder) {

                return res
                    .status(409)
                    .json({
                        success: false,
                        message:
                            "Ein Ordner mit diesem Namen existiert bereits."
                    });

            }


            if (
                existingOldFolder === newName
            ) {

                return res.json({
                    success: true,
                    oldPath:
                        existingOldFolder,
                    newPath:
                        existingOldFolder
                });

            }


            await client.mailboxRename(
                existingOldFolder,
                newName
            );


            const updatedImportedFolders =
                Array.from(
                    new Set(
                        importedFolders.map(
                            folderPath => {

                                if (
                                    String(folderPath)
                                        .toLowerCase() ===
                                    existingOldFolder
                                        .toLowerCase()
                                ) {

                                    return newName;

                                }

                                return folderPath;

                            }
                        )
                    )
                );


            const {
                error: connectionUpdateError
            } =
                await supabase
                    .from(
                        "mailbox_connections"
                    )
                    .update({
                        imported_folders:
                            updatedImportedFolders
                    })
                    .eq(
                        "id",
                        mailbox.id
                    );


            if (connectionUpdateError) {
                throw connectionUpdateError;
            }


            const {
                error: messageUpdateError
            } =
                await supabase
                    .from(
                        "email_messages"
                    )
                    .update({
                        imap_mailbox:
                            newName
                    })
                    .eq(
                        "imap_mailbox",
                        existingOldFolder
                    );


            if (messageUpdateError) {
                throw messageUpdateError;
            }


            return res.json({
                success: true,

                oldPath:
                    existingOldFolder,

                newPath:
                    newName,

                importedFolders:
                    updatedImportedFolders
            });


        } catch (error) {

            console.error(
                "MAILBOX FOLDER RENAME ERROR:",
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        error.message ||
                        "Der Ordner konnte nicht umbenannt werden."
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
            await getActiveMailboxConnection(req.companyId);

        if (
            activeManualMailboxImports.has(mailbox.id)
        ) {

            console.log(
                "⏸️ AUTOMATISCHER LIVE-SYNC PAUSIERT:",
                mailbox.email
            );

            return res.json({
                success: true,
                skipped: true,
                reason: "manual_import_running"
            });

        }


if (
    mailbox.provider === "google"
) {

const {
    auth
} =
    await getActiveGoogleMailboxAuth(req.companyId);


    const gmail =
        google.gmail({
            version: "v1",
            auth
        });


const gmailMessageMap =
    new Map();


async function collectLiveGoogleMessages({
    q,
    labelIds
}) {

    const listResponse =
        await gmail.users.messages.list({
            userId: "me",

            maxResults: 50,

            q,

            labelIds
        });


    const messages =
        listResponse
            .data
            .messages ||
        [];


    for (
        const gmailMessage
        of messages
    ) {

        gmailMessageMap.set(
            gmailMessage.id,
            gmailMessage
        );

    }

}

const liveSyncQuery = "newer_than:1d";

await collectLiveGoogleMessages({
    q: liveSyncQuery
});

const importedFolders =
    Array.isArray(mailbox.imported_folders)
        ? mailbox.imported_folders
        : [];

const liveSyncFolderIds = [
    "INBOX",
    "TRASH",
    "SPAM",
    ...importedFolders
];

for (const folderId of new Set(liveSyncFolderIds)) {

    await collectLiveGoogleMessages({
        q: liveSyncQuery,
        labelIds: [folderId]
    });

}

console.log("📡 GOOGLE LIVE-SYNC ZEITFILTER:", {
    query: liveSyncQuery,
    folders: [...new Set(liveSyncFolderIds)],
    fetched: gmailMessageMap.size
});

const {
    data: incompleteGoogleMessages,
    error: incompleteGoogleError
} = await supabase
    .from("email_messages")
    .select("external_message_id")
    .eq("provider", "google")
    .eq("mailbox_email", mailbox.email)
    .or("content_loaded.is.null,content_loaded.eq.false")
    .not("external_message_id", "is", null)
    .limit(50);

if (incompleteGoogleError) {
    throw incompleteGoogleError;
}

let retryCount = 0;

for (const incompleteMessage of incompleteGoogleMessages || []) {

    const messageId =
        incompleteMessage.external_message_id;

    if (!messageId || gmailMessageMap.has(messageId)) {
        continue;
    }

    gmailMessageMap.set(messageId, {
        id: messageId
    });

    retryCount++;
}

console.log("🔄 GOOGLE WIEDERHOLUNGSVERSUCHE:", {
    mailbox: mailbox.email,
    additionalRetries: retryCount,
    pendingChecked: (incompleteGoogleMessages || []).length
});

const gmailMessages =
    Array.from(
        gmailMessageMap.values()
    );

let savedCount = 0;
let skippedCount = 0;
let failedCount = 0;

for (const gmailMessage of gmailMessages) {

    try {

const importedMessage =
    await importSingleGoogleMessage(
        gmail,
        gmailMessage.id,
        {
            companyId: req.companyId,
            createDashboardNotificationEntry: true,
            manualFullContent: true
        }
    );

        if (importedMessage) {
            savedCount++;
        } else {
            skippedCount++;
        }

    } catch (error) {

        failedCount++;

        console.error(
            "GOOGLE LIVE-SYNC MESSAGE ERROR:",
            {
                messageId: gmailMessage.id,
                error
            }
        );

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

        failed:
            failedCount,

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
        req.companyId,
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

        lastUid,

        Array.isArray(
            mailbox.imported_folders
        )
            ? mailbox.imported_folders
            : []
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
const { auth } = await getActiveGoogleMailboxAuth(req.companyId);

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
    gmailMessage.id,
    {
        companyId: req.companyId
    }
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
.eq("company_id", req.companyId)
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
.eq("id", id)
.eq("company_id", req.companyId);

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
.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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
company_id: req.companyId,
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

.eq("company_id", req.companyId)
.or(`sender.eq.${email},recipient.eq.${email}`);

}

await createDashboardEvent({
companyId: req.companyId,
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


async function findDocumentContact(companyId, recipientEmail, recipientPhone) {
    const email = String(recipientEmail || "").trim().toLowerCase();
    const phone = String(recipientPhone || "").replace(/\D/g, "");

    if (!email && !phone) return null;

    const { data: contacts, error } = await supabase
.from("contacts")
.select("id, email, phone")
.eq("company_id", companyId);

    if (error) {
        throw error;
    }

    const emailMatches = email
        ? contacts.filter(contact =>
            String(contact.email || "").trim().toLowerCase() === email
        )
        : [];

    if (emailMatches.length > 0) {
        return emailMatches.length === 1 ? emailMatches[0].id : null;
    }

    if (phone) {
        const phoneMatches = contacts.filter(contact =>
            String(contact.phone || "").replace(/\D/g, "") === phone
        );

        return phoneMatches.length === 1 ? phoneMatches[0].id : null;
    }

    return null;
}

app.post("/api/offers", async (req, res) => {
    try {
        const offer = req.body || {};

        if (!offer.id || typeof offer.id !== "string") {
            return res.status(400).json({
                ok: false,
                error: "Angebots-ID fehlt."
            });
        }

        const { data: existing, error: lookupError } =
            await supabase
                .from("offers")
                .select("id, contact_id")
                .eq("id", offer.id)
                .eq("company_id", req.companyId)
                .maybeSingle();

        if (lookupError) throw lookupError;

        let contactId = existing?.contact_id || null;

        if (!existing && offer.contactId) {
            const { data: contact, error } = await supabase
                .from("contacts")
                .select("id")
                .eq("id", offer.contactId)
                .eq("company_id", req.companyId)
                .maybeSingle();

            if (error) throw error;

            if (!contact) {
                return res.status(403).json({
                    ok: false,
                    error: "Kontakt gehört nicht zu deiner Firma."
                });
            }

            contactId = contact.id;
        }

        if (!existing && !contactId) {
            contactId = await findDocumentContact(
                req.companyId,
                offer.recipientEmail,
                offer.recipientPhone
            );
        }

        const values = {
            contact_id: contactId,
            offer_number: offer.offerNumber || null,
            status: offer.status || "open",
            data: offer,
            updated_at: new Date().toISOString()
        };

        let query;

        if (existing) {
            query = supabase
                .from("offers")
                .update(values)
                .eq("id", offer.id)
                .eq("company_id", req.companyId);
        } else {
            query = supabase
                .from("offers")
                .insert({
                    id: offer.id,
                    company_id: req.companyId,
                    ...values
                });
        }

        const { data, error } = await query
            .select()
            .single();

        if (error) {
            if (error.code === "23505") {
                return res.status(409).json({
                    ok: false,
                    error: "Angebots-ID ist bereits vergeben."
                });
            }

            throw error;
        }

        return res.json({ ok: true, offer: data });

    } catch (error) {
        console.error("OFFER SAVE ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Angebot konnte nicht gespeichert werden."
        });
    }
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
.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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

try {
    if (!invoice.contactId) {
invoice.contactId = await findDocumentContact(
    req.companyId,
    invoice.recipientEmail,
    invoice.recipientPhone
);
    }
} catch (error) {
    console.error("INVOICE CONTACT MATCH ERROR:", error);
    return res.status(500).json({
        ok: false,
        error: "Kontaktzuordnung konnte nicht geprüft werden."
    });
}

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
.eq("company_id", req.companyId)
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
.eq("id", id)
.eq("company_id", req.companyId);

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
.eq("company_id", req.companyId)
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
    try {
        const note = req.body || {};

        if (!note.contactId || typeof note.text !== "string" ||
            !note.text.trim()) {
            return res.status(400).json({
                ok: false,
                error: "Kontakt und Notiztext fehlen."
            });
        }

        const { data: contact, error: contactError } =
            await supabase
                .from("contacts")
                .select("id")
                .eq("id", note.contactId)
                .eq("company_id", req.companyId)
                .maybeSingle();

        if (contactError) throw contactError;

        if (!contact) {
            return res.status(404).json({
                ok: false,
                error: "Kontakt nicht gefunden."
            });
        }

        const { data, error } = await supabase
            .from("notes")
            .insert([{
                company_id: req.companyId,
                contact_id: contact.id,
                type: note.type || "note",
                text: note.text.trim(),
                source: note.source || "manual",
                data: note.data || {}
            }])
            .select()
            .single();

        if (error) throw error;

        return res.json({
            ok: true,
            note: data
        });

    } catch (error) {
        console.error("NOTE CREATE ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Notiz konnte nicht gespeichert werden."
        });
    }
});

app.delete("/api/notes/:id", async (req, res) => {
const { id } = req.params;

const { error } = await supabase

.from("notes")
.delete()
.eq("id", id)
.eq("company_id", req.companyId);

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
.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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
    try {
        const thread = req.body || {};

        let contactId = null;

        if (thread.contactId) {
            const { data: contact, error: contactError } =
                await supabase
                    .from("contacts")
                    .select("id")
                    .eq("id", thread.contactId)
                    .eq("company_id", req.companyId)
                    .maybeSingle();

            if (contactError) throw contactError;

            if (!contact) {
                return res.status(404).json({
                    ok: false,
                    error: "Kontakt nicht gefunden."
                });
            }

            contactId = contact.id;
        }

        if (thread.relatedId) {
            return res.status(400).json({
                ok: false,
                error: "Dokumentverknüpfungen sind vorübergehend gesperrt."
            });
        }

        const { data, error } = await supabase
            .from("email_threads")
            .insert([{
                company_id: req.companyId,
                contact_id: contactId,
                related_type: "general",
                related_id: null,
                subject: thread.subject || "Ohne Betreff",
                status: thread.status || "open",
                ai_summary: null,
                ai_category: null
            }])
            .select()
            .single();

        if (error) throw error;

        return res.json({
            ok: true,
            thread: data
        });

    } catch (error) {
        console.error("EMAIL THREAD CREATE ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "E-Mail-Thread konnte nicht erstellt werden."
        });
    }
});


app.post("/api/email-messages", async (req, res) => {
    return res.status(503).json({
        ok: false,
        code: "EMAIL_WRITE_TEMPORARILY_DISABLED",
        error: "Das Speichern von E-Mail-Nachrichten wird sicherheitstechnisch überarbeitet."
    });
});

app.get("/api/email-messages/:threadId", async (req, res) => {
const { threadId } = req.params;

const { data, error } = await supabase

.from("email_messages")
.select("*")
.eq("thread_id", threadId)
.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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
                    imap_uidvalidity,
                    imap_mailbox,
                    external_message_id
                `)
                .eq(
                    "id",
                    id
                )
                .eq(
                    "company_id",
                    req.companyId
                )
                .maybeSingle();


            if (messageLoadError) {
                throw messageLoadError;
            }

            if (!message) {
                return res.status(404).json({
                    ok: false,
                    error: "E-Mail nicht gefunden."
                });
            }


if (
    message.provider !== "google" &&
    message.provider !== "imap"
) {
    return res.status(400).json({
        ok: false,
        error: "Dieser Mailprovider wird nicht unterstützt."
    });
}

if (
    message.provider === "imap" &&
    (
        !Number.isSafeInteger(Number(message.imap_uid)) ||
        Number(message.imap_uid) <= 0
    )
) {
    return res.status(400).json({
        ok: false,
        error: "Für diese IMAP-E-Mail fehlt eine gültige UID."
    });
}

let providerTrashMailbox =
    message.imap_mailbox ||
    null;

                            if (
                message.provider === "google"
            ) {

                if (
                    !message.external_message_id
                ) {
                    throw new Error(
                        "Für diese Google-Mail fehlt die Gmail Message-ID."
                    );
                }

if (!message.mailbox_email) {
    return res.status(400).json({
        ok: false,
        error: "Die Postfachzuordnung dieser E-Mail fehlt."
    });
}

const { data: googleMailboxes, error: mailboxError } =
    await supabase
        .from("mailbox_connections")
        .select("*")
        .eq("company_id", req.companyId)
        .eq("provider", "google")
        .eq("email", message.mailbox_email)
        .eq("is_active", true)
        .limit(2);

if (mailboxError) {
    throw mailboxError;
}

if (!googleMailboxes || googleMailboxes.length !== 1) {
    return res.status(404).json({
        ok: false,
        error: "Das zugehörige Google-Postfach wurde nicht gefunden."
    });
}

const mailbox = googleMailboxes[0];

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

                const gmail =
                    google.gmail({
                        version: "v1",
                        auth
                    });

                await gmail.users.messages.trash({
                    userId: "me",
                    id:
                        message.external_message_id
                });

                providerTrashMailbox =
                    "TRASH";

            }

            if (
                message.provider === "imap" &&
                message.imap_uid
            ) {

if (!message.mailbox_email) {
    return res.status(400).json({
        ok: false,
        error: "Die Postfachzuordnung dieser E-Mail fehlt."
    });
}

const { data: imapMailboxes, error: mailboxError } =
    await supabase
        .from("mailbox_connections")
        .select("*")
        .eq("company_id", req.companyId)
        .eq("provider", "imap")
        .eq("email", message.mailbox_email)
        .eq("is_active", true)
        .limit(2);

if (mailboxError) {
    throw mailboxError;
}

if (!imapMailboxes || imapMailboxes.length !== 1) {
    return res.status(404).json({
        ok: false,
        error: "Das zugehörige IMAP-Postfach wurde nicht gefunden."
    });
}

const mailbox = imapMailboxes[0];


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
                        message.imap_uid,
                        message.imap_uidvalidity
                    );


providerTrashMailbox =
    moveResult.trashMailbox;

message.imap_uid =
    moveResult.destinationUid;

message.imap_uidvalidity = moveResult.destinationUidValidity;

            }


            if (message.provider === "imap" &&
                (!Number.isSafeInteger(Number(message.imap_uid)) || Number(message.imap_uid) <= 0)) {
                return res.status(409).json({ ok: false,
                    error: "Provider-MOVE erfolgt, aber Ziel-UID fehlt. Bitte Postfach synchronisieren." });
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
    providerTrashMailbox,

imap_uid:
    message.imap_uid,

imap_uidvalidity:
    message.imap_uidvalidity,

external_message_id:
    message.provider === "imap"
        ? `imap:${message.mailbox_email}:${providerTrashMailbox}:${Number(message.imap_uid)}`
        : message.external_message_id
                })
                .eq(
                    "id",
                    id
                )
                .eq(
                    "company_id",
                    req.companyId
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

function requireImapUidValidity(info, folder) {
    const value = info?.uidValidity;
    if (value == null || !/^\d+$/.test(String(value)) || BigInt(String(value)) <= 0n) {
        const error = new Error(`IMAP UIDVALIDITY fehlt oder ist ungültig: ${folder}`);
        error.code = "IMAP_UIDVALIDITY_INVALID";
        throw error;
    }
    return String(value);
}

function verifyImapUidValidity(actual, expected) {
    if (expected == null || String(expected) !== actual) {
        const error = new Error("IMAP-Identität nicht bestätigt. Bitte das Postfach sicher neu synchronisieren.");
        error.code = "IMAP_IDENTITY_UNVERIFIED";
        throw error;
    }
}

async function moveImapMessageToFolder(connection, sourceMailbox, uid, destinationMailbox, expectedUidValidity) {
    const client = createImapClient(connection);
    try {
        await client.connect();
        const sourceUid = Number(uid);
        if (!Number.isSafeInteger(sourceUid) || sourceUid <= 0) {
            throw new Error("Ungültige IMAP-UID.");
        }
        const sourceInfo = await client.mailboxOpen(sourceMailbox);
        const sourceUidValidity = requireImapUidValidity(sourceInfo, sourceMailbox);
        verifyImapUidValidity(sourceUidValidity, expectedUidValidity);
        const found = await client.fetchOne(sourceUid, { uid: true }, { uid: true });
        if (!found || Number(found.uid) !== sourceUid) {
            throw new Error("IMAP-Nachricht im Quellordner nicht gefunden.");
        }
        if (sourceMailbox === destinationMailbox) {
            return { sourceMailbox, destinationMailbox, sourceUid,
                destinationUid: sourceUid, destinationUidValidity: sourceUidValidity };
        }
        const result = await client.messageMove(sourceUid, destinationMailbox, { uid: true });
        const mapped = result?.uidMap instanceof Map ? Number(result.uidMap.get(sourceUid)) : null;
        const destinationUid = Number.isSafeInteger(mapped) && mapped > 0 ? mapped : null;
        const targetInfo = await client.mailboxOpen(destinationMailbox);
        const destinationUidValidity = requireImapUidValidity(targetInfo, destinationMailbox);
        return { sourceMailbox, destinationMailbox, sourceUid, sourceUidValidity,
            destinationUid, destinationUidValidity };
    } finally {
        await client.logout().catch(() => {});
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
                    imap_uidvalidity,
    imap_mailbox,
    external_message_id
`)
                .eq(
                    "id",
                    id
                )
                .eq(
                    "company_id",
                    req.companyId
                )
                .maybeSingle();


            if (messageLoadError) {
                throw messageLoadError;
            }

            if (!message) {
                return res.status(404).json({
                    ok: false,
                    error: "E-Mail nicht gefunden."
                });
            }


if (
    message.provider !== "imap" &&
    message.provider !== "google"
) {

    return res
        .status(400)
        .json({
            ok: false,
            error:
                "Diese E-Mail kann aktuell nicht providerseitig verschoben werden."
        });

}


if (
    message.provider === "imap" &&
    (
        !Number.isSafeInteger(Number(message.imap_uid)) ||
        Number(message.imap_uid) <= 0
    )
) {
    return res.status(400).json({
        ok: false,
        error: "Für diese IMAP-E-Mail fehlt eine gültige UID."
    });
}


if (
    message.provider === "google" &&
    !message.external_message_id
) {

    return res
        .status(400)
        .json({
            ok: false,
            error:
                "Für diese Google-E-Mail fehlt die Gmail-ID."
        });

}

if (!message.mailbox_email) {
    return res.status(400).json({
        ok: false,
        error: "Die Postfachzuordnung dieser E-Mail fehlt."
    });
}

const { data: mailboxes, error: mailboxError } =
    await supabase
        .from("mailbox_connections")
        .select("*")
        .eq("company_id", req.companyId)
        .eq("provider", message.provider)
        .eq("email", message.mailbox_email)
        .eq("is_active", true)
        .limit(2);

if (mailboxError) {
    throw mailboxError;
}

if (!mailboxes || mailboxes.length !== 1) {
    return res.status(404).json({
        ok: false,
        error: "Das zugehörige Postfach wurde nicht eindeutig gefunden."
    });
}

const mailbox = mailboxes[0];


            const importedFolders =
    Array.isArray(
        mailbox.imported_folders
    )
        ? mailbox.imported_folders
        : [];

const isSystemTarget =
    folder === "INBOX" ||
    folder === "SPAM";

if (
    !isSystemTarget &&
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

if (
    message.provider === "google"
) {

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

const gmail = google.gmail({
    version: "v1",
    auth
});


    const currentFolder =
        message.imap_mailbox ||
        "INBOX";

if (
    currentFolder === "TRASH"
) {

    await gmail.users.messages.untrash({
        userId: "me",

        id:
            message.external_message_id
    });


    const targetLabelIds =
        folder === "INBOX"
            ? ["INBOX"]
            : [folder];


    await gmail.users.messages.modify({
        userId: "me",

        id:
            message.external_message_id,

        requestBody: {
            addLabelIds:
                targetLabelIds,

            removeLabelIds:
                folder === "INBOX"
                    ? []
                    : ["INBOX"]
        }
    });


    const {
        data: updatedMessages,
        error
    } =
        await supabase
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
.eq(
    "company_id",
    req.companyId
)
.select();


    if (error) {

        return res
            .status(500)
            .json({
                ok: false,
                error:
                    error.message
            });

    }


    const data =
        Array.isArray(
            updatedMessages
        )
            ? updatedMessages[0]
            : null;


    if (!data) {

        return res
            .status(500)
            .json({
                ok: false,
                error:
                    "Die E-Mail wurde bei Google wiederhergestellt, konnte aber in WorkPilot nicht aktualisiert werden."
            });

    }


    return res.json({
        ok: true,
        message:
            data
    });

}

if (
    currentFolder === "SPAM"
) {

    const targetLabelIds =
        folder === "INBOX"
            ? ["INBOX"]
            : [folder];


    await gmail.users.messages.modify({
        userId: "me",

        id:
            message.external_message_id,

        requestBody: {
            addLabelIds:
                targetLabelIds,

            removeLabelIds: [
                "SPAM"
            ]
        }
    });


    const {
        data: updatedMessages,
        error
    } =
        await supabase
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
.eq(
    "company_id",
    req.companyId
)
.select();


    if (error) {

        return res
            .status(500)
            .json({
                ok: false,
                error:
                    error.message
            });

    }


    const data =
        Array.isArray(
            updatedMessages
        )
            ? updatedMessages[0]
            : null;


    if (!data) {

        return res
            .status(500)
            .json({
                ok: false,
                error:
                    "Die E-Mail wurde aus Google-Spam entfernt, konnte aber in WorkPilot nicht aktualisiert werden."
            });

    }


    return res.json({
        ok: true,
        message:
            data
    });

}

    const addLabelIds =
        currentFolder === folder
            ? []
            : [folder];


    const removeLabelIds = [];


    if (
        currentFolder !== folder &&
        (
            currentFolder === "INBOX" ||
            importedFolders.includes(
                currentFolder
            )
        )
    ) {

        removeLabelIds.push(
            currentFolder
        );

    }


    if (
        addLabelIds.length > 0 ||
        removeLabelIds.length > 0
    ) {

        await gmail.users.messages.modify({
            userId: "me",

            id:
                message.external_message_id,

            requestBody: {
                addLabelIds,
                removeLabelIds
            }
        });

    }


    const {
        data: updatedMessages,
        error
    } =
        await supabase
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
.eq(
    "company_id",
    req.companyId
)
.select();


    if (error) {

        return res
            .status(500)
            .json({
                ok: false,
                error:
                    error.message
            });

    }


    const data =
        Array.isArray(
            updatedMessages
        )
            ? updatedMessages[0]
            : null;


    if (!data) {

        return res
            .status(500)
            .json({
                ok: false,
                error:
                    "Die E-Mail wurde bei Google verschoben, konnte aber in WorkPilot nicht aktualisiert werden."
            });

    }


    return res.json({
        ok: true,
        message:
            data
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

let destinationMailbox =
    folder;


if (folder === "SPAM") {

    const client =
        createImapClient(
            connection
        );

    try {

        await client.connect();

        const {
            systemFolders
        } =
            await discoverImapFolders(
                client
            );


        const spamFolder =
            systemFolders.find(
                item =>
                    item.role === "junk"
            );


        if (!spamFolder?.path) {

            throw new Error(
                "Der Spamordner des Providers konnte nicht gefunden werden."
            );

        }


        destinationMailbox =
            spamFolder.path;

    } finally {

        try {

            await client.logout();

        } catch (error) {

        }

    }

}

let sourceMailbox =
    message.imap_mailbox ||
    "INBOX";

if (
    String(sourceMailbox)
        .toUpperCase() === "TRASH"
) {

    const client =
        createImapClient(
            connection
        );

    try {

        await client.connect();

        const trashMailbox =
            await findImapTrashMailbox(
                client
            );

        if (!trashMailbox) {
            throw new Error(
                "Der Papierkorb des Providers konnte nicht gefunden werden."
            );
        }

        sourceMailbox =
            trashMailbox;

    } finally {

        try {
            await client.logout();
        } catch (error) {
        }

    }

}

const moveResult =
    await moveImapMessageToFolder(
        connection,
        sourceMailbox,
        message.imap_uid,
        destinationMailbox,
        message.imap_uidvalidity
    );

if (
    !Number.isSafeInteger(
        Number(moveResult.destinationUid)
    ) ||
    Number(moveResult.destinationUid) <= 0
) {
    console.error(
        "IMAP MOVE COMPLETED WITHOUT DESTINATION UID",
        {
            messageId: id,
            sourceMailbox,
            destinationMailbox
        }
    );

    return res.status(409).json({
        ok: false,
        error:
            "Die E-Mail wurde beim Anbieter verschoben, " +
            "aber die neue UID konnte nicht ermittelt werden. " +
            "Bitte synchronisiere das Postfach erneut."
    });
}


const {
    data: updatedMessages,
    error
} = await supabase
    .from("email_messages")
    .update({
imap_mailbox:
    destinationMailbox,

imap_uid:
    Number(moveResult.destinationUid),

imap_uidvalidity:
    moveResult.destinationUidValidity,

external_message_id:
    `imap:${mailbox.email}:${destinationMailbox}:${Number(moveResult.destinationUid)}`,

deleted_at:
    null
    })
.eq(
    "id",
    id
)
.eq(
    "company_id",
    req.companyId
)
.select();

if (error) {

    return res
        .status(500)
        .json({
            ok: false,
            error:
                error.message
        });

}

const data =
    Array.isArray(updatedMessages)
        ? updatedMessages[0]
        : null;

if (!data) {

    return res
        .status(500)
        .json({
            ok: false,
            error:
                "Die E-Mail wurde beim Provider verschoben, konnte aber in WorkPilot nicht aktualisiert werden."
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
    try {
        const { id } = req.params;

        const { data: message, error: messageError } =
            await supabase
                .from("email_messages")
                .select(
                    "id, provider, mailbox_email, imap_mailbox, " +
                    "imap_uid, imap_uidvalidity, external_message_id, deleted_at"
                )
                .eq("id", id)
                .eq("company_id", req.companyId)
                .maybeSingle();

        if (messageError) throw messageError;

        if (!message) {
            return res.status(404).json({
                ok: false,
                error: "E-Mail nicht gefunden."
            });
        }

        if (!message.deleted_at) {
            return res.status(409).json({
                ok: false,
                error: "Diese E-Mail befindet sich nicht im Papierkorb."
            });
        }

        if (
            !["google", "imap"].includes(message.provider) ||
            !message.mailbox_email
        ) {
            return res.status(400).json({
                ok: false,
                error: "Die E-Mail kann nicht beim Anbieter wiederhergestellt werden."
            });
        }

        const { data: mailboxes, error: mailboxError } =
            await supabase
                .from("mailbox_connections")
                .select("*")
                .eq("company_id", req.companyId)
                .eq("provider", message.provider)
                .eq("email", message.mailbox_email)
                .eq("is_active", true)
                .limit(2);

        if (mailboxError) throw mailboxError;

        if (!mailboxes || mailboxes.length !== 1) {
            return res.status(404).json({
                ok: false,
                error: "Das zugehörige Postfach wurde nicht eindeutig gefunden."
            });
        }

        const mailbox = mailboxes[0];

        let newUid = message.imap_uid;
        let newUidValidity = message.imap_uidvalidity;
        let newExternalId = message.external_message_id;

        if (message.provider === "google") {
            if (!message.external_message_id) {
                return res.status(400).json({
                    ok: false,
                    error: "Die Gmail-Nachrichten-ID fehlt."
                });
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

            const gmail = google.gmail({
                version: "v1",
                auth
            });

            await gmail.users.messages.untrash({
                userId: "me",
                id: message.external_message_id
            });

            await gmail.users.messages.modify({
                userId: "me",
                id: message.external_message_id,
                requestBody: {
                    addLabelIds: ["INBOX"],
                    removeLabelIds: ["TRASH"]
                }
            });
        } else {
            const sourceUid = Number(message.imap_uid);

            if (
                !Number.isSafeInteger(sourceUid) ||
                sourceUid <= 0
            ) {
                return res.status(409).json({
                    ok: false,
                    error: "Die IMAP-UID fehlt. Bitte zuerst synchronisieren."
                });
            }

            const connection = {
                provider: "imap",
                email: mailbox.email,
                username: mailbox.username || mailbox.email,
                password: decryptMailPassword(
                    mailbox.encrypted_password
                ),
                imap_host: mailbox.imap_host,
                imap_port: mailbox.imap_port,
                imap_secure: mailbox.imap_secure
            };

            const client = createImapClient(connection);
            let trashMailbox;

            try {
                await client.connect();
                trashMailbox = await findImapTrashMailbox(client);
            } finally {
                await client.logout().catch(() => {});
            }

            if (!trashMailbox) {
                return res.status(409).json({
                    ok: false,
                    error: "Der Papierkorb des IMAP-Providers wurde nicht gefunden."
                });
            }

            const moveResult = await moveImapMessageToFolder(
                connection,
                trashMailbox,
                sourceUid,
                "INBOX",
                message.imap_uidvalidity
            );

            newUid = Number(moveResult.destinationUid);
            newUidValidity = moveResult.destinationUidValidity;

            if (
                !Number.isSafeInteger(newUid) ||
                newUid <= 0
            ) {
                return res.status(409).json({
                    ok: false,
                    error:
                        "Die Nachricht wurde beim Provider verschoben, " +
                        "aber die neue UID fehlt. Bitte Postfach synchronisieren."
                });
            }

            newExternalId =
                `imap:${mailbox.email}:INBOX:${newUid}`;
        }

        const { data: updated, error: updateError } =
            await supabase
                .from("email_messages")
                .update({
                    deleted_at: null,
                    imap_mailbox: "INBOX",
                    imap_uid: newUid,
                    imap_uidvalidity: message.provider === "imap" ? newUidValidity : message.imap_uidvalidity,
                    external_message_id: newExternalId
                })
                .eq("id", id)
                .eq("company_id", req.companyId)
                .select("id")
                .single();

        if (updateError) throw updateError;

        return res.json({
            ok: true,
            message: "E-Mail wurde wiederhergestellt.",
            id: updated.id
        });

    } catch (error) {
        console.error("EMAIL RESTORE ERROR:", error);

        return res.status(500).json({
            ok: false,
            error:
                "Wiederherstellung konnte nicht vollständig abgeschlossen werden. " +
                "Bitte Postfachstatus prüfen."
        });
    }
});


app.post("/api/email-reply", async (req, res) => {
    const { threadId, body, subject, recipient } = req.body || {};

    if (
        typeof threadId !== "string" ||
        !threadId.trim() ||
        typeof body !== "string" ||
        !body.trim() ||
        typeof recipient !== "string" ||
        !recipient.trim()
    ) {
        return res.status(400).json({
            ok: false,
            error: "Thread, Antworttext oder Empfänger fehlt."
        });
    }

    try {
        const { data: thread, error: threadError } =
            await supabase
                .from("email_threads")
                .select("id, contact_id")
                .eq("id", threadId)
                .eq("company_id", req.companyId)
                .maybeSingle();

        if (threadError) throw threadError;

        if (!thread) {
            return res.status(404).json({
                ok: false,
                error: "E-Mail-Thread nicht gefunden."
            });
        }

        const { data: originalMessage, error: originalError } =
            await supabase
                .from("email_messages")
                .select("contact_id")
                .eq("thread_id", threadId)
                .eq("company_id", req.companyId)
                .not("contact_id", "is", null)
                .order("created_at", { ascending: true })
                .limit(1)
                .maybeSingle();

        if (originalError) throw originalError;

        const matchedContact =
            await findMatchingContact(
                recipient,
                req.companyId
            );

        const finalContactId =
            originalMessage?.contact_id ||
            thread.contact_id ||
            matchedContact?.id ||
            null;

        if (finalContactId) {
            const { data: contact, error: contactError } =
                await supabase
                    .from("contacts")
                    .select("id")
                    .eq("id", finalContactId)
                    .eq("company_id", req.companyId)
                    .maybeSingle();

            if (contactError) throw contactError;

            if (!contact) {
                return res.status(403).json({
                    ok: false,
                    error: "Kontakt gehört nicht zu dieser Firma."
                });
            }
        }

        const replySubject =
            typeof subject === "string" &&
            /^re:/i.test(subject.trim())
                ? subject.trim()
                : `RE: ${
                    typeof subject === "string" && subject.trim()
                        ? subject.trim()
                        : "Ohne Betreff"
                }`;

        const escapedBody = body
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\r?\n/g, "<br>");

        const sentEmail = await sendEmailWithGoogle({
            companyId: req.companyId,
            to: recipient.trim(),
            subject: replySubject,
            html: escapedBody
        });

        const { data, error } = await supabase
            .from("email_messages")
            .insert([{
                company_id: req.companyId,
                thread_id: thread.id,
                contact_id: finalContactId,
                direction: "outbound",
                sender: sentEmail.sender,
                recipient: recipient.trim(),
                subject: replySubject,
                body,
                body_html: escapedBody,
                content_loaded: true,
                provider: "google",
                mailbox_email: sentEmail.sender,
                external_message_id: sentEmail.email?.id || null,
                external_thread_id: sentEmail.email?.threadId || null,
                message_status: "sent"
            }])
            .select()
            .single();

        if (error) throw error;

        return res.json({
            ok: true,
            message: data
        });

    } catch (error) {
        console.error("EMAIL REPLY ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Antwort konnte nicht verarbeitet werden."
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
    const { data: updatedMessages, error: updateError } =
        await supabase
            .from("email_messages")
            .update({
                ai_detected_intent: analysis.intent,
                ai_summary: analysis.summary,
                ai_suggested_reply: analysis.suggestedReply
            })
            .eq("id", messageId)
            .eq("company_id", req.companyId)
            .select("id");

    if (updateError) {
        throw updateError;
    }

    if (!updatedMessages || updatedMessages.length !== 1) {
        return res.status(404).json({
            ok: false,
            error: "E-Mail nicht gefunden."
        });
    }
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
    try {
        const { id } = req.params;

        const { data: deletedMessages, error } =
            await supabase
                .from("email_messages")
                .delete()
                .eq("id", id)
                .eq("company_id", req.companyId)
                .select("id");

        if (error) {
            throw error;
        }

        if (!deletedMessages || deletedMessages.length !== 1) {
            return res.status(404).json({
                ok: false,
                error: "E-Mail nicht gefunden."
            });
        }

        return res.json({
            ok: true
        });

    } catch (error) {
        console.error("EMAIL DELETE ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "E-Mail konnte nicht gelöscht werden."
        });
    }
});


async function createDashboardEvent({
companyId,
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

if (!companyId) {
    console.error("DASHBOARD EVENT BLOCKED: companyId fehlt.");
    return null;
}

const { data: event, error } = await supabase

.from("dashboard_events")
.insert([

{
company_id: companyId,
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
companyId,
eventId,

title,

message = "",

type = "info",

priority = "normal",

remindAfterDays = 5,

metadata = {}

}) {

if (!companyId) {
    console.error("DASHBOARD NOTIFICATION BLOCKED: companyId fehlt.");
    return null;
}

const { data, error } = await supabase

.from("dashboard_notifications")
.insert([

{
company_id: companyId,
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
    companyId,
    actionTarget,
    actionPayload = {}
}) {
    if (!companyId) {
        return {
            ok: false,
            error: "Firmenzuordnung fehlt."
        };
    }

    switch (actionTarget) {
        case "create_calendar_entry": {
            const threadId = actionPayload.threadId;

            if (!threadId || typeof threadId !== "string") {
                return {
                    ok: false,
                    error: "E-Mail-Thread fehlt."
                };
            }

            const { data: thread, error } = await supabase
                .from("email_threads")
                .select("id")
                .eq("id", threadId)
                .eq("company_id", companyId)
                .maybeSingle();

            if (error) throw error;

            if (!thread) {
                return {
                    ok: false,
                    error: "E-Mail-Thread nicht gefunden."
                };
            }

            return {
                ok: true,
                type: "navigation",
                target: `/emails?thread=${encodeURIComponent(thread.id)}`
            };
        }

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
    companyId: req.companyId,
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

.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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

.eq("id", notification.id)
.eq("company_id", notification.company_id);

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
.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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
company_id: req.companyId,
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
.eq("company_id", req.companyId)
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
.eq("id", id)
.eq("company_id", req.companyId);

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

async function findMatchingContact(email, companyId, name = "") {
    if (!companyId) {
        throw new Error("Firmenzuordnung bei der Kontaktsuche fehlt.");
    }

    if (!email || typeof email !== "string") {
        return null;
    }

    const normalizedEmail = email.trim();

    const { data: contact, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("company_id", companyId)
        .ilike("email", normalizedEmail)
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return contact || null;
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
        createDashboardNotificationEntry = true,
        allowClassification = true
    } = {}
) {

    if (
        !message?.company_id ||
        !thread?.company_id ||
        message.company_id !== thread.company_id
    ) {
        throw new Error(
            "Ungültige Firmenzuordnung bei der E-Mail-Analyse."
        );
    }

    const companyId = message.company_id;

const { data: updatedMessages, error: messageUpdateError } =
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
        .eq("id", message.id)
        .eq("company_id", companyId)
        .select("id");

if (messageUpdateError) {
    throw messageUpdateError;
}

if (!updatedMessages || updatedMessages.length !== 1) {
    throw new Error(
        "E-Mail-Analyse konnte keiner gültigen Firmen-E-Mail zugeordnet werden."
    );
}


    const threadUpdate = {
        ai_summary:
            analysis.summary
    };

    if (allowClassification) {
        threadUpdate.related_type =
            analysis.category;

        threadUpdate.ai_category =
            analysis.category;
    }


const { data: updatedThreads, error: threadUpdateError } =
    await supabase
        .from("email_threads")
        .update(threadUpdate)
        .eq("id", thread.id)
        .eq("company_id", companyId)
        .select("id");

if (threadUpdateError) {
    throw threadUpdateError;
}

if (!updatedThreads || updatedThreads.length !== 1) {
    throw new Error(
        "E-Mail-Konversation konnte keiner gültigen Firma zugeordnet werden."
    );
}


    if (!createDashboardNotificationEntry) {
        return;
    }


const dashboardEvent =
    await createDashboardEvent({
        companyId,

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
    companyId,

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
        createDashboardNotificationEntry = true,
        allowClassification = true
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
        createDashboardNotificationEntry,
        allowClassification
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
        createDashboardNotificationEntry,
        allowClassification
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
.eq("company_id", req.companyId)
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
company_id: req.companyId,
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
    companyId: req.companyId,
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

const {
    data: savedMessage,
    error: messageError
} =
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

has_attachments:
    true,

message_status:
    "sent",

            external_message_id:
                email.externalMessageId ||
                null,

            external_thread_id:
                email.externalThreadId ||
                null,

            provider:
                email.provider ||
                null,

            mailbox_email:
                email.sender ||
                null,

            imap_mailbox:
                email.provider === "google"
                    ? "SENT"
                    : null
        }
    ])
        .select()
    .single();

if (messageError) {
    throw messageError;
};

const pdfFileName =
    `Angebot-${offer.offerNumber || offer.id}.pdf`;

const filePath =
    `${savedMessage.id}/${Date.now()}-${pdfFileName}`;


const {
    error: uploadError
} =
    await supabase.storage
        .from("email-attachments")
        .upload(
            filePath,
            pdfBuffer,
            {
                contentType:
                    "application/pdf",

                upsert:
                    false
            }
        );


if (uploadError) {
    throw uploadError;
}


const {
    error: attachmentError
} =
    await supabase
        .from("email_attachments")
        .insert([
            {
                message_id:
                    savedMessage.id,

                file_name:
                    pdfFileName,

                file_size:
                    pdfBuffer.length,

                file_path:
                    filePath,

                mime_type:
                    "application/pdf",

                disposition:
                    "attachment",

                is_inline:
                    false
            }
        ]);


if (attachmentError) {
    throw attachmentError;
}

await createDashboardEvent({
companyId: req.companyId,
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
.eq("company_id", req.companyId)
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
company_id: req.companyId,
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
    companyId: req.companyId,
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

const {
    data: savedMessage,
    error: messageError
} =
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

                has_attachments:
                    true,

                message_status:
                    "sent",

                external_message_id:
                    email.externalMessageId ||
                    null,

                external_thread_id:
                    email.externalThreadId ||
                    null,

                provider:
                    email.provider ||
                    null,

                mailbox_email:
                    email.sender ||
                    null,

                imap_mailbox:
                    email.provider === "google"
                        ? "SENT"
                        : null
            }
        ])
        .select()
        .single();

if (messageError) {
    throw messageError;
}

const pdfFileName =
    `Rechnung-${invoice.invoiceNumber || invoice.id}.pdf`;

const filePath =
    `${savedMessage.id}/${Date.now()}-${pdfFileName}`;


const {
    error: uploadError
} =
    await supabase.storage
        .from("email-attachments")
        .upload(
            filePath,
            pdfBuffer,
            {
                contentType:
                    "application/pdf",

                upsert:
                    false
            }
        );


if (uploadError) {
    throw uploadError;
}


const {
    error: attachmentError
} =
    await supabase
        .from("email_attachments")
        .insert([
            {
                message_id:
                    savedMessage.id,

                file_name:
                    pdfFileName,

                file_size:
                    pdfBuffer.length,

                file_path:
                    filePath,

                mime_type:
                    "application/pdf",

                disposition:
                    "attachment",

                is_inline:
                    false
            }
        ]);


if (attachmentError) {
    throw attachmentError;
}

await createDashboardEvent({
companyId: req.companyId,
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

if (finalThreadId) {
    const { data: existingThread, error: threadError } =
        await supabase
            .from("email_threads")
            .select("id")
            .eq("id", finalThreadId)
            .eq("company_id", req.companyId)
            .maybeSingle();

    if (threadError) throw threadError;

    if (!existingThread) {
        return res.status(404).json({
            ok: false,
            error: "E-Mail-Thread nicht gefunden."
        });
    }
}

if (!finalThreadId) {

const { data: thread, error: threadError } = await supabase
.from("email_threads")
.insert([
{
company_id: req.companyId,
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
    companyId: req.companyId,
    to,
    subject,
    html,
    attachments: uploadedFiles
});

const matchedContact = await findMatchingContact(
    to,
    req.companyId
);

const { data: message, error: messageError } = await supabase
.from("email_messages")
.insert([
{
    company_id: req.companyId,
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
    email.messageId || null,

external_message_id:
    email.externalMessageId ||
    null,

external_thread_id:
    email.externalThreadId ||
    null,

provider:
    email.provider ||
    null,

mailbox_email:
    email.sender ||
    null,

imap_mailbox:
    email.provider === "google"
        ? "SENT"
        : null
}
])
.select()
.single();

if (messageError) throw messageError;

await createDashboardEvent({
companyId: req.companyId,
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
    company_id: req.companyId,

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
        company_id: mailbox.company_id,
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
company_id: mailbox.company_id,
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

async function completeManualGoogleMessage({
    gmail,
    gmailMessageId,
    message,
    thread,
    isSpamOrTrash,
    allowClassification,
    createDashboardNotificationEntry = false
}) {
    const rawResponse = await gmail.users.messages.get({
        userId: "me",
        id: gmailMessageId,
        format: "raw"
    });

    const raw = rawResponse.data.raw;

    if (!raw) {
        throw new Error("Gmail hat keinen vollständigen E-Mail-Inhalt geliefert.");
    }

    const rawBuffer = Buffer.from(
        raw.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
    );

    const parsed = await simpleParser(rawBuffer);

    const body = parsed.text || "";
    const bodyHtml = parsed.html || "";
    const attachments = parsed.attachments || [];

    const {
        data: existingAttachments,
        error: attachmentLookupError
    } = await supabase
        .from("email_attachments")
        .select("file_path")
        .eq("message_id", message.id);

    if (attachmentLookupError) {
        throw attachmentLookupError;
    }

    const existingPaths = new Set(
        (existingAttachments || []).map(item => item.file_path)
    );

    for (let index = 0; index < attachments.length; index++) {
        const attachment = attachments[index];

        const fileName =
            attachment.filename || `attachment-${index + 1}`;

        const safeFileName = fileName
            .replace(/[^\p{L}\p{N}._-]+/gu, "_")
            .slice(0, 180);

        const filePath =
            `${message.id}/gmail-${index}-${safeFileName}`;

        if (existingPaths.has(filePath)) {
            continue;
        }

        const mimeType =
            attachment.contentType || "application/octet-stream";

        const contentId = attachment.cid
            ? String(attachment.cid).replace(/^<|>$/g, "")
            : null;

        const disposition =
            attachment.contentDisposition || "attachment";

        const { error: uploadError } = await supabase.storage
            .from("email-attachments")
            .upload(filePath, attachment.content, {
                contentType: mimeType,
                upsert: true
            });

        if (uploadError) {
            throw uploadError;
        }

        const { error: attachmentError } = await supabase
            .from("email_attachments")
            .insert([{
                message_id: message.id,
                file_name: fileName,
                file_size:
                    attachment.size ||
                    attachment.content?.length ||
                    0,
                file_path: filePath,
                mime_type: mimeType,
                content_id: contentId,
                disposition,
                is_inline:
                    disposition === "inline" ||
                    Boolean(contentId)
            }]);

        if (attachmentError) {
            throw attachmentError;
        }

        existingPaths.add(filePath);
    }

    const { error: bodyError } = await supabase
        .from("email_messages")
        .update({
            body,
            body_html: bodyHtml,
            has_attachments: attachments.length > 0,
            content_loaded: false
        })
        .eq("id", message.id);

    if (bodyError) {
        throw bodyError;
    }

    if (!isSpamOrTrash) {
        await analyzeInboundEmail(
            {
                ...message,
                body,
                body_html: bodyHtml
            },
            thread,
{
    createDashboardNotificationEntry,
    allowClassification
}
        );
    }

    const { error: completeError } = await supabase
        .from("email_messages")
        .update({
            content_loaded: true
        })
        .eq("id", message.id);

    if (completeError) {
        throw completeError;
    }

    console.log("✅ GOOGLE EMAIL VOLLSTÄNDIG:", {
        messageId: message.id,
        subject: message.subject,
        attachments: attachments.length
    });

    return {
        ...message,
        body,
        body_html: bodyHtml,
        content_loaded: true
    };
}

const activeGoogleMessageImports = new Map();

async function importSingleGoogleMessage(
    gmail,
    gmailMessageId,
    options = {}
) {
    const companyId = options.companyId;

    if (!companyId) {
        throw new Error(
            "companyId fehlt beim Google-Einzelimport."
        );
    }

    const messageKey =
    `${companyId}:${String(gmailMessageId)}`;

    if (activeGoogleMessageImports.has(messageKey)) {

        console.log(
            "🔒 GOOGLE DOPPELIMPORT VERHINDERT:",
            messageKey
        );

        return await activeGoogleMessageImports.get(
            messageKey
        );
    }

    const importPromise = Promise.resolve().then(() =>
        importSingleGoogleMessageUnlocked(
            gmail,
            gmailMessageId,
            {
                ...options,
                manualFullContent: true
            }
        )
    );

    activeGoogleMessageImports.set(
        messageKey,
        importPromise
    );

    try {

        return await importPromise;

    } finally {

        if (
            activeGoogleMessageImports.get(messageKey) ===
            importPromise
        ) {
            activeGoogleMessageImports.delete(
                messageKey
            );
        }

    }

}

async function importSingleGoogleMessageUnlocked(
    gmail,
    gmailMessageId,
    {
        companyId,
        createDashboardNotificationEntry = true,
        manualFullContent = true
    } = {}
) {
    if (!companyId) {
        throw new Error(
            "companyId fehlt beim Google-Import."
        );
    }

const {
    mailbox
} =
    await getActiveGoogleMailboxAuth(companyId);


    const detailResponse =
        await gmail.users.messages.get({
            userId: "me",
            id: gmailMessageId,
            format: "metadata",
            metadataHeaders: [
                "From",
                "To",
                "Subject",
                "Date"
            ]
        });


    const messageData =
        detailResponse.data;

    const headers =
        messageData.payload?.headers || [];


    const getHeader = (name) => {

        const found =
            headers.find(
                (header) =>
                    header.name
                        .toLowerCase() ===
                    name.toLowerCase()
            );

        return found?.value || "";

    };


    const sender =
        extractEmailAddress(
            getHeader("From")
        );

    const recipient =
        extractEmailAddress(
            getHeader("To")
        );

    const subject =
        getHeader("Subject") ||
        "Ohne Betreff";

    const dateHeader =
        getHeader("Date");


    const createdAt =
        dateHeader
            ? new Date(
                dateHeader
            ).toISOString()
            : new Date().toISOString();


    const gmailThreadId =
        messageData.threadId;

    const gmailMessageIdFinal =
        messageData.id;


    const labelIds =
        Array.isArray(
            messageData.labelIds
        )
            ? messageData.labelIds
            : [];


    const isSent =
        labelIds.includes(
            "SENT"
        );

    const isTrash =
        labelIds.includes(
            "TRASH"
        );

    const isSpam =
        labelIds.includes(
            "SPAM"
        );

    const isInbox =
        labelIds.includes(
            "INBOX"
        );

    const isDraft =
    labelIds.includes(
        "DRAFT"
    );

if (isDraft) {
    return null;
}


    let googleMailbox =
        "INBOX";


    if (isTrash) {

        googleMailbox =
            "TRASH";

    } else if (isSpam) {

        googleMailbox =
            "SPAM";

    } else if (isSent) {

        googleMailbox =
            "SENT";

    } else if (isInbox) {

        googleMailbox =
            "INBOX";

    } else {

        const customLabel =
            labelIds.find(
                (labelId) =>
                    ![
                        "UNREAD",
                        "STARRED",
                        "IMPORTANT",
                        "CATEGORY_PERSONAL",
                        "CATEGORY_SOCIAL",
                        "CATEGORY_PROMOTIONS",
                        "CATEGORY_UPDATES",
                        "CATEGORY_FORUMS"
                    ].includes(
                        labelId
                    )
            );

        if (customLabel) {

            googleMailbox =
                customLabel;

        }

    }


    const direction =
        isSent
            ? "outbound"
            : "inbound";

const gmailReceivedAt = Number(
    messageData.internalDate || 0
);

const isRecentIncomingMessage =
    direction === "inbound" &&
    isInbox &&
    !isSpam &&
    !isTrash &&
    gmailReceivedAt > 0 &&
    gmailReceivedAt >= Date.now() - 24 * 60 * 60 * 1000;

const shouldCreateGoogleNotification =
    createDashboardNotificationEntry === true &&
    isRecentIncomingMessage;


const {
    data: existingMessage,
    error: existingMessageError
} =
    await supabase
        .from("email_messages")
        .select(`
            id,
            imap_mailbox,
            deleted_at,
            direction,
            message_status
        `)
        .eq("company_id", companyId)
.eq(
    "external_message_id",
    gmailMessageIdFinal
)
.eq(
    "provider",
    "google"
)
.eq(
    "mailbox_email",
    mailbox.email
)
.maybeSingle();


if (existingMessageError) {
    throw existingMessageError;
}

if (existingMessage) {

    const {
        data: updatedMessage,
        error: updateError
    } =
        await supabase
            .from("email_messages")
            .update({
                imap_mailbox:
                    googleMailbox,

                deleted_at:
                    isTrash
                        ? (
                            existingMessage.deleted_at ||
                            new Date().toISOString()
                        )
                        : null,

                direction,

                message_status:
                    direction === "outbound"
                        ? "sent"
                        : "received",

                mailbox_email:
                    mailbox.email,

                provider:
                    "google"
            })
.eq("id", existingMessage.id)
.eq("company_id", companyId)
.select()
.single();


    if (updateError) {
        throw updateError;
    }


if (manualFullContent) {

    if (updatedMessage.content_loaded === true) {
        return updatedMessage;
    }

    const { data: existingThread, error: threadLookupError } =
        await supabase
.from("email_threads")
.select("*")
.eq("id", updatedMessage.thread_id)
.eq("company_id", companyId)
.single();

    if (threadLookupError) {
        throw threadLookupError;
    }

return await completeManualGoogleMessage({
    gmail,
    gmailMessageId: gmailMessageIdFinal,
    message: updatedMessage,
    thread: existingThread,
    isSpamOrTrash: isSpam || isTrash,
    allowClassification:
        direction === "inbound" && isInbox,
    createDashboardNotificationEntry: false
});
}

return updatedMessage;

}


    let {
        data: thread
    } =
        await supabase
.from("email_threads")
.select("*")
.eq("company_id", companyId)
.eq("external_thread_id", gmailThreadId)
.maybeSingle();


    if (!thread) {

        const {
            data: newThread,
            error: threadError
        } =
            await supabase
                .from("email_threads")
.insert([
    {
        company_id: companyId,
        subject,
        related_type:
            "gmail",
                        related_id:
                            gmailThreadId,
                        status:
                            "open",
                        ai_category:
                            "Importiert",
                        manual_folder:
                            "inbox",
                        external_thread_id:
                            gmailThreadId
                    }
                ])
                .select()
                .single();


        if (threadError) {
            throw threadError;
        }


        thread =
            newThread;

    }


const matchedContact =
    await findMatchingContact(
        sender,
        companyId
    );


    const {
        data: message,
        error: messageError
    } =
        await supabase
.from("email_messages")
.insert([
    {
        company_id: companyId,
        thread_id:
            thread.id,

                    contact_id:
                        matchedContact?.id ||
                        null,

                    direction,

                    sender,

                    recipient,

                    subject,

                    body:
                        messageData.snippet ||
                        "",

                    message_status:
                        direction === "outbound"
                            ? "sent"
                            : "received",

                    external_message_id:
                        gmailMessageIdFinal,

                    external_thread_id:
                        gmailThreadId,

                    provider:
                        "google",

                    mailbox_email:
                        mailbox.email,

                    imap_mailbox:
                        googleMailbox,

                    deleted_at:
                        isTrash
                            ? new Date().toISOString()
                            : null,

                    created_at:
                        createdAt
                }
            ])
            .select()
            .single();


if (messageError) {

    if (messageError.code === "23505") {

        console.log(
            "🔄 GOOGLE IMPORT-KONFLIKT:",
            gmailMessageIdFinal
        );

const {
    data: concurrentMessage,
    error: concurrentLookupError
} = await supabase
    .from("email_messages")
    .select("*")
    .eq("company_id", companyId)
    .eq("provider", "google")
    .eq("mailbox_email", mailbox.email)
    .eq(
        "external_message_id",
        gmailMessageIdFinal
    )
    .maybeSingle();

        if (concurrentLookupError) {
            throw concurrentLookupError;
        }

        if (concurrentMessage) {

            if (concurrentMessage.content_loaded === true) {
                return concurrentMessage;
            }

            throw new Error(
                `Gmail-Nachricht ${gmailMessageIdFinal} ` +
                "wird möglicherweise bereits verarbeitet. " +
                "Ein späterer Sync kann sie erneut prüfen."
            );
        }

    }

    throw messageError;
}

    const isSpamOrTrash =
        isSpam ||
        isTrash;

if (manualFullContent) {
return await completeManualGoogleMessage({
    gmail,
    gmailMessageId: gmailMessageIdFinal,
    message,
    thread,
    isSpamOrTrash,
    allowClassification:
        direction === "inbound" && isInbox,
    createDashboardNotificationEntry:
        shouldCreateGoogleNotification
});
}

    if (!isSpamOrTrash) {

        const allowClassification =
            direction === "inbound" &&
            isInbox;


        await analyzeInboundEmail(
            message,
            thread,
            {
                createDashboardNotificationEntry,
                allowClassification
            }
        );

    }


    return message;

}

app.post("/api/gmail/webhook", async (req, res) => {
    return res.status(503).json({
        ok: false,
        error: "Gmail-Webhook vorübergehend deaktiviert."
    });

    try {
        const message = req.body?.message;

        if (!message?.data) {
            return res.status(200).json({ ok: true });
        }

        const payload = JSON.parse(
            Buffer.from(message.data, "base64").toString("utf8")
        );

        const { auth, mailbox } =
            await getActiveGoogleMailboxAuth();

        if (
            String(payload.emailAddress || "").toLowerCase() !==
            String(mailbox.email || "").toLowerCase()
        ) {
            console.warn(
                "⚠️ GOOGLE WEBHOOK: Anderes Postfach",
                payload.emailAddress
            );

            return res.status(200).json({
                ok: true,
                skipped: true
            });
        }

        const startHistoryId = mailbox.gmail_history_id;

        if (!startHistoryId) {
            throw new Error(
                "Gmail-History-Startpunkt fehlt. " +
                "Bitte Gmail-Watch erneut initialisieren."
            );
        }

        const gmail = google.gmail({
            version: "v1",
            auth
        });

        let pageToken = undefined;
        let latestHistoryId = null;
        const processedIds = new Set();

        do {
            const historyResponse =
                await gmail.users.history.list({
                    userId: "me",
                    startHistoryId: String(startHistoryId),
                    historyTypes: ["messageAdded"],
                    maxResults: 500,
                    pageToken
                });

            const history =
                historyResponse.data.history || [];

            for (const entry of history) {
                for (const added of entry.messagesAdded || []) {
                    const id = added.message?.id;

                    if (!id || processedIds.has(id)) {
                        continue;
                    }

                    await importSingleGoogleMessage(gmail, id);

                    processedIds.add(id);
                }
            }

            latestHistoryId =
                historyResponse.data.historyId ||
                latestHistoryId;

            pageToken =
                historyResponse.data.nextPageToken ||
                undefined;

        } while (pageToken);

        if (!latestHistoryId) {
            throw new Error(
                "Gmail hat keinen neuen History-Cursor geliefert."
            );
        }

        const { error: cursorError } = await supabase
            .from("mailbox_connections")
            .update({
                gmail_history_id: String(latestHistoryId),
                updated_at: new Date().toISOString()
            })
            .eq("id", mailbox.id);

        if (cursorError) {
            throw cursorError;
        }

        console.log("✅ GOOGLE WEBHOOK ABGESCHLOSSEN:", {
            email: mailbox.email,
            imported: processedIds.size,
            historyId: latestHistoryId
        });

        return res.status(200).json({
            ok: true
        });

    } catch (error) {
        console.error("❌ GOOGLE WEBHOOK ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Gmail-Verarbeitung fehlgeschlagen."
        });
    }
});

app.delete("/api/mailbox/disconnect", async (req, res) => {
try {
let auth = null;

try {
const googleMailbox = await getActiveGoogleMailboxAuth(req.companyId);
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
    .eq("company_id", req.companyId)
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
    try {
        const { id } = req.params;

        const { data: attachment, error: attachmentError } =
            await supabase
                .from("email_attachments")
                .select("id, file_path")
                .eq("id", id)
                .eq("company_id", req.companyId)
                .maybeSingle();

        if (attachmentError) {
            throw attachmentError;
        }

        if (!attachment) {
            return res.status(404).json({
                ok: false,
                error: "Anhang nicht gefunden."
            });
        }

        const { data, error } = await supabase.storage
            .from("email-attachments")
            .createSignedUrl(attachment.file_path, 60 * 5);

        if (error) {
            throw error;
        }

        return res.json({
            ok: true,
            url: data.signedUrl
        });

    } catch (error) {
        console.error("EMAIL ATTACHMENT OPEN ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Anhang konnte nicht geöffnet werden."
        });
    }
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
.eq("company_id", req.companyId)
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
.eq("company_id", req.companyId)
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
.eq("message_id", message.id)
.eq("company_id", req.companyId);

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

if (
    message.provider !== "imap" ||
    !message.mailbox_email ||
    !Number.isSafeInteger(Number(message.imap_uid)) ||
    Number(message.imap_uid) <= 0
) {
    return res.status(400).json({
        success: false,
        message: "Diese Nachricht kann nicht über IMAP nachgeladen werden."
    });
}

const { data: mailboxes, error: mailboxError } =
    await supabase
        .from("mailbox_connections")
        .select("*")
        .eq("company_id", req.companyId)
        .eq("provider", "imap")
        .eq("email", message.mailbox_email)
        .eq("is_active", true)
        .limit(2);

if (mailboxError) {
    throw mailboxError;
}

if (!mailboxes || mailboxes.length !== 1) {
    return res.status(404).json({
        success: false,
        message: "Das zugehörige IMAP-Postfach wurde nicht gefunden."
    });
}

const mailbox = mailboxes[0];

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
            "INBOX",
        message.imap_uidvalidity
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
    company_id:
        req.companyId,

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
)
.eq(
    "company_id",
    req.companyId
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

function createEmptyMailboxImportProgress() {
    return {
        running: false,
        provider: null,
        total: 0,
        processed: 0,
        saved: 0,
        failed: 0,
        finished: false,
        error: null
    };
}

const mailboxImportProgressByMailbox = new Map();

function getMailboxImportProgressKey(companyId, mailboxId) {
    if (!companyId || !mailboxId) {
        throw new Error(
            "Firmen-ID oder Postfach-ID beim Importfortschritt fehlt."
        );
    }

    return `${companyId}:${mailboxId}`;
}

const activeManualMailboxImports =
    new Set();

async function startMailboxLiveSync(companyId) {

    if (!companyId) {
        throw new Error(
            "companyId fehlt beim IMAP-Live-Sync."
        );
    }

    if (mailboxLiveSyncRunning) {
        console.log("📡 MAIL LIVE SYNC läuft bereits.");
        return;
    }


    let mailbox = null;

    try {

mailbox =
    await getActiveMailboxConnection(companyId);


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
        companyId,
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

                    startMailboxLiveSync(companyId)
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

            startMailboxLiveSync(companyId)
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

app.listen(PORT, () => {

    console.log(
        `WorkPilot läuft auf Port ${PORT}`
    );

    console.log(
        "📡 IMAP-Live-Sync beim Serverstart vorübergehend deaktiviert."
    );

});
