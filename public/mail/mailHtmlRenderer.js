function renderHtmlMail(parsedMail) {

    let html = parsedMail.body_html || "";

    html = sanitizeMailHtml(html);

    html = renderMailCodeBlocks(html);

    html = resolveMailImages(
        html,
        parsedMail.attachments || []
    );

console.log(html.substring(0, 3000));

    return html;

}
