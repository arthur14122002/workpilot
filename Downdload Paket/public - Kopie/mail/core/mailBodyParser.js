async function parseMailBody(parsedMail) {

    if (!parsedMail) {
        return "";
    }

if (parsedMail.body_html) {

    const result =
        await MailEngine.process(
            parsedMail.body_html
        );

    parsedMail.body_html =
        result.html;

    parsedMail.analysis =
        result.report;

    return renderHtmlMail(
        parsedMail
    );

}

return renderTextMail(
    parsedMail
);

}

window.parseMailBody = parseMailBody;
