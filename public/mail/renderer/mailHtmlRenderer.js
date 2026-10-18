function renderHtmlMail(parsedMail) {

    console.log(
        "Analysebericht:",
        parsedMail.analysis
    );

    let html = sanitizeMailHtml(
        parsedMail.body_html || ""
    );

    if (!parsedMail.analysis) {
        html = renderMailCodeBlocks(html);

        html = resolveMailImages(
            html,
            parsedMail.attachments || []
        );
    }

    return sanitizeMailHtml(html);

}

window.renderHtmlMail =
    renderHtmlMail;