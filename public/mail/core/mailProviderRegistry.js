const providerRegistry = new Map([
[
"gmx.de",
{
provider: "gmx",
providerName: "GMX",

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
"ionos.de",
{
provider: "ionos",
providerName: "IONOS",

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
],

[
"strato.de",
{
provider: "strato",
providerName: "STRATO",

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
],

[
"t-online.de",
{
provider: "telekom",
providerName: "Telekom",

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
]
]);

function getProviderByDomain(domain) {
return providerRegistry.get(
String(domain || "").toLowerCase()
) || null;
}

module.exports = {
providerRegistry,
getProviderByDomain
};
