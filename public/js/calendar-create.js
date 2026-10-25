const calendarEventForm = document.getElementById("calendarEventForm");

let selectedCalendarColor = "orange";

document.querySelectorAll(".calendarColorOption").forEach((button) => {
button.addEventListener("click", () => {
selectedCalendarColor = button.dataset.color;

document.querySelectorAll(".calendarColorOption").forEach((entry) => {
entry.classList.remove("active");
});

button.classList.add("active");
});
});

function getDefaultReminderAt(eventDate, eventTime) {
if (!eventDate) return null;

const reminderDate = new Date(`${eventDate}T${eventTime || "00:00"}`);
reminderDate.setDate(reminderDate.getDate() - 1);

return reminderDate.toISOString();
}

async function createCalendarEvent(event) {
event.preventDefault();

const title = document.getElementById("title").value.trim();
const eventDate = document.getElementById("eventDate").value;
const eventTime = document.getElementById("eventTime").value;
const description = document.getElementById("description").value.trim();

if (!title || !eventDate) {
showToast("Bitte Titel und Datum ausfüllen.");
return;
}

try {
const response = await fetch("/api/calendar-events", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
title,
eventDate,
eventTime,
description,
contactId: document.getElementById("contactId").value || null,
reminderAt: getDefaultReminderAt(eventDate, eventTime),
color: selectedCalendarColor,
source: "manual"
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Termin konnte nicht gespeichert werden.");
}

showToast("Termin wurde gespeichert.");

localStorage.setItem("workpilot_calendar_month", `${eventDate.slice(0, 7)}-01`);
window.location.href = window.getCalendarReturnUrl();

} catch (error) {
showToast(error.message);
}
}

calendarEventForm.addEventListener("submit", createCalendarEvent);

document.addEventListener("DOMContentLoaded", () => {
const params = new URLSearchParams(window.location.search);

const date = params.get("date");
const title = params.get("title");
const time = params.get("time");
const description = params.get("description");

if (date) {
document.getElementById("eventDate").value = date;
localStorage.setItem("workpilot_calendar_month", `${date.slice(0, 7)}-01`);
}

if (title) {
document.getElementById("title").value = title;
}

if (time) {
document.getElementById("eventTime").value = time;
}

if (description) {
document.getElementById("description").value = description;
}

const cancelLink = document.querySelector(".buttonRow .btnSecondary");

if (cancelLink) {
    const source = params.get("source");

    if (source === "invoice") {
        cancelLink.href = "/invoices";
    } else {
        cancelLink.href = window.getCalendarReturnUrl();
    }
}
});

// Kontakte ausschließlich aus dem eingeloggten Unternehmen laden.
document.addEventListener("DOMContentLoaded", async () => {
    const select = document.getElementById("contactId");
    if (!select) return;
    try {
        const response = await fetch("/api/contacts");
        const result = await response.json();
        if (!response.ok || !result.ok) return;
        const rows = result.contacts || [];
        for (const contact of rows) {
            const option = document.createElement("option");
            option.value = contact.id;
            option.textContent = contact.company_name || contact.company || contact.name ||
                [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Kontakt";
            select.appendChild(option);
        }
        const params = new URLSearchParams(location.search);
        if (params.get("contactId") && !select.value) select.value = params.get("contactId");
        if (typeof eventId !== "undefined" && eventId) {
            const response = await fetch(`/api/calendar-events/${encodeURIComponent(eventId)}`);
            const result = await response.json();
            if (result.ok && result.event?.related_type === "contact") select.value = result.event.related_id || "";
        }
    } catch (error) { console.warn("Kontakte konnten nicht geladen werden", error); }
});
