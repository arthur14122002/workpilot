async function parseMailBody(parsedMail) {

    if (!parsedMail) {
        return "";
    }

    if (parsedMail.html) {
        return renderHtmlMail(parsedMail);
    }

    return renderTextMail(parsedMail);

}

window.parseMailBody = parseMailBody;