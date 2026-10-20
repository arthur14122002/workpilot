document.addEventListener("DOMContentLoaded",()=>{
 const form=document.getElementById("resetPasswordForm"),status=document.getElementById("resetStatus");
 const hash=new URLSearchParams(location.hash.replace(/^#/,""));
 // Supabase recovery links supply a short-lived access/refresh session in the URL fragment.
 const accessToken=hash.get("access_token"),refreshToken=hash.get("refresh_token");
 const isRecovery=hash.get("type")==="recovery";
 history.replaceState(null,"",location.pathname);
 if(!isRecovery || !accessToken || !refreshToken){status.textContent="Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.";form.hidden=true;return;}
 form.addEventListener("submit",async e=>{
 e.preventDefault();const password=document.getElementById("newPassword").value;
 if(password!==document.getElementById("repeatPassword").value){status.textContent="Die Passwörter stimmen nicht überein.";return;}
 const button=form.querySelector("button");button.disabled=true;
 try{const response=await fetch("/api/auth/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accessToken,refreshToken,password})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Zurücksetzen fehlgeschlagen.");status.textContent="Passwort geändert! Du kannst dich jetzt anmelden.";form.hidden=true;}
 catch(error){status.textContent=error.message;button.disabled=false;}
 });
});