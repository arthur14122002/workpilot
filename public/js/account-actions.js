document.addEventListener("DOMContentLoaded",()=>{
 const msg=document.getElementById("accountMessage"),form=document.getElementById("accountDeleteForm");
 const show=(message)=>{if(msg)msg.textContent=message;};
 document.getElementById("accountLogout")?.addEventListener("click",async()=>{
  try{const r=await fetch("/api/auth/logout",{method:"POST"});if(!r.ok)throw Error("Abmeldung fehlgeschlagen.");localStorage.removeItem("workpilot_company_settings");localStorage.removeItem("workpilot_dashboard_profile");location.assign("/login");}catch(e){show(e.message);}
 });
 document.getElementById("accountDeleteToggle")?.addEventListener("click",()=>{if(form)form.hidden=!form.hidden;});
 form?.addEventListener("submit",async e=>{
  e.preventDefault();if(!confirm("Nur dein Benutzerkonto löschen? Firmeninhaber können ihr Konto nicht über diese Funktion löschen."))return;
  const button=form.querySelector("button[type=submit]");button.disabled=true;
  try{const r=await fetch("/api/auth/delete-account",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:document.getElementById("deletePassword").value,confirmation:document.getElementById("deleteConfirmation").value})});const result=await r.json();if(!r.ok)throw Error(result.error||"Löschen fehlgeschlagen.");localStorage.removeItem("workpilot_company_settings");localStorage.removeItem("workpilot_dashboard_profile");location.assign("/login");}catch(e){show(e.message);button.disabled=false;}
 });
 document.getElementById("requestCompanyDeletion")?.addEventListener("click",async e=>{
  if(!confirm("Eine E-Mail zur Bestätigung der endgültigen Firmenlöschung anfordern?"))return;
  const btn=e.currentTarget;btn.disabled=true;
  try{const r=await fetch("/api/auth/request-company-deletion",{method:"POST"});const data=await r.json();if(!r.ok)throw Error(data.error||"Anforderung fehlgeschlagen.");show(data.message||"Prüfe dein E-Mail-Postfach.");}catch(err){show(err.message);}finally{btn.disabled=false;}
 });
});
