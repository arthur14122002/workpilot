(()=>{
 const button=document.getElementById('confirmCompanyDeletion');
 const result=document.getElementById('result');
 const params=new URLSearchParams(location.hash.slice(1));
 const token=params.get('token');
 history.replaceState(null,'',location.pathname);
 if(!token||!/^[a-f0-9]{64}$/.test(token)){button.disabled=true;result.textContent='Der Bestätigungslink ist ungültig.';return;}
 button.addEventListener('click',async()=>{
  if(!confirm('Firma und alle zugehörigen Daten unwiderruflich löschen?'))return;
  button.disabled=true;
  try{
   const response=await fetch('/api/auth/confirm-company-deletion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'Löschung fehlgeschlagen.');
   result.textContent='Die Firma wurde gelöscht. Du kannst dich abmelden.';
  }catch(error){result.textContent=error.message;button.disabled=false;}
 });
})();
