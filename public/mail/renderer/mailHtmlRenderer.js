function renderHtmlMail(parsedMail) {

    console.log(
        "Analysebericht:",
        parsedMail.analysis
    );

    let html =
        parsedMail.body_html || "";

    if (
        !parsedMail.analysis
    ) {

        html =
            sanitizeMailHtml(html);

        html =
            renderMailCodeBlocks(html);

        html =
            resolveMailImages(
                html,
                parsedMail.attachments || []
            );

    }

    return html;

}

window.renderHtmlMail =
    renderHtmlMail;