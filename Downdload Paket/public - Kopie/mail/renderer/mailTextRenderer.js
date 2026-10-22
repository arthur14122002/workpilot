function renderTextMail(parsedMail) {

    return `<pre class="mailPlainText">${escapeHtml(
        parsedMail.body || ""
    )}</pre>`;

}