const dashboardGreeting = document.getElementById("dashboardGreeting");

const statContacts = document.getElementById("statContacts");
const statOpenOffers = document.getElementById("statOpenOffers");
const statOpenInvoices = document.getElementById("statOpenInvoices");
const statOpenRevenue = document.getElementById("statOpenRevenue");
const statPaidRevenue = document.getElementById("statPaidRevenue");

const notificationsList = document.getElementById("notificationsList");
const emptyNotifications = document.getElementById("emptyNotifications");
const refreshDashboardBtn = document.getElementById("refreshDashboardBtn");
const createCalendarEventBtn = document.getElementById("createCalendarEventBtn");

const calendarMonthTitle = document.getElementById("calendarMonthTitle");
const calendarMonthGrid = document.getElementById("calendarMonthGrid");
const prevMonthBtn = document.getElementById("prevMonthBtn");
const nextMonthBtn = document.getElementById("nextMonthBtn");

let currentCalendarDate = new Date();
let calendarEventsCache = [];

function euro(value) {
const number = Number(value) || 0;

return number.toLocaleString("de-DE", {
style: "currency",
currency: "EUR"
});
}

function parseMoney(value) {
if (!value) return 0;

return Number(
String(value)
.replace("€", "")
.replace(/\./g, "")
.replace(",", ".")
.trim()
) || 0;
}

function getSavedJson(key, fallback) {
try {
return JSON.parse(localStorage.getItem(key)) || fallback;
} catch {
return fallback;
}
}

function getTimeGreeting() {
const hour = new Date().getHours();

if (hour >= 5 && hour < 12) return "Guten Morgen";
if (hour >= 12 && hour < 18) return "Guten Tag";

return "Guten Abend";
}

function renderGreeting() {
const profile = getSavedJson("workpilot_dashboard_profile", {});
const greetingName = profile.greetingName || "";

dashboardGreeting.textContent = greetingName
? `${getTimeGreeting()}, ${greetingName}`
: getTimeGreeting();
}

async function apiGetContacts() {
const response = await fetch("/api/contacts");
const result = await response.json();

if (!result.ok) throw new Error(result.error || "Kontakte konnten nicht geladen werden.");

return result.contacts || [];
}

async function apiGetOffers() {
const response = await fetch("/api/offers");
const result = await response.json();

if (!result.ok) throw new Error(result.error || "Angebote konnten nicht geladen werden.");

return result.offers || [];
}

async function apiGetInvoices() {
const response = await fetch("/api/invoices");
const result = await response.json();

if (!result.ok) throw new Error(result.error || "Rechnungen konnten nicht geladen werden.");

return result.invoices || [];
}

async function apiGetNotifications() {
const response = await fetch("/api/dashboard-notifications");
const result = await response.json();

if (!result.ok) throw new Error(result.error || "Benachrichtigungen konnten nicht geladen werden.");

return result.notifications || [];
}

async function markNotificationAsRead(notificationId) {
await fetch(`/api/dashboard-notifications/${notificationId}/read`, {
method: "PUT"
});
}

async function dismissNotification(notificationId) {
await fetch(`/api/dashboard-notifications/${notificationId}/dismiss`, {
method: "PUT"
});
}

async function renderStats() {
const [contacts, offersRows, invoiceRows] = await Promise.all([
apiGetContacts(),
apiGetOffers(),
apiGetInvoices()
]);

const offers = offersRows.map((row) => ({
...row.data,
id: row.id,
status: row.status
}));

const invoices = invoiceRows.map((row) => ({
...row.data,
id: row.id,
status: row.status
}));

const openOffers = offers.filter((offer) => offer.status === "open" || !offer.status);
const openInvoices = invoices.filter((invoice) => invoice.status === "open" || !invoice.status);
const paidInvoices = invoices.filter((invoice) => invoice.status === "paid");

const openRevenue = openInvoices.reduce((sum, invoice) => {
return sum + calculateInvoiceGross(invoice);
}, 0);

const paidRevenue = paidInvoices.reduce((sum, invoice) => {
return sum + calculateInvoiceGross(invoice);
}, 0);

statContacts.textContent = contacts.length;
statOpenOffers.textContent = openOffers.length;
statOpenInvoices.textContent = openInvoices.length;
statOpenRevenue.textContent = euro(openRevenue);
statPaidRevenue.textContent = euro(paidRevenue);
}

async function apiGetCalendarEvents() {
const response = await fetch("/api/calendar-events");
const result = await response.json();

if (!result.ok) {
throw new Error(
result.error || "Kalendereinträge konnten nicht geladen werden."
);
}

return result.events || [];
}

function formatDateKey(date) {
return date.toISOString().slice(0, 10);
}

function getEventsForDate(events, dateKey) {
return events.filter((event) => {
return event.event_date === dateKey;
});
}

