class MailEngine {

    constructor() {

        this.analyzer = null;
        this.optimizer = null;

    }

    setAnalyzer(analyzer) {

        this.analyzer = analyzer;

    }

    setOptimizer(optimizer) {

        this.optimizer = optimizer;

    }

    async process(html = "") {

        const dom = new MailDom(html);

        let report = {};

        if (this.analyzer) {

            report =
                await this.analyzer.analyze(dom);

        }

        if (this.optimizer) {

            await this.optimizer.optimize(
                dom,
                report
            );

        }

        return {

            dom,

            report,

            html:
                dom.serialize()

        };

    }

}

const MailEngineInstance =
    new MailEngine();

window.MailEngine =
    MailEngineInstance;

window.addEventListener(
    "load",
    () => {

        if(window.MailAnalyzer){

            MailEngine.setAnalyzer(
                window.MailAnalyzer
            );

        }

        if(window.MailOptimizer){

            MailEngine.setOptimizer(
                window.MailOptimizer
            );

        }

        console.log(
            "✅ Mail Engine gestartet."
        );

    }
);
