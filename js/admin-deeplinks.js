/* Open the existing owner panels when linked from the desktop dashboard.
   This only reveals an already-authorized panel; Firestore permissions are unchanged. */
(function(){
 const id=location.hash.slice(1);
 if(id!=='owner-panel'&&id!=='owner-users-panel')return;
 let done=false;
 const apply=()=>{
   if(done)return;
   const panel=document.getElementById(id);
   const page=document.getElementById('admin-panel');
   if(!page||page.hidden||!panel||panel.hidden)return;
   done=true;
   panel.open=true;
   panel.scrollIntoView({block:'start'});
   observer.disconnect();
 };
 const observer=new MutationObserver(apply);
 const begin=()=>{
   const page=document.getElementById('admin-panel');
   const panel=document.getElementById(id);
   if(!page||!panel)return;
   observer.observe(page,{attributes:true,attributeFilter:['hidden']});
   observer.observe(panel,{attributes:true,attributeFilter:['hidden']});
   apply();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',begin,{once:true});
 else begin();
})();
