const providerRegistry = new Map([
    [
        "gmx.de",
        {
            provider: "gmx",
            providerName: "GMX",
            authType: "password",

            imap: {
                host: "imap.gmx.net",
                port: 993,
                secure: true
            },

            smtp: {
                host: "mail.gmx.net",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    ],

    [
        "gmx.net",
        {
            provider: "gmx",
            providerName: "GMX",
            authType: "password",

            imap: {
                host: "imap.gmx.net",
                port: 993,
                secure: true
            },

            smtp: {
                host: "mail.gmx.net",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    ],

    [
        "web.de",
        {
            provider: "webde",
            providerName: "WEB.DE",
            authType: "password",

            imap: {
                host: "imap.web.de",
                port: 993,
                secure: true
            },

            smtp: {
                host: "smtp.web.de",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    ],

    [
        "t-online.de",
        {
            provider: "telekom",
            providerName: "Telekom",
            authType: "password",

            imap: {
                host: "secureimap.t-online.de",
                port: 993,
                secure: true
            },

            smtp: {
                host: "securesmtp.t-online.de",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    ],

    [
        "gmail.com",
        {
            provider: "google",
            providerName: "Google",
            authType: "oauth2",

            imap: {
                host: "imap.gmail.com",
                port: 993,
                secure: true
            },

            smtp: {
                host: "smtp.gmail.com",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    ],

    [
        "googlemail.com",
        {
            provider: "google",
            providerName: "Google",
            authType: "oauth2",

            imap: {
                host: "imap.gmail.com",
                port: 993,
                secure: true
            },

            smtp: {
                host: "smtp.gmail.com",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    ],

    [
        "outlook.com",
        {
            provider: "microsoft",
            providerName: "Microsoft",
            authType: "oauth2",

            imap: {
                host: "outlook.office365.com",
                port: 993,
                secure: true
            },

            smtp: {
                host: "smtp.office365.com",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    ],

    [
        "hotmail.com",
        {
            provider: "microsoft",
            providerName: "Microsoft",
            authType: "oauth2",

            imap: {
                host: "outlook.office365.com",
                port: 993,
                secure: true
            },

            smtp: {
                host: "smtp.office365.com",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    ],

    [
        "live.de",
        {
            provider: "microsoft",
            providerName: "Microsoft",
            authType: "oauth2",

            imap: {
                host: "outlook.office365.com",
                port: 993,
                secure: true
            },

            smtp: {
                host: "smtp.office365.com",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    ]
];

const mxProviderRules = [
    {
        matches: [
            "mail.protection.outlook.com",
            "outlook.com"
        ],

        provider: {
            provider: "microsoft",
            providerName: "Microsoft 365",
            authType: "oauth2",

            imap: {
                host: "outlook.office365.com",
                port: 993,
                secure: true
            },

            smtp: {
                host: "smtp.office365.com",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    },

    {
        matches: [
            "google.com",
            "googlemail.com"
        ],

        provider: {
            provider: "google",
            providerName: "Google Workspace",
            authType: "oauth2",

            imap: {
                host: "imap.gmail.com",
                port: 993,
                secure: true
            },

            smtp: {
                host: "smtp.gmail.com",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    },

    {
        matches: [
            "ionos.de",
            "ionos.com",
            "1and1.com",
            "1und1.de"
        ],

        provider: {
            provider: "ionos",
            providerName: "IONOS",
            authType: "password",

            imap: {
                host: "imap.ionos.de",
                port: 993,
                secure: true
            },

            smtp: {
                host: "smtp.ionos.de",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    },

    {
        matches: [
            "strato.de"
        ],

        provider: {
            provider: "strato",
            providerName: "STRATO",
            authType: "password",

            imap: {
                host: "imap.strato.de",
                port: 993,
                secure: true
            },

            smtp: {
                host: "smtp.strato.de",
                port: 587,
                secure: false,
                requireTLS: true
            }
        }
    }
];


function getProviderByDomain(domain) {
    return providerRegistry.get(
        String(domain || "").trim().toLowerCase()
    ) || null;
}


function getProviderByMx(mxHosts = []) {

    const normalizedHosts = mxHosts.map(host =>
        String(host || "").toLowerCase()
    );

    for (const rule of mxProviderRules) {

        const matched = normalizedHosts.some(host =>
            rule.matches.some(match =>
                host.includes(match)
            )
        );

        if (matched) {
            return rule.provider;
        }

    }

    return null;
}


module.exports = {
    providerRegistry,
    mxProviderRules,
    getProviderByDomain,
    getProviderByMx
};