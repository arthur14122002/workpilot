const CONTACTS_KEY = "workpilot_contacts";
const OFFERS_KEY = "workpilot_saved_offers";
const INVOICES_KEY = "workpilot_saved_invoices";

const contactsList = document.getElementById("contactsList");
const emptyContacts = document.getElementById("emptyContacts");
const letterNav = document.getElementById("letterNav");

let activeLetter = "ALLE";
let contactsCache = [];
let favoritesOnly = false;
let currentContactPage = 1;
const CONTACTS_PER_PAGE = 8;
const isFavorite = contact => contact?.data?.is_favorite === true;
const isCompanyContact = contact => contact?.data?.contact_type === "company" || (contact?.data?.contact_type !== "person" && Boolean(contact.company || contact.company_name));

async function apiGetContacts() {
const response = await fetch("/api/contacts");
const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakte konnten nicht geladen werden.");
}

return result.contacts || [];
}

async function apiCreateContact(contact) {
const response = await fetch("/api/contacts", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(contact)
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakt konnte nicht gespeichert werden.");
}

return result.contact;
}

async function apiDeleteContact(contactId) {
const response = await fetch(`/api/contacts/${contactId}`, {
method: "DELETE"
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Kontakt konnte nicht gelöscht werden.");
}
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

function euro(value) {
return (Number(value) || 0).toLocaleString("de-DE", {
style: "currency",
currency: "EUR"
});
}

function calculateInvoiceGross(invoice) {
const net = (invoice.positions || []).reduce((sum, position) => {
return sum + parseMoney(position.total);
}, 0);

const vatRate = 19;
const vat = net * (vatRate / 100);

return net + vat;
}

function generateId(prefix = "id") {
return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getSavedJson(key, fallback) {
try {
return JSON.parse(localStorage.getItem(key)) || fallback;
} catch {
return fallback;
}
}

function saveJson(key, value) {
localStorage.setItem(key, JSON.stringify(value));
}

function getContactLetter(contact) {
const firstChar = (contact.name || "#").trim().charAt(0).toUpperCase();

if (firstChar >= "A" && firstChar <= "Z") return firstChar;

return "#";
}

function getSortedContacts() {
const contacts = getSavedJson(CONTACTS_KEY, []);

return contacts.sort((a, b) => {
return (a.name || "").localeCompare(b.name || "", "de");
});
}

function getAvailableLetters(contacts) {
const letters = new Set();

contacts.forEach((contact) => {
letters.add(getContactLetter(contact));
});

return letters;
}

function renderLetterNav(contacts) {
const availableLetters = getAvailableLetters(contacts);
const letters = ["ALLE", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];

letterNav.innerHTML = "";

letters.forEach((letter) => {
const button = document.createElement("button");
button.type = "button";
button.className = "letterBtn";
button.textContent = letter === "ALLE" ? "Alle" : letter;

const hasContacts = letter === "ALLE" || availableLetters.has(letter);

if (!hasContacts) {
button.classList.add("disabled");
}

if (activeLetter === letter) {
button.classList.add("active");
}

button.addEventListener("click", () => {
if (!hasContacts) return;

activeLetter = letter;
currentContactPage=1;
renderContacts();
});

letterNav.appendChild(button);
if (letter === "ALLE") {
  const star=document.createElement("button");star.type="button";star.className="letterBtn favoriteLetterBtn"+(favoritesOnly?" active":"");
  star.innerHTML=window.wpIcon?.("star",16)||"☆";star.title="Favoriten";star.setAttribute("aria-label","Nur Favoriten anzeigen");
  star.setAttribute("aria-pressed",String(favoritesOnly));star.addEventListener("click",()=>{favoritesOnly=!favoritesOnly;activeLetter="ALLE";currentContactPage=1;renderContacts()});letterNav.appendChild(star);
}
});
}

const contactUiState = { offers: [], invoices: [], events: [], query: "", type: "all", tag: "all" };
const contactEsc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const contactLinked = (row, id) => String(row.contact_id ?? row.contactId ?? "") === String(id);
const contactOpenOffer = row => !["accepted","rejected","angenommen","abgelehnt","cancelled","storniert"].includes(String(row.status || "").toLowerCase());
const contactOpenInvoice = row => !["paid","bezahlt","cancelled","storniert","void"].includes(String(row.status || "").toLowerCase());
const contactUpcomingEvent = (row, id) => {
  const linked = String(row.related_id ?? "") === String(id) && String(row.related_type || "").toLowerCase() === "contact";
  if (!linked) return false;
  const date = row.event_date ? new Date(`${row.event_date}T${row.event_time || "00:00"}`) : null;
  return date && !Number.isNaN(date.getTime()) && date >= new Date();
};
function contactTags(contact) {
  const offer = contactUiState.offers.some(row => contactLinked(row, contact.id) && contactOpenOffer(row));
  const invoice = contactUiState.invoices.some(row => contactLinked(row, contact.id) && contactOpenInvoice(row));
  const event = contactUiState.events.some(row => contactUpcomingEvent(row, contact.id));
  return {offer,invoice,event};
}
function renderContactMetrics() {
  const el=document.getElementById('contactMetrics'); if(!el) return;
  const count=contactsCache.length;
  const companies=contactsCache.filter(isCompanyContact).length;
  const people=count-companies;
  const favorites=contactsCache.filter(isFavorite).length;
  const cards=[['users','Alle Kontakte',count,'Gespeicherte Kontakte'],['building-2','Firmenkontakte',companies,'Unternehmen'],['users','Privatkontakte',people,'Personen'],['star','Favoriten',favorites,'Markierte Kontakte']];
  el.innerHTML=cards.map(([icon,label,value,sub],i)=>`<div class="wpContactMetric"><div class="wpContactMetricIcon wpContactMetricIcon${i}">${window.wpIcon?.(icon,22)||''}</div><div><div class="wpContactMetricLabel">${label}</div><div class="wpContactMetricValue">${value}</div><div class="wpContactMetricSub">${sub}</div></div></div>`).join('');
}
function renderContacts() {
  renderContactMetrics();
  const contacts = [...contactsCache].sort((a,b) => Number(isFavorite(b)) - Number(isFavorite(a)) || String(a.name || "").localeCompare(String(b.name || ""), "de"));
  
  
  contactsList.innerHTML = "";
  renderLetterNav(contacts);
  emptyContacts.style.display = contacts.length ? "none" : "block";
  const query = contactUiState.query.trim().toLocaleLowerCase("de");
  const visible = contacts.filter(contact => {
    if (activeLetter !== "ALLE" && getContactLetter(contact) !== activeLetter) return false;
    if (favoritesOnly && !isFavorite(contact)) return false;
    const company = isCompanyContact(contact);
    if (contactUiState.type === "company" && !company) return false;
    if (contactUiState.type === "person" && company) return false;
    const tags = contactTags(contact);
    if (contactUiState.tag !== "all" && !tags[contactUiState.tag]) return false;
    if (query && ![contact.name,contact.company,contact.company_name,contact.email,contact.phone].some(value => String(value || "").toLocaleLowerCase("de").includes(query))) return false;
    return true;
  });
  if (!visible.length && contacts.length) {
    contactsList.innerHTML = '<p class="contactNoResults">Keine passenden Kontakte gefunden.</p>';
    return;
  }
  const pages=Math.max(1,Math.ceil(visible.length/CONTACTS_PER_PAGE));
  currentContactPage=Math.min(Math.max(1,currentContactPage),pages);
  const pagination=document.getElementById('contactPagination');
  if(pagination){
    const buttons=Array.from({length:pages},(_,i)=>`<button type="button" data-page="${i+1}" class="${currentContactPage===i+1?'active':''}" aria-label="Seite ${i+1}" ${currentContactPage===i+1?'aria-current="page"':''}>${i+1}</button>`).join('');
    pagination.innerHTML=`<span>${visible.length?((currentContactPage-1)*CONTACTS_PER_PAGE+1):0}–${Math.min(currentContactPage*CONTACTS_PER_PAGE,visible.length)} von ${visible.length} Kontakten</span><div class="wpContactPageButtons"><button type="button" data-page="${Math.max(1,currentContactPage-1)}" ${currentContactPage===1?'disabled':''}>‹</button>${buttons}<button type="button" data-page="${Math.min(pages,currentContactPage+1)}" ${currentContactPage===pages?'disabled':''}>›</button></div>`;
    pagination.querySelectorAll('[data-page]').forEach(btn=>btn.addEventListener('click',()=>{currentContactPage=Number(btn.dataset.page);renderContacts();}));
  }
  visible.slice((currentContactPage-1)*CONTACTS_PER_PAGE,currentContactPage*CONTACTS_PER_PAGE).forEach(contact => {
    const name = contact.name || "Unbekannter Kontakt";
    const company = contact.company || contact.company_name || "–";
    const initials = name.trim().split(/\s+/).slice(0,2).map(word => word[0] || "").join("").toUpperCase();
    const tags = contactTags(contact);
    const tagHtml = [tags.offer ? '<span class="contactTag offer">Angebot</span>' : '',tags.invoice ? '<span class="contactTag invoice">Rechnung</span>' : '',tags.event ? '<span class="contactTag event">Termin</span>' : ''].filter(Boolean).join("") || '<span class="contactNoTags">–</span>';
    const row = document.createElement("div");
    row.className = "contactItem";
    row.innerHTML = `<div class="contactIdentity"><button type="button" class="contactFavoriteBtn ${isFavorite(contact) ? "isFavorite" : ""}" data-favorite="${contactEsc(contact.id)}" aria-label="${isFavorite(contact) ? "Aus Favoriten entfernen" : "Als Favorit markieren"}" aria-pressed="${isFavorite(contact)}" title="${isFavorite(contact) ? "Favorit entfernen" : "Favorit hinzufügen"}">${window.wpIcon?.("star",17)||"☆"}</button><span class="contactAvatar">${contactEsc(initials)}</span><div class="contactInfo"><strong class="contactName">${contactEsc(name)}</strong><span class="contactKind">${isCompanyContact(contact) ? "Firmenkontakt" : "Privatkontakt"}</span></div></div><div class="contactCompany">${contactEsc(company)}</div><div class="contactDetails"><span>${contactEsc(contact.email || "Keine E-Mail")}</span><span>${contactEsc(contact.phone || "Keine Telefonnummer")}</span></div><div class="contactTags">${tagHtml}</div><div class="contactActions"><button class="btn btnSecondary" data-open="${contactEsc(contact.id)}">Öffnen</button><button class="btn btnSecondary contactDelete" data-delete="${contactEsc(contact.id)}" aria-label="Kontakt löschen" title="Kontakt löschen">Löschen</button></div>`;
    contactsList.appendChild(row);
  });
  bindContactActions();
}
async function loadContactLinks() {
  const resources = [["offers", "/api/offers", "offers"],["invoices", "/api/invoices", "invoices"],["events", "/api/calendar-events", "events"]];
  await Promise.all(resources.map(async ([key,url,field]) => {
    try { const response = await fetch(url); if (!response.ok) return; const data = await response.json(); if (data.ok && Array.isArray(data[field])) contactUiState[key] = data[field]; }
    catch (error) { console.warn("Kontaktzuordnungen nicht verfügbar:",key,error); }
  }));
  renderContacts();
}

function openContact(event) {
const contactId = event.target.dataset.open;
window.location.href = `/contact-detail?id=${contactId}`;
}

async function deleteContact(event) {
const contactId = event.target.dataset.delete;

try {
await apiDeleteContact(contactId);

showToast("Kontakt wurde gelöscht.");

contactsCache = await apiGetContacts();
renderContacts();

} catch (error) {
showToast(error.message);
}
}

function bindContactActions() {
document.querySelectorAll("[data-favorite]").forEach(button => button.addEventListener("click", async () => {
  const id = button.dataset.favorite;
  const contact = contactsCache.find(row => String(row.id) === id);
  if (!contact) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/contacts/${encodeURIComponent(id)}/favorite`, {method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({favorite:!isFavorite(contact)})});
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Favorit konnte nicht gespeichert werden.");
    contactsCache = contactsCache.map(row => String(row.id) === id ? result.contact : row);
    renderContacts();
  } catch (error) { button.disabled = false; showToast(error.message); }
}));
document.querySelectorAll("[data-open]").forEach((button) => {
button.addEventListener("click", openContact);
});

document.querySelectorAll("[data-delete]").forEach((button) => {
button.addEventListener("click", deleteContact);
});
}

document.addEventListener("DOMContentLoaded", async () => {
try {
contactsCache = await apiGetContacts();
renderContacts();
await loadContactLinks();
} catch (error) {
showToast(error.message);
renderContacts();
}
});


const contactSearchInput = document.getElementById("contactSearch");
contactSearchInput?.addEventListener("input", event => { contactUiState.query = event.target.value; currentContactPage=1; renderContacts(); });
document.getElementById("contactTypeFilter")?.addEventListener("change", event => { contactUiState.type = event.target.value; currentContactPage=1; renderContacts(); });
document.getElementById("contactTagFilter")?.addEventListener("change", event => { contactUiState.tag = event.target.value; currentContactPage=1; renderContacts(); });

document.getElementById("contactAllTab")?.addEventListener("click", () => { favoritesOnly=false; activeLetter="ALLE"; currentContactPage=1; renderContacts(); });
document.getElementById("contactFavoritesTab")?.addEventListener("click", () => { favoritesOnly=true; activeLetter="ALLE"; currentContactPage=1; renderContacts(); });

// CSV-Export nur aus den vom Backend für diese Firma gelieferten Kontakten
document.getElementById('exportContacts')?.addEventListener('click',()=>{
 const clean=v=>{const t=String(v??'');return '"'+(/^[=+@\-\t\r]/.test(t)?"'":"")+t.replace(/"/g,'""')+'"'};
 const rows=[['Name','Unternehmen','E-Mail','Telefon','Typ','Favorit'],...contactsCache.map(c=>[c.name,c.company||c.company_name,c.email,c.phone,isCompanyContact(c)?'Firma':'Privat',isFavorite(c)?'Ja':'Nein'])];
 const csv='\uFEFF'+rows.map(row=>row.map(clean).join(';')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='WorkPilot_Kontakte.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