function renderMonthCalendar(events) {
if (!calendarMonthTitle || !calendarMonthGrid) return;

const year = currentCalendarDate.getFullYear();
const month = currentCalendarDate.getMonth();

const monthLabel = currentCalendarDate.toLocaleDateString("de-DE", {
month: "long",
year: "numeric"
});

calendarMonthTitle.textContent =
monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

calendarMonthGrid.innerHTML = "";

const firstDayOfMonth = new Date(year, month, 1);
const lastDayOfMonth = new Date(year, month + 1, 0);

const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
const daysInMonth = lastDayOfMonth.getDate();

const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

for (let index = 0; index < totalCells; index++) {
const dayNumber = index - startOffset + 1;

const day = document.createElement("div");
day.className = "calendarDay";

if (dayNumber < 1 || dayNumber > daysInMonth) {
day.classList.add("isMuted");
day.innerHTML = "";
calendarMonthGrid.appendChild(day);
continue;
}

const date = new Date(year, month, dayNumber);
const dateKey = formatDateKey(date);
const dayEvents = getEventsForDate(events, dateKey);

day.innerHTML = `
<div class="calendarDayNumber">${dayNumber}</div>
`;

dayEvents.slice(0, 1).forEach((event) => {
const eventEl = document.createElement("div");
eventEl.className = "calendarDayEvent";
eventEl.textContent = event.title;
day.appendChild(eventEl);
});

if (dayEvents.length > 1) {
const moreEl = document.createElement("div");
moreEl.className = "calendarMore";
moreEl.textContent = `+${dayEvents.length - 1} weitere`;
day.appendChild(moreEl);
}

day.addEventListener("click", () => {
window.location.href = `/calendar-create?date=${dateKey}`;
});

calendarMonthGrid.appendChild(day);
}
}

async function renderCalendarEvents() {
try {
calendarEventsCache = await apiGetCalendarEvents();
renderMonthCalendar(calendarEventsCache);
} catch (error) {
console.error(error);
}
}

function calculateInvoiceGross(invoice) {
const positions = Array.isArray(invoice.positions) ? invoice.positions : [];

const net = positions.reduce((sum, position) => {
return sum + parseMoney(position.total);
}, 0);

const settings = invoice.companySettings || getSavedJson("workpilot_company_settings", {});
const vatRate = Number(settings.vatRate || 19);

return net + net * (vatRate / 100);
}

async function renderNotifications() {
const notifications = await apiGetNotifications();

notificationsList.innerHTML = "";

if (!notifications.length) {
emptyNotifications.style.display = "block";
return;
}

emptyNotifications.style.display = "none";

notifications.forEach((notification) => {
const item = document.createElement("div");
item.className = `notificationItem ${notification.status === "unread" ? "unread" : ""}`;

item.innerHTML = `
<div class="notificationInfo">
<div class="notificationTitle">${notification.title}</div>
<div class="notificationMessage">${notification.message || ""}</div>
<div class="notificationMeta">
${new Date(notification.triggered_at).toLocaleString("de-DE")}
</div>
</div>

<div class="notificationActions">
<button class="btn btnSecondary" data-open="${notification.id}">
Öffnen
</button>

<button class="btn btnSecondary" data-dismiss="${notification.id}">
Löschen
</button>
</div>
`;

notificationsList.appendChild(item);
});

bindNotificationActions(notifications);
}

function bindNotificationActions(notifications) {
document.querySelectorAll("[data-open]").forEach((button) => {
button.addEventListener("click", async () => {
const notification = notifications.find((entry) => entry.id === button.dataset.open);

if (!notification) return;

await markNotificationAsRead(notification.id);

const threadId =
notification.metadata?.threadId ||
notification.dashboard_events?.metadata?.threadId;

if (threadId) {
window.location.href = `/emails?thread=${threadId}`;
return;
}

await renderDashboard();

await renderDashboard();
});
});

document.querySelectorAll("[data-dismiss]").forEach((button) => {
button.addEventListener("click", async () => {
await dismissNotification(button.dataset.dismiss);
await renderDashboard();
});
});
}

async function renderDashboard() {
try {
renderGreeting();
await renderStats();
await renderNotifications();
await renderCalendarEvents();
} catch (error) {
showToast(error.message);
}
}

refreshDashboardBtn.addEventListener("click", renderDashboard);

if (createCalendarEventBtn) {
createCalendarEventBtn.addEventListener("click", () => {
window.location.href = "/calendar-create";
});
}

if (prevMonthBtn) {
prevMonthBtn.addEventListener("click", async () => {
currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
renderMonthCalendar(calendarEventsCache);
});
}

if (nextMonthBtn) {
nextMonthBtn.addEventListener("click", async () => {
currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
renderMonthCalendar(calendarEventsCache);
});
}

document.addEventListener("DOMContentLoaded", renderDashboard);
