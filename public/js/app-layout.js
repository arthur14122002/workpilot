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
});