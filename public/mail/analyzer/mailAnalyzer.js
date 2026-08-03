async function analyzeMailHtml(html) {

    const report = {

        html,

        layout: {},
        css: {},
        tables: {},
        images: {},
        fonts: {},
        buttons: {},
        links: {},
        forms: {},
        mediaQueries: {},
        outlook: {},
        cid: {},
        tracking: {},
        scripts: {}

    };

    report.layout =
        analyzeLayout(html);

    report.css =
        analyzeCss(html);

    report.tables =
        analyzeTables(html);

    report.images =
        analyzeImages(html);

    report.fonts =
        analyzeFonts(html);

    report.buttons =
        analyzeButtons(html);

    report.links =
        analyzeLinks(html);

    report.forms =
        analyzeForms(html);

    report.mediaQueries =
        analyzeMediaQueries(html);

    report.outlook =
        analyzeOutlook(html);

    report.cid =
        analyzeCidImages(html);

    report.tracking =
        analyzeTracking(html);

    report.scripts =
        analyzeScripts(html);

        console.log(report);

    return report;

}

console.log("Mail Analyzer geladen ✅");

window.analyzeMailHtml = analyzeMailHtml;