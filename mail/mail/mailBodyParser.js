const DEBUG = false;

function parseMailBody(message) {

    const html = message.body_html || "";
    const text = message.body || "";

    debug("====================================");
    debug("Mail Body Parser gestartet");

    const decodedHtml = decodeEntities(html);
    const normalizedHtml = normalizeHtml(decodedHtml);

    const bodyType = detectBodyType(normalizedHtml, text);

    debug("Body Type:", bodyType);

    switch (bodyType) {

        case "html":
            return renderHtml(
                providerCleanup(normalizedHtml)
            );

        case "markdown":
            return renderMarkdown(text);

        case "code":
            return renderCodeBlock(
                normalizedHtml || text
            );

        case "text":
        default:
            return renderPlainText(text);

    }

}

function detectBodyType(html, text) {

    if (looksLikeCode(html || text)) {
        return "code";
    }

    if (looksLikeMarkdown(text)) {
        return "markdown";
    }

    if (isHtml(html)) {
        return "html";
    }

    return "text";

}

function isHtml(html) {

    if (!html) {
        return false;
    }

    return /<\/?[a-z][\s\S]*>/i.test(html);

}

function providerCleanup(html) {

    let cleaned = html;

    cleaned = cleanGenericHtml(cleaned);
    cleaned = cleanGmxHtml(cleaned);
    cleaned = cleanGoogleHtml(cleaned);
    cleaned = cleanOutlookHtml(cleaned);

    return cleaned;

}

function renderHtml(html) {

    return html;

}

function renderPlainText(text) {

    return escapeHtml(text)
        .replace(/\n/g, "<br>");

}

function renderMarkdown(text) {

    return renderPlainText(text);

}

function renderCodeBlock(code) {

    let output = code;

    if (containsEscapedHtml(output)) {

        output = decodeEntities(output);

    }

    return `
<pre class="mail-code-block"><code>${escapeHtml(output)}</code></pre>
`;

}

function normalizeHtml(html) {

    if (!html) {
        return "";
    }

    return html
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

}

function decodeEntities(html) {

    if (!html) {
        return "";
    }

    const textarea = document.createElement("textarea");
    textarea.innerHTML = html;

    return textarea.value;

}

function escapeHtml(text) {

    if (!text) {
        return "";
    }

    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}

function debug(...args) {

    if (!DEBUG) {
        return;
    }

    console.log("[MailParser]", ...args);

}

function cleanGenericHtml(html) {

    if (!html) {
        return "";
    }

    return html


        .replace(/<!--[\s\S]*?-->/g, "")


        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")


        .replace(
            /<img[^>]*(width=["']?1["']?)?[^>]*(height=["']?1["']?)?[^>]*>/gi,
            ""
        )


        .replace(/<div>\s*<\/div>/gi, "")


        .replace(/<p>\s*<\/p>/gi, "")


        .replace(/<span[^>]*>\s*<\/span>/gi, "")


        .replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>")


        .replace(/\n{3,}/g, "\n\n")

        .trim();

}

function cleanGmxHtml(html) {

    if (!html) {
        return "";
    }

    return html


        .replace(/class="gmx.*?"/gi, "")


        .replace(/class="webde.*?"/gi, "")


        .replace(/Gesendet mit GMX[\s\S]*/gi, "")


        .replace(/Gesendet mit WEB\.DE[\s\S]*/gi, "")


        .replace(/(<br\s*\/?>\s*){2,}/gi, "<br>");

}

function cleanGoogleHtml(html) {

    if (!html) {
        return "";
    }

    return html


        .replace(
            /<div class="gmail_quote">[\s\S]*?<\/div>/gi,
            ""
        )


        .replace(
            /<div class="gmail_signature">[\s\S]*?<\/div>/gi,
            ""
        )


        .replace(/gmail_attr/gi, "")


        .replace(/(<br\s*\/?>\s*){2,}/gi, "<br>");

}

function cleanOutlookHtml(html) {

    if (!html) {
        return "";
    }

    return html


        .replace(
            /<!--\[if[\s\S]*?<!\[endif\]-->/gi,
            ""
        )


        .replace(/class="?Mso.*?"?/gi, "")


        .replace(/mso-[^:]+:[^;"]+;?/gi, "")


        .replace(/<o:p>[\s\S]*?<\/o:p>/gi, "")


        .replace(/<span>\s*<\/span>/gi, "");

}

function looksLikeCode(text) {

    if (!text) {
        return false;
    }

    let score = 0;

    const patterns = [

        /async\s+function/i,
        /function\s+[a-z0-9_]+\s*\(/i,
        /\bconst\b/,
        /\blet\b/,
        /\bvar\b/,
        /\bclass\b/,
        /\breturn\b/,
        /\bimport\b/,
        /\bexport\b/,
        /=>/,
        /document\./,
        /window\./,
        /querySelector/,
        /getElementById/,
        /innerHTML/,
        /module\.exports/,
        /require\s*\(/,
        /<\/?[a-z]+>/i,
        /\{[\s\S]*\}/,
        /SELECT\s+/i,
        /INSERT\s+/i,
        /UPDATE\s+/i,
        /DELETE\s+/i,
        /CREATE\s+TABLE/i

    ];

    for (const pattern of patterns) {

        if (pattern.test(text)) {
            score++;
        }

    }

    if (containsEscapedHtml(text)) {
        score += 3;
    }

    return score >= 3;

}

function looksLikeMarkdown(text) {

    if (!text) {
        return false;
    }

    let score = 0;

    if (/```/.test(text)) score++;
    if (/^# /m.test(text)) score++;
    if (/^\* /m.test(text)) score++;
    if (/^- /m.test(text)) score++;
    if (/^\d+\./m.test(text)) score++;
    if (/\*\*.+\*\*/.test(text)) score++;
    if (/`.+`/.test(text)) score++;

    return score >= 2;

}

function containsEscapedHtml(text) {

    if (!text) {
        return false;
    }

    return (

        text.includes("&lt;") ||
        text.includes("&gt;") ||
        text.includes("&amp;lt;") ||
        text.includes("&amp;gt;")

    );

}

window.parseMailBody = parseMailBody;