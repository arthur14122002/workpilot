async function parseMailBody(parsedMail) {

    if (!parsedMail) {
        return "";
    }

    if (parsedMail.body_html) {
        return renderHtmlMail(parsedMail);
    }

    return renderTextMail(parsedMail);

}

window.parseMailBody = parseMailBody;
