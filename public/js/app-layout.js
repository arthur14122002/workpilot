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

if (!result.ok) {
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
});
