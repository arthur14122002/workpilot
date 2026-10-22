function resolveMailImages(
    html,
    attachments
) {

    if (!html) {
        return html;
    }

    let resolvedHtml =
        String(html);

    resolvedHtml =
        resolvedHtml.replace(
            /\bsrc=(["'])http:\/\/([^"']+)\1/gi,
            'src=$1https://$2$1'
        );

    resolvedHtml =
        resolvedHtml.replace(
            /\bsrcset=(["'])(.*?)\1/gi,
            (match, quote, value) => {

                const upgraded =
                    value.replace(
                        /http:\/\//gi,
                        "https://"
                    );

                return `srcset=${quote}${upgraded}${quote}`;

            }
        );

    resolvedHtml =
        resolvedHtml.replace(
            /url\(\s*(["']?)http:\/\/([^)"']+)\1\s*\)/gi,
            'url($1https://$2$1)'
        );

    resolvedHtml =
        resolvedHtml.replace(
            /\bbackground=(["'])http:\/\/([^"']+)\1/gi,
            'background=$1https://$2$1'
        );


    return resolvedHtml;

}


window.resolveMailImages =
    resolveMailImages;