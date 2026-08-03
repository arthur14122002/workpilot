function analyzeCss(html){

    return{

        styleTags:

            (html.match(/<style/gi)||[]).length,

        inlineStyles:

            (html.match(/style=/gi)||[]).length,

        mediaQueries:

            (html.match(/@media/gi)||[]).length,

        importantRules:

            (html.match(/!important/gi)||[]).length,

        cssVariables:

            (html.match(/--/g)||[]).length

    };

}

window.analyzeCss = analyzeCss;