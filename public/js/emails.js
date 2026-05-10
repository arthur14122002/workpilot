const emailThreadsList = document.getElementById("emailThreadsList");
const emptyEmails = document.getElementById("emptyEmails");

let activeFilter = "all";

function renderEmailThreads() {
emailThreadsList.innerHTML = "";

const demoThreads = [];

const visibleThreads =
activeFilter === "all"
? demoThreads
: demoThreads.filter((thread) => thread.related_type === activeFilter);

if (!visibleThreads.length) {
emptyEmails.style.display = "block";
return;
}

emptyEmails.style.display = "none";
}

function bindFilters() {
document.querySelectorAll(".emailFilter").forEach((button) => {
button.addEventListener("click", () => {
activeFilter = button.dataset.filter;

document.querySelectorAll(".emailFilter").forEach((entry) => {
entry.classList.remove("active");
});

button.classList.add("active");

renderEmailThreads();
});
});
}

document.addEventListener("DOMContentLoaded", () => {
bindFilters();
renderEmailThreads();
});