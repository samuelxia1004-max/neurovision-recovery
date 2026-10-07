(function(root){
 'use strict';
 function mount(doc){
  const opened=()=>[...doc.querySelectorAll('details[data-dismiss-outside][open]')];
  function outside(event){
   if(doc.querySelector('dialog[open]'))return;
   const path=event.composedPath?.()||[];
   for(const editor of opened())if(!path.includes(editor)&&!editor.contains(event.target))editor.open=false;
  }
  function escape(event){
   if(event.key!=='Escape'||event.defaultPrevented||event.isComposing||doc.querySelector('dialog[open]'))return;
   const editors=opened();if(!editors.length)return;
   const focus=editors.find(editor=>editor.contains(doc.activeElement))||editors.at(-1);
   editors.forEach(editor=>{editor.open=false;});event.preventDefault();focus.querySelector('summary')?.focus({preventScroll:true});
  }
  doc.addEventListener('click',outside);doc.addEventListener('keydown',escape);
  return ()=>{doc.removeEventListener('click',outside);doc.removeEventListener('keydown',escape);};
 }
 if(typeof module!=='undefined'&&module.exports){module.exports={mount};return;}
 root.NVDismiss={mount,cleanup:mount(document)};
})(typeof window==='undefined'?globalThis:window);
