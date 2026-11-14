(()=>{const k="mattermost-deck-site-language",h=document.documentElement;
const set=l=>{h.dataset.lang=l;h.lang=l;document.querySelectorAll("[data-set]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.set===l)));try{localStorage.setItem(k,l)}catch{}};
let l=new URLSearchParams(location.search).get("lang");try{l=l||localStorage.getItem(k)}catch{}
if(l!=="ja"&&l!=="en")l=navigator.language.toLowerCase().startsWith("ja")?"ja":"en";
document.getElementById('tt').onclick=()=>{const n=h.dataset.theme==='light'?'dark':'light';h.dataset.theme=n;try{localStorage.setItem('mattermost-deck-site-theme',n)}catch{}};
set(l);document.querySelectorAll("[data-set]").forEach(b=>b.onclick=()=>set(b.dataset.set));})();
