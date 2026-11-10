/* Navigate from the desktop owner shortcuts only after the account is authorized.
   Does not modify authentication, graph data, or day-off values. */
(function(){
  const intent=location.hash;
  if(intent!=='#personal-view' && intent!=='#day-off')return;
  let done=false;
  const apply=()=>{
    if(done)return;
    const workspace=document.getElementById('private-schedule');
    if(!workspace || workspace.hidden)return;
    if(intent==='#personal-view'){
      const tab=document.getElementById('personal-tab');
      if(!tab || tab.hidden || typeof window.showPersonalView!=='function')return;
      done=true;
      window.showPersonalView();
    } else {
      const button=document.getElementById('redDotToggleBtn');
      if(!button || button.hidden)return;
      done=true;
      button.scrollIntoView({block:'center'});
      button.focus({preventScroll:true});
    }
    observer.disconnect();
  };
  const observer=new MutationObserver(apply);
  const start=()=>{
    const workspace=document.getElementById('private-schedule');
    if(!workspace)return;
    observer.observe(workspace,{attributes:true,attributeFilter:['hidden']});
    apply();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
