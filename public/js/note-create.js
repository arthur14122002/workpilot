const noteCreateForm =
document.getElementById("noteCreateForm");

const noteText =
document.getElementById("noteText");

function getContactIdFromUrl() {
const params = new URLSearchParams(window.location.search);
return params.get("contactId");
}

async function apiCreateNote(note) {
const response = await fetch("/api/notes", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(note)
});

const result = await response.json();

if (!result.ok) {
throw new Error(result.error || "Notiz konnte nicht gespeichert werden.");
}

return result.note;
}

noteCreateForm.addEventListener("submit", async (event) => {
event.preventDefault();

const contactId = getContactIdFromUrl();

if (!contactId) {
showToast("Kontakt wurde nicht gefunden.");
return;
}

try {

await apiCreateNote({
contactId,
type: "note",
text: noteText.value.trim(),
source: "manual"
});

sessionStorage.setItem(
"workpilot_toast",
"Notiz wurde gespeichert."
);

window.location.href =
`/contact-detail?id=${contactId}`;

} catch (error) {
showToast(error.message);
}
});
