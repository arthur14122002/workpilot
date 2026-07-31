function renderHtmlMail(parsedMail) {

    let html = parsedMail.body_html || "";

    html = sanitizeMailHtml(html);

    html = renderMailCodeBlocks(html);

    html = resolveMailImages(
        html,
        parsedMail.attachments || []
    );

    return html;

}
