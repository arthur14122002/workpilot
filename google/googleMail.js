const { google } = require("googleapis");

function createGoogleOAuthClient() {

    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

}


function createGoogleAuthUrl() {

    const oauth2Client =
        createGoogleOAuthClient();

    return oauth2Client.generateAuthUrl({
        access_type: "offline",

        prompt: "consent",

        scope: [
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/gmail.modify",
            "https://www.googleapis.com/auth/userinfo.email"
        ]
    });

}


async function exchangeGoogleCode(code) {

    const oauth2Client =
        createGoogleOAuthClient();

    const {
        tokens
    } = await oauth2Client.getToken(
        code
    );

    oauth2Client.setCredentials(
        tokens
    );

    const oauth2 =
        google.oauth2({
            version: "v2",
            auth: oauth2Client
        });

    const {
        data: profile
    } = await oauth2.userinfo.get();


    return {
        email:
            profile.email,

        tokens
    };

}


module.exports = {
    createGoogleOAuthClient,
    createGoogleAuthUrl,
    exchangeGoogleCode
};