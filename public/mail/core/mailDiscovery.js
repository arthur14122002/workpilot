const dns = require("dns").promises;

const {
    getProviderByDomain,
    getProviderByMx
} = require("./mailProviderRegistry");


async function discoverMailProvider(email) {

    if (!email) {
        throw new Error(
            "Es wurde keine E-Mail-Adresse übergeben."
        );
    }


    const normalizedEmail = String(email)
        .trim()
        .toLowerCase();


    const parts = normalizedEmail.split("@");


    if (
        parts.length !== 2 ||
        !parts[0] ||
        !parts[1]
    ) {
        throw new Error(
            "Die E-Mail-Adresse ist ungültig."
        );
    }


    const domain = parts[1];

    const directProvider =
        getProviderByDomain(domain);


    if (directProvider) {

        return {
            source: "registry",
            domain,
            ...directProvider
        };

    }

    try {

        const mxRecords =
            await dns.resolveMx(domain);


        const sortedMxRecords =
            mxRecords.sort(
                (a, b) =>
                    a.priority - b.priority
            );


        const mxHosts =
            sortedMxRecords.map(
                record =>
                    String(record.exchange || "")
                        .toLowerCase()
                        .replace(/\.$/, "")
            );


        const mxProvider =
            getProviderByMx(mxHosts);


        if (mxProvider) {

            return {
                source: "mx",
                domain,
                mxHosts,
                ...mxProvider
            };

        }

        return {
            source: "mx-unknown",
            domain,
            mxHosts,

            provider: "custom",
            providerName: "Eigener Mailanbieter",

            authType: "password",

            imap: null,
            smtp: null
        };


    } catch (error) {

        return {
            source: "unknown",
            domain,
            mxHosts: [],

            provider: "custom",
            providerName: "Eigener Mailanbieter",

            authType: "password",

            imap: null,
            smtp: null
        };

    }

}


module.exports = {
    discoverMailProvider
};