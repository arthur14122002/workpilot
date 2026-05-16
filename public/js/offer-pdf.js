const offerDocument = document.getElementById("offerDocument");

async function loadOffer() {
const params = new URLSearchParams(window.location.search);

const offerId = params.get("id");

if (!offerId) {
offerDocument.innerHTML = "<p>Kein Angebot gefunden.</p>";
return;
}

const response = await fetch(`/api/offers/${offerId}`);
const result = await response.json();

if (!result.ok) {
offerDocument.innerHTML = "<p>Angebot konnte nicht geladen werden.</p>";
return;
}

console.log(result);

const offer = result.offer;

offerDocument.innerHTML = `
<div class="offerPage">
<h1>${offer.offerNumber || "Angebot"}</h1>

<p>
${offer.recipientName || ""}
</p>
</div>
`;
}

document.addEventListener("DOMContentLoaded", loadOffer);