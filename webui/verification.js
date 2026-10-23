(() => {
  const dialog=document.getElementById('verificationDialog'),image=document.getElementById('verificationImage'),hint=document.getElementById('verificationHint'),input=document.getElementById('verificationCode'),submit=document.getElementById('verificationSubmit');
  let announced=false,fetching=false,lastId=null,revision=0,queued=false;
  const openButton=document.getElementById('btnVerification');openButton.onclick=()=>{if(!dialog.open)dialog.showModal();refresh();};
  async function refresh(force=false){
    if(fetching){queued=true;return;}fetching=true;const requestRevision=revision;
    try{const r=await fetch('./api/verification'+(force?'?refresh=1':'')),v=await r.json();if(!r.ok)throw new Error(v.error||'验证图片读取失败。');if(requestRevision!==revision)return;if(v.available){image.src=v.image;image.hidden=false;}else{image.hidden=true;image.removeAttribute('src');}}
    catch(e){if(requestRevision===revision)hint.textContent=e.message;}finally{fetching=false;if(queued){queued=false;if(announced)refresh();}}
  }
  document.getElementById('verificationClose').onclick=()=>dialog.close();
  document.getElementById('verificationRefresh').onclick=()=>refresh(true);
  document.getElementById('verificationForm').onsubmit=async e=>{e.preventDefault();const code=input.value.trim();input.value='';if(!/^[0-9A-Za-z]{4}$/.test(code)){hint.textContent='请输入图片中的 4 位字母或数字。';return;}submit.disabled=true;try{hint.textContent='已提交本人输入，正在核对平台响应…';await window.cxNative.request('verification',{code});}catch(e){hint.textContent=e.message;submit.disabled=false;}};
  window.cxVerificationPanel={update(required,busy,error,verification={}){
    submit.disabled=!required||(busy&&(!verification.waiting||verification.submitting));
    input.disabled=Boolean(verification.submitting);
    document.getElementById('verificationRefresh').disabled=Boolean(verification.submitting);
    openButton.hidden=!required;
    if(required&&(verification.id||null)!==lastId){lastId=verification.id||null;revision++;announced=false;image.hidden=true;image.removeAttribute('src');}
    if(required){if(verification.waiting&&!error)hint.textContent=verification.submitting?'正在核对本人输入…':'请输入验证码，通过后将自动从原位置继续。';if(!announced){announced=true;if(!dialog.open)dialog.showModal();refresh();}if(error?.code==='VERIFY_SITE')hint.textContent=error.message;}
    else{if(announced)revision++;announced=false;lastId=null;if(dialog.open)dialog.close();image.hidden=true;image.removeAttribute('src');}
  }};
})();
