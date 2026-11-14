(()=>{const k="mattermost-deck-site-language",h=document.documentElement;
const set=l=>{h.dataset.lang=l;h.lang=l;document.querySelectorAll("[data-set]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.set===l)));try{localStorage.setItem(k,l)}catch{}};
let l=new URLSearchParams(location.search).get("lang");try{l=l||localStorage.getItem(k)}catch{}
if(l!=="ja"&&l!=="en")l=navigator.language.toLowerCase().startsWith("ja")?"ja":"en";
document.getElementById('tt').onclick=()=>{const n=h.dataset.theme==='light'?'dark':'light';h.dataset.theme=n;try{localStorage.setItem('mattermost-deck-site-theme',n)}catch{}};
set(l);document.querySelectorAll("[data-set]").forEach(b=>b.onclick=()=>set(b.dataset.set));})();
(()=>{
  let box=null;
  // Group only the images that are visible for the current language and theme.
  const refresh=()=>{
    if(!window.GLightbox)return;
    if(box){box.destroy();box=null}
    let hidden=0;
    document.querySelectorAll(".glightbox").forEach(a=>{a.dataset.gallery=a.offsetParent?"visible":"hidden-"+(hidden++)});
    box=window.GLightbox({selector:".glightbox",touchNavigation:true,loop:true});
  };
  window.addEventListener("load",refresh);
  document.addEventListener("click",e=>{if(e.target.closest("[data-set],#tt"))setTimeout(refresh,0)});
})();
