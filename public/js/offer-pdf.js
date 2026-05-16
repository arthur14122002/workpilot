const offerDocument = document.getElementById("offerDocument");

async function loadOfferPdf() {
const params = new URLSearchParams(window.location.search);
const offerId = params.get("id");

if (!offerId) {
offerDocument.innerHTML = `
<div class="pdfError">
Angebots-ID fehlt.
</div>
`;
return;
}

try {
const response = await fetch(`/api/offers/${offerId}`);
const result = await response.json();

if (!result.ok || !result.offer) {
throw new Error("Angebot konnte nicht geladen werden.");
}

const offerRow = result.offer;

const offer = {
...offerRow.data,
id: offerRow.id,
contactId: offerRow.contact_id,
status: offerRow.status,
offerNumber: offerRow.offer_number
};

const company = offer.companySettings || {};

const positionsHtml = (offer.positions || [])
.map((position, index) => {
return `
<tr>
<td>${index + 1}</td>
<td>${position.description || ""}</td>
<td>${position.quantity || ""}</td>
<td>${position.unit || ""}</td>
<td>${position.unitPrice || ""} €</td>
<td>${position.total || ""} €</td>
</tr>
`;
})
.join("");

offerDocument.innerHTML = `
<div class="offerPage">

<div class="offerTop">
<div>
<div class="senderSmall">
${company.companyName || ""}
</div>

<div class="recipientBlock">
<div>${offer.recipientName || ""}</div>
<div>${offer.recipientStreet || ""}</div>
<div>${offer.recipientCity || ""}</div>
</div>
</div>

<div class="offerMeta">
<div>
<strong>Angebotsnummer:</strong>
${offer.offerNumber || ""}
</div>

<div>
<strong>Datum:</strong>
${offer.offerDate || ""}
</div>

<div>
<strong>Gültig bis:</strong>
${offer.validUntil || ""}
</div>
</div>
</div>

<h1 class="offerTitle">
Angebot
</h1>

<p class="introText">
${offer.introText || ""}
</p>

<table class="offerTable">
<thead>
<tr>
<th>Pos.</th>
<th>Beschreibung</th>
<th>Menge</th>
<th>Einheit</th>
<th>Einzelpreis</th>
<th>Gesamtpreis</th>
</tr>
</thead>

<tbody>
${positionsHtml}
</tbody>
</table>

<p class="closingText">
${offer.closingText || ""}
</p>

</div>
`;

document.body.dataset.pdfReady = "true";

} catch (error) {
console.error(error);

offerDocument.innerHTML = `
<div class="pdfError">
PDF konnte nicht geladen werden.
</div>
`;
}
}

document.addEventListener("DOMContentLoaded", loadOfferPdf);