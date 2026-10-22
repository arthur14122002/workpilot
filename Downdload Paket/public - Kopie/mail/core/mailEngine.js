class WorkPilotMailEngine {

    constructor() {

        this.analyzer = null;
        this.optimizer = null;

        this.initialized = false;

    }

    setAnalyzer(analyzer) {

        if (
            !analyzer ||
            typeof analyzer.analyze !== "function"
        ) {

            console.warn(
                "MailEngine: Ungültiger Analyzer wurde ignoriert."
            );

            return;

        }

        this.analyzer = analyzer;

    }

    setOptimizer(optimizer) {

        if (
            !optimizer ||
            typeof optimizer.optimize !== "function"
        ) {

            console.warn(
                "MailEngine: Ungültiger Optimizer wurde ignoriert."
            );

            return;

        }

        this.optimizer = optimizer;

    }

    initialize() {

        if (this.initialized) {
            return;
        }


        if (window.MailAnalyzer) {

            this.setAnalyzer(
                window.MailAnalyzer
            );

        } else {

            console.warn(
                "MailEngine: MailAnalyzer wurde nicht gefunden."
            );

        }


        if (window.MailOptimizer) {

            this.setOptimizer(
                window.MailOptimizer
            );

        } else {

            console.warn(
                "MailEngine: MailOptimizer wurde nicht gefunden."
            );

        }


        this.initialized = true;


        console.log(
            "✅ WorkPilot Mail Engine gestartet."
        );

    }

    async process(html = "") {

        if (!this.initialized) {

            this.initialize();

        }

        if (
            typeof html !== "string" ||
            !html.trim()
        ) {

            return {

                html: "",

                report: {},

                dom: null

            };

        }

        if (
            typeof window.MailDom !== "function"
        ) {

            throw new Error(
                "MailEngine: MailDom wurde nicht geladen."
            );

        }

        const dom =
            new window.MailDom(html);

        let report = {};

        if (this.analyzer) {

            try {

                report =
                    await this.analyzer.analyze(
                        dom
                    ) || {};

            } catch (error) {

                console.error(
                    "MailEngine Analyzer Fehler:",
                    error
                );

                report = {

                    analyzerError:
                        error.message

                };

            }

        }

        if (this.optimizer) {

            try {

                await this.optimizer.optimize(
                    dom,
                    report
                );

            } catch (error) {

                console.error(
                    "MailEngine Optimizer Fehler:",
                    error
                );

                report.optimizerError =
                    error.message;

            }

        }

        let processedHtml = "";

        try {

            processedHtml =
                dom.serialize();

        } catch (error) {

            console.error(
                "MailEngine Serialisierung fehlgeschlagen:",
                error
            );

            processedHtml = html;

        }

        return {

            html:
                processedHtml,

            report,

            dom

        };

    }

}

const workPilotMailEngine =
    new WorkPilotMailEngine();


window.MailEngine =
    workPilotMailEngine;

workPilotMailEngine.initialize();