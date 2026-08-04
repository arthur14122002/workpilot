function optimizeHtml(html){

    if(!html){
        return "";
    }

    html = html.replace(/\r\n/g,"\n");

    html = html.replace(/\n{3,}/g,"\n\n");

    html = html.replace(/<br>\s*<br>\s*<br>/gi,"<br><br>");

    html = html.replace(/<span>\s*<\/span>/gi,"");

    html = html.replace(/<div>\s*<\/div>/gi,"");

    return html;

}

window.optimizeHtml = optimizeHtml;