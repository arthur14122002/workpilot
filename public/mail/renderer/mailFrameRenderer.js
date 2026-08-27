async function renderMailFrame(container, html) {

    if (!container) {
        console.error(
            "renderMailFrame: Kein Container vorhanden."
        );
        return;
    }

    container.innerHTML = "";

    const iframe =
        document.createElement("iframe");

    iframe.className =
        "mailHtmlFrame";

    iframe.setAttribute(
        "sandbox",
        "allow-same-origin allow-popups"
    );

    iframe.setAttribute(
        "scrolling",
        "no"
    );

    iframe.style.width =
        "100%";

    iframe.style.height =
        "1px";

    iframe.style.border =
        "none";

    iframe.style.display =
        "block";

    iframe.style.background =
        "#fff";

    iframe.style.overflow =
        "hidden";


    container.appendChild(
        iframe
    );

    iframe.srcdoc =
        html;


    iframe.onload = () => {

        try {

        const insecureElements = [];

iframe.contentDocument
    .querySelectorAll("*")
    .forEach((element) => {

        for (const attribute of element.attributes) {

            const value =
                String(attribute.value || "");

            if (
                value.includes("http://") &&
                value !== "http://www.w3.org/1999/xhtml"
            ) {

                insecureElements.push({
                    tag:
                        element.tagName,

                    attribute:
                        attribute.name,

                    value
                });

            }

        }

    });

console.log(
    "MAIL INSECURE ELEMENTS:",
    insecureElements
);

const resourceEntries =
    iframe.contentWindow
        ?.performance
        ?.getEntriesByType("resource") || [];

const insecureResources =
    resourceEntries
        .map((entry) => entry.name)
        .filter((url) =>
            String(url).startsWith("http://")
        );

console.log(
    "MAIL INSECURE RESOURCES:",
    insecureResources
);

            const frameDocument =
                iframe.contentDocument;

            if (!frameDocument) {
                return;
            }

            const updateFrameHeight = () => {

                try {

                    const body =
                        frameDocument.body;

                    const htmlElement =
                        frameDocument.documentElement;


                    if (
                        !body ||
                        !htmlElement
                    ) {
                        return;
                    }

                    iframe.style.height =
                        "1px";


                    const height =
                        Math.max(

                            body.scrollHeight,
                            body.offsetHeight,

                            htmlElement.scrollHeight,
                            htmlElement.offsetHeight,

                            htmlElement.clientHeight

                        );


                    iframe.style.height =
                        `${height}px`;


                } catch (error) {

                    console.error(
                        "MAIL FRAME RESIZE ERROR:",
                        error
                    );

                }

            };

            frameDocument
                .querySelectorAll("a")
                .forEach((link) => {

                    link.target =
                        "_blank";

                    link.rel =
                        "noopener noreferrer";

                });

            requestAnimationFrame(
                updateFrameHeight
            );

            frameDocument
                .querySelectorAll("img")
                .forEach((image) => {

                    if (image.complete) {
                        return;
                    }

                    image.addEventListener(
                        "load",
                        updateFrameHeight,
                        {
                            once: true
                        }
                    );

                    image.addEventListener(
                        "error",
                        updateFrameHeight,
                        {
                            once: true
                        }
                    );

                });

            if (
                typeof ResizeObserver !==
                "undefined"
            ) {

                const resizeObserver =
                    new ResizeObserver(() => {

                        requestAnimationFrame(
                            updateFrameHeight
                        );

                    });


                resizeObserver.observe(
                    frameDocument.documentElement
                );


                if (frameDocument.body) {

                    resizeObserver.observe(
                        frameDocument.body
                    );

                }

            }

            setTimeout(
                updateFrameHeight,
                100
            );

            setTimeout(
                updateFrameHeight,
                500
            );


        } catch (error) {

            console.error(
                "MAIL FRAME ERROR:",
                error
            );

        }

    };

}