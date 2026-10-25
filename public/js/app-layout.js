function setActiveNav() {
const path = window.location.pathname;
const links = document.querySelectorAll(".navLink");

links.forEach((link) => {
const href = link.getAttribute("href");

if (href === path) {
link.classList.add("active");
}
});
}

async function updateEmailCounter() {
const emailCounter = document.getElementById("emailCounter");

if (!emailCounter) return;

try {
const response = await fetch("/api/email-inbox");
const result = await response.json();

if (!response.ok || !result.ok) {
if (response.status === 401 || response.status === 403) {
emailCounter.style.display = "none";
return;
}
throw new Error(result.error || "E-Mail-Zähler konnte nicht geladen werden.");
}

const unreadCount = (result.messages || []).filter((message) => {
return (
message.direction === "inbound" &&
!message.read_at &&
!message.deleted_at
);
}).length;

if (unreadCount > 0) {
emailCounter.style.display = "flex";
emailCounter.textContent = unreadCount;
} else {
emailCounter.style.display = "none";
emailCounter.textContent = "0";
}

} catch (error) {
console.error(error);
}
}

window.updateEmailCounter = updateEmailCounter;

function getCalendarReturnUrl(fallback = "/") {
const savedMonth = localStorage.getItem("workpilot_calendar_month");

if (savedMonth) {
return `/?month=${savedMonth}`;
}

return fallback;
}

window.getCalendarReturnUrl = getCalendarReturnUrl;

function ensureToastContainer() {
let container = document.querySelector(".toastContainer");

if (!container) {
container = document.createElement("div");
container.className = "toastContainer";
document.body.appendChild(container);
}

return container;
}

window.showToast = function (message) {
const container = ensureToastContainer();

const toast = document.createElement("div");
toast.className = "toastMessage";
toast.textContent = message;

container.appendChild(toast);

requestAnimationFrame(() => {
toast.classList.add("show");
});

setTimeout(() => {
toast.classList.remove("show");

setTimeout(() => {
toast.remove();
}, 250);
}, 2400);
};

document.addEventListener("DOMContentLoaded", () => {
setActiveNav();
ensureToastContainer();
updateEmailCounter();

const pendingToast = sessionStorage.getItem("workpilot_toast");

if (pendingToast) {
showToast(pendingToast);
sessionStorage.removeItem("workpilot_toast");
}
});

// Frühe Firmenprüfung für Navigation zu geschützten Arbeitsbereichen.
// Die serverseitige requireCompany-Prüfung bleibt die verbindliche Zugriffskontrolle.
(() => {
    const protectedPaths = new Set([
        "/offer-create", "/offer-editor", "/invoice-create", "/invoice-editor",
        "/note-create", "/calendar-create", "/calendar-edit", "/emails",
        "/offers", "/invoices", "/contacts", "/contact-create", "/contact-detail"
    ]);
    let pending = false;

    document.addEventListener("click", async (event) => {
        const link = event.target.closest?.("a[href]");
        if (!link || event.defaultPrevented || event.button !== 0 ||
            event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
            (link.target && link.target !== "_self") || link.hasAttribute("download")) return;

        const destination = new URL(link.href, location.href);
        if (destination.origin !== location.origin || !protectedPaths.has(destination.pathname)) return;
        event.preventDefault();
        if (pending) return;
        pending = true;
        try {
            const response = await fetch("/api/auth/company-status", { credentials: "same-origin" });
            if (response.status === 401) {
                window.showToast?.("Bitte melde dich zuerst an.");
                location.assign("/login");
                return;
            }
            if (!response.ok) throw new Error("Firmenzugang konnte nicht überprüft werden.");
            const status = await response.json();
            if (!status.emailConfirmed) {
                window.showToast?.("Bitte bestätige zuerst deine E-Mail-Adresse.");
            } else if (!status.hasCompany) {
                window.showToast?.("Bitte richte zuerst dein Firmenkonto ein.");
            } else {
                location.assign(destination.href);
            }
        } catch (error) {
            window.showToast?.(error.message || "Firmenzugang konnte nicht überprüft werden.");
        } finally {
            pending = false;
        }
    }, true);
})();

// Sidebar-Status ausschließlich anhand der serverseitig geprüften Sitzung setzen.
document.addEventListener("DOMContentLoaded", async () => {
    const loginLinks = [...document.querySelectorAll(".sidebarBottom a[href='/login']")];
    if (!loginLinks.length) return;
    try {
        const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json();
        if (!result?.ok || !result?.user?.id) return;
        for (const link of loginLinks) {
            link.textContent = "Abmelden";
            link.href = "/login";
            link.addEventListener("click", async event => {
                event.preventDefault();
                if (link.dataset.pendingLogout) return;
                link.dataset.pendingLogout = "1";
                try {
                    const logout = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
                    if (!logout.ok) throw new Error("Abmeldung fehlgeschlagen.");
                    localStorage.removeItem("workpilot_company_settings");
                    localStorage.removeItem("workpilot_dashboard_profile");
                    location.assign("/login");
                } catch (error) {
                    window.showToast?.(error.message);
                    delete link.dataset.pendingLogout;
                }
            });
        }
    } catch (error) { console.warn("Sidebar-Anmeldestatus nicht verfügbar."); }
});
