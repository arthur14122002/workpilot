const calendarEventForm = document.getElementById("calendarEventForm");

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
reminderAt: getDefaultReminderAt(eventDate, eventTime),
color: "orange",
source: "manual"
})
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Termin konnte nicht gespeichert werden.");
}

showToast("Termin wurde gespeichert.");

window.location.href = "/";

} catch (error) {
showToast(error.message);
}
}

calendarEventForm.addEventListener("submit", createCalendarEvent);
