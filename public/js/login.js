document.addEventListener("DOMContentLoaded", () => {

    const views = {
        login: document.getElementById("loginView"),
        register: document.getElementById("registerView"),
        forgot: document.getElementById("forgotView")
    };

    const tabs = document.querySelectorAll(".loginTab");
    const messageBox = document.getElementById("authMessage");

    function showMessage(message, type = "error") {
        messageBox.textContent = message;
        messageBox.className = `authMessage ${type}`;
        messageBox.hidden = false;
    }

    function clearMessage() {
        messageBox.textContent = "";
        messageBox.className = "authMessage";
        messageBox.hidden = true;
    }

    function showView(viewName) {
        Object.entries(views).forEach(([name, element]) => {
            element.classList.toggle("active", name === viewName);
        });

        tabs.forEach(tab => {
            tab.classList.toggle(
                "active",
                tab.dataset.view === viewName
            );
        });

        clearMessage();
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            showView(tab.dataset.view);
        });
    });

    document
        .getElementById("forgotPasswordLink")
        .addEventListener("click", () => {
            showView("forgot");
        });

    document
        .getElementById("backToLogin")
        .addEventListener("click", () => {
            showView("login");
        });

    async function sendAuthRequest(url, payload) {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.ok) {
            throw new Error(
                result.error ||
                "Die Anfrage konnte nicht verarbeitet werden."
            );
        }

        return result;
    }

    async function handleSubmit(form, callback) {
        const button = form.querySelector('button[type="submit"]');
        const originalText = button.textContent;

        clearMessage();

        button.disabled = true;
        button.textContent = "Bitte warten...";

        try {
            await callback();
        } catch (error) {
            showMessage(error.message);
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    document
        .getElementById("loginForm")
        .addEventListener("submit", async event => {
            event.preventDefault();

            await handleSubmit(event.currentTarget, async () => {

                const email = document
                    .getElementById("loginEmail")
                    .value.trim();

                const password = document
                    .getElementById("loginPassword")
                    .value;

                await sendAuthRequest("/api/auth/login", {
                    email,
                    password
                });

                window.location.href = "/";
            });
        });

    document
        .getElementById("registerForm")
        .addEventListener("submit", async event => {
            event.preventDefault();

            await handleSubmit(event.currentTarget, async () => {

                const name = document
                    .getElementById("registerName")
                    .value.trim();

                const companyName = document
                    .getElementById("registerCompany")
                    .value.trim();

                const email = document
                    .getElementById("registerEmail")
                    .value.trim();

                const password = document
                    .getElementById("registerPassword")
                    .value;

                const consent = document
                    .getElementById("registerConsent")
                    .checked;

                if (!consent) {
                    throw new Error(
                        "Bitte akzeptiere die Nutzungsbedingungen."
                    );
                }

                if (password.length < 12) {
                    throw new Error(
                        "Das Passwort muss mindestens 12 Zeichen haben."
                    );
                }

                await sendAuthRequest("/api/auth/register", {
                    name,
                    companyName,
                    email,
                    password
                });

                showMessage(
                    "Registrierung gestartet. Bitte prüfe dein E-Mail-Postfach und bestätige deine Adresse.",
                    "success"
                );
            });
        });

    document
        .getElementById("forgotForm")
        .addEventListener("submit", async event => {
            event.preventDefault();

            await handleSubmit(event.currentTarget, async () => {

                const email = document
                    .getElementById("forgotEmail")
                    .value.trim();

                await sendAuthRequest(
                    "/api/auth/forgot-password",
                    { email }
                );

                showMessage(
                    "Falls ein Konto mit dieser Adresse existiert, erhältst du eine E-Mail mit weiteren Anweisungen.",
                    "success"
                );
            });
        });

});
