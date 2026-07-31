function renderTextMail(parsedMail) {

    return `
<pre class="mailPlainText">
${escapeHtml(parsedMail.text || "")}
</pre>
`;

}