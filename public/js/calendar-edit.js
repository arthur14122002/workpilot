const calendarEventForm = document.getElementById("calendarEventForm");
const deleteCalendarEventBtn = document.getElementById("deleteCalendarEventBtn");

const params = new URLSearchParams(window.location.search);
const eventId = params.get("id");

let selectedCalendarColor = "orange";

function setActiveCalendarColor(color) {
selectedCalendarColor = color || "orange";

document.querySelectorAll(".calendarColorOption").forEach((button) => {
button.classList.toggle(
"active",
button.dataset.color === selectedCalendarColor
);
});
}

document.querySelectorAll(".calendarColorOption").forEach((button) => {
button.addEventListener("click", () => {
setActiveCalendarColor(button.dataset.color);
});
});

function getDefaultReminderAt(eventDate, eventTime) {
if (!eventDate) return null;

const reminderDate = new Date(`${eventDate}T${eventTime || "00:00"}`);
reminderDate.setDate(reminderDate.getDate() - 1);

return reminderDate.toISOString();
}

async function loadCalendarEvent() {
if (!eventId) {
showToast("Termin wurde nicht gefunden.");
window.location.href = window.getCalendarReturnUrl();
return;
}

try {
const response = await fetch(`/api/calendar-events/${eventId}`);
const result = await response.json();

if (!result.ok || !result.event) {
throw new Error(result.error || "Termin konnte nicht geladen werden.");
}

const event = result.event;

document.getElementById("title").value = event.title || "";
document.getElementById("eventDate").value = event.event_date || "";
document.getElementById("eventTime").value = event.event_time
? event.event_time.slice(0, 5)
: "";
document.getElementById("description").value = event.description || "";

localStorage.setItem(
"workpilot_calendar_month",
`${event.event_date.slice(0, 7)}-01`
);

const cancelLink = document.querySelector(".buttonRow .btnSecondary");

if (cancelLink) {
cancelLink.href = window.getCalendarReturnUrl();
}

setActiveCalendarColor(event.color || "orange");

} catch (error) {
showToast(error.message);
window.location.href = window.getCalendarReturnUrl();
}
}

async function updateCalendarEvent(event) {
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
const response = await fetch(`/api/calendar-events/${eventId}`, {
method: "PUT",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
title,
eventDate,
eventTime,
description,
reminderAt: getDefaultReminderAt(eventDate, eventTime),
color: selectedCalendarColor,
status: "open"
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Termin konnte nicht aktualisiert werden.");
}

showToast("Termin wurde aktualisiert.");
localStorage.setItem("workpilot_calendar_month", `${eventDate.slice(0, 7)}-01`);
window.location.href = window.getCalendarReturnUrl();

} catch (error) {
showToast(error.message);
}
}

async function deleteCalendarEvent() {

try {
const response = await fetch(`/api/calendar-events/${eventId}`, {
method: "DELETE"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Termin konnte nicht gelöscht werden.");
}

showToast("Termin wurde gelöscht.");
const eventDate = document.getElementById("eventDate").value;

if (eventDate) {
localStorage.setItem("workpilot_calendar_month", `${eventDate.slice(0, 7)}-01`);
}

window.location.href = window.getCalendarReturnUrl();

} catch (error) {
showToast(error.message);
}
}

calendarEventForm.addEventListener("submit", updateCalendarEvent);
deleteCalendarEventBtn.addEventListener("click", deleteCalendarEvent);

document.addEventListener("DOMContentLoaded", loadCalendarEvent);
