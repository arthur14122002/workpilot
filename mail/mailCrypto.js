const crypto = require("crypto");

function getEncryptionKey() {
    const key = String(process.env.MAIL_CREDENTIALS_KEY || "");

    if (!/^[a-fA-F0-9]{64}$/.test(key)) {
        throw new Error(
            "MAIL_CREDENTIALS_KEY fehlt oder ist ungültig. Erwartet werden 64 Hex-Zeichen."
        );
    }

    return Buffer.from(key, "hex");
}

function encryptMailPassword(password) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        getEncryptionKey(),
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(String(password), "utf8"),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return [
        iv.toString("base64"),
        authTag.toString("base64"),
        encrypted.toString("base64")
    ].join(".");
}

function decryptMailPassword(value) {
    const parts = String(value || "").split(".");

    if (parts.length !== 3) {
        throw new Error("Das gespeicherte Mail-Passwort ist ungültig.");
    }

    const [ivBase64, authTagBase64, encryptedBase64] = parts;

    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        getEncryptionKey(),
        Buffer.from(ivBase64, "base64")
    );

    decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedBase64, "base64")),
        decipher.final()
    ]);

    return decrypted.toString("utf8");
}

module.exports = {
    encryptMailPassword,
    decryptMailPassword
};