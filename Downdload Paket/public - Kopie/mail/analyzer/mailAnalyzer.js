class MailAnalyzer {

    constructor() {

        this.plugins = [];

    }

    register(plugin) {

        if (typeof plugin === "function") {

            this.plugins.push(plugin);

        }

    }

    async analyze(dom) {

        const report = {

            html: {},

            layout: {},

            css: {},

            tables: {},

            images: {},

            fonts: {},

            links: {},

            buttons: {},

            forms: {},

            outlook: {},

            responsive: {},

            tracking: {},

            cid: {},

            security: {},

            metadata: {}

        };

        for (const plugin of this.plugins) {

            try {

                const result =
                    await plugin(dom, report);

                if (
                    result &&
                    typeof result === "object"
                ) {

                    Object.assign(
                        report,
                        result
                    );

                }

            } catch (error) {

                console.error(
                    "Analyzer Plugin Fehler:",
                    error
                );

            }

        }

        return report;

    }

}

const analyzer =
    new MailAnalyzer();

analyzer.register(async (dom, report) => {

    const document =
        dom.getDocument();

    report.html = {

        title:
            document.title ||

            "",

        language:
            document.documentElement.lang ||

            "",

        bodyExists:
            !!document.body,

        headExists:
            !!document.head

    };

});

analyzer.register(async (dom, report) => {

    report.layout = {

        tables:
            dom.queryAll("table").length,

        divs:
            dom.queryAll("div").length,

        sections:
            dom.queryAll("section").length,

        articles:
            dom.queryAll("article").length,

        containers:
            dom.queryAll("[class*=container]").length,

        rows:
            dom.queryAll("tr").length,

        cells:
            dom.queryAll("td").length

    };

});

analyzer.register(async (dom, report) => {

    report.css = {

        styleTags:
            dom.queryAll("style").length,

        inlineStyles:
            dom.queryAll("[style]").length,

        mediaQueries:

            dom
                .getHead()
                ?.innerHTML
                ?.match(/@media/gi)

                ?.length || 0

    };

});

analyzer.register(async (dom, report) => {

    const images =
        dom.queryAll("img");

    report.images = {

        total:
            images.length,

        external:
            images.filter(img =>
                img.src.startsWith("http")
            ).length,

        cid:
            images.filter(img =>
                img.src.startsWith("cid:")
            ).length,

        base64:
            images.filter(img =>
                img.src.startsWith("data:")
            ).length

    };

});

analyzer.register(async (dom, report) => {

    const links =
        dom.queryAll("a");

    report.links = {

        total:
            links.length,

        external:

            links.filter(link =>
                link.href.startsWith("http")
            ).length

    };

});

analyzer.register(async (dom, report) => {

    report.buttons = {

        buttons:
            dom.queryAll("button").length,

        buttonLinks:

            dom.queryAll(
                "a[class*=button]"
            ).length

    };

});

analyzer.register(async (dom, report) => {

    report.forms = {

        forms:
            dom.queryAll("form").length,

        inputs:
            dom.queryAll("input").length,

        selects:
            dom.queryAll("select").length,

        textareas:
            dom.queryAll("textarea").length

    };

});

analyzer.register(async (dom, report) => {

    const html =
        dom.serialize();

    report.outlook = {

        conditionalComments:

            (html.match(/if mso/gi) || [])

                .length,

        officeXml:

            (html.match(/OfficeDocumentSettings/gi) || [])

                .length,

        vml:

            (html.match(/urn:schemas-microsoft-com:vml/gi) || [])

                .length

    };

});

analyzer.register(async (dom, report) => {

    const pixels =
        dom.queryAll("img")
            .filter(img => {

                return (

                    img.width == 1 ||

                    img.height == 1

                );

            });

    report.tracking = {

        pixels:
            pixels.length

    };

});



window.MailAnalyzer =
    analyzer;