class MailOptimizer {

    constructor() {

        this.plugins = [];

    }

    register(plugin) {

        if (typeof plugin === "function") {
            this.plugins.push(plugin);
        }

    }

    async optimize(dom, report) {

        for (const plugin of this.plugins) {

            try {

                await plugin(dom, report);

            } catch (error) {

                console.error(
                    "Optimizer Plugin Fehler:",
                    error
                );

            }

        }

        return dom;

    }

}

const optimizer = new MailOptimizer();

optimizer.register(async (dom) => {

    dom.queryAll("span").forEach(span => {

        if (
            !span.textContent.trim() &&
            span.children.length === 0
        ) {
            span.remove();
        }

    });

});

optimizer.register(async (dom) => {

    dom.queryAll("div").forEach(div => {

        if (
            !div.textContent.trim() &&
            div.children.length === 0
        ) {
            div.remove();
        }

    });

});

optimizer.register(async (dom) => {

    dom.queryAll("p").forEach(p => {

        if (
            !p.textContent.trim() &&
            p.children.length === 0
        ) {
            p.remove();
        }

    });

});

optimizer.register(async (dom) => {

    dom.queryAll("br").forEach(br => {

        const next =
            br.nextElementSibling;

        if (
            next &&
            next.tagName === "BR"
        ) {

            next.remove();

        }

    });

});

optimizer.register(async (dom) => {

    dom.queryAll("style").forEach(style => {

        if (
            !style.innerHTML.trim()
        ) {

            style.remove();

        }

    });

});

optimizer.register(async (dom) => {

    dom.queryAll("script").forEach(script => {

        script.remove();

    });

});

optimizer.register(async (dom) => {

    dom.queryAll("a").forEach(link => {

        if (
            !link.textContent.trim() &&
            !link.querySelector("img")
        ) {

            link.remove();

        }

    });

});

optimizer.register(async (dom) => {

    dom.queryAll("meta").forEach(meta => {

        if (
            meta.httpEquiv === "refresh"
        ) {

            meta.remove();

        }

    });

});



window.MailOptimizer =
    optimizer;