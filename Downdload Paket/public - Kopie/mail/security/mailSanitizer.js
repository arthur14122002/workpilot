function sanitizeMailHtml(html) {
    if (
        !window.DOMPurify ||
        typeof window.DOMPurify.sanitize !== "function"
    ) {
        console.error("DOMPurify wurde nicht geladen.");
        return "";
    }

    const cleaned = window.DOMPurify.sanitize(
        String(html || ""),
        {
            USE_PROFILES: {
                html: true
            },

            FORBID_TAGS: [
                "script",
                "iframe",
                "frame",
                "frameset",
                "object",
                "embed",
                "form",
                "input",
                "button",
                "textarea",
                "select",
                "base",
                "meta",
                "link",
                "video",
                "audio",
                "source",
                "track",
                "canvas",
                "template"
            ],

            FORBID_ATTR: [
                "srcdoc",
                "formaction",
                "ping",
                "srcset"
            ],

            ALLOW_DATA_ATTR: false
        }
    );

    const doc = new DOMParser().parseFromString(
        cleaned,
        "text/html"
    );

    doc.querySelectorAll("a[href]").forEach(link => {
        const href = link.getAttribute("href") || "";

        if (!/^https?:\/\//i.test(href)) {
            link.removeAttribute("href");
        } else {
            link.setAttribute("target", "_blank");
            link.setAttribute("rel", "noopener noreferrer");
        }
    });

    doc.querySelectorAll("img").forEach(img => {
        const src = img.getAttribute("src") || "";

        if (
            !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src)
        ) {
            img.removeAttribute("src");
        }

        img.removeAttribute("srcset");
    });

    return doc.body.innerHTML;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.sanitizeMailHtml = sanitizeMailHtml;
window.escapeHtml = escapeHtml;