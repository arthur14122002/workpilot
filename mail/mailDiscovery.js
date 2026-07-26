const { getProviderByDomain } = require("./mailProviderRegistry");

async function discoverMailProvider(email) {

    if (!email) {
        throw new Error("Es wurde keine E-Mail-Adresse übergeben.");
    }

    const normalizedEmail = email
        .trim()
        .toLowerCase();

    const parts = normalizedEmail.split("@");

    if (parts.length !== 2) {
        throw new Error("Die E-Mail-Adresse ist ungültig.");
    }

    const domain = parts[1];

    const provider = getProviderByDomain(domain);

    if (provider) {

        return {
            source: "registry",
            domain,
            ...provider
        };

    }

    throw new Error(
        `Für "${domain}" konnte kein Mailanbieter gefunden werden.`
    );

}

module.exports = {
    discoverMailProvider
};