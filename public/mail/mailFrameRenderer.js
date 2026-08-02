async function renderMailFrame(container, html) {

    container.innerHTML = "";

    const iframe = document.createElement("iframe");

    iframe.className = "mailHtmlFrame";

    iframe.setAttribute(
        "sandbox",
        "allow-same-origin allow-popups"
    );

    iframe.style.width = "100%";
    iframe.style.border = "none";
    iframe.style.display = "block";
    iframe.style.background = "#fff";

    container.appendChild(iframe);

    iframe.srcdoc = html;

    iframe.onload = () => {

        try {

            const documentHeight =
                iframe.contentDocument.documentElement.scrollHeight;

            iframe.style.height =
                documentHeight + "px";

            iframe.contentDocument
                .querySelectorAll("a")
                .forEach(link => {

                    link.target = "_blank";
                    link.rel =
                        "noopener noreferrer";

                });

        } catch (error) {

            console.error(error);

        }

    };

}