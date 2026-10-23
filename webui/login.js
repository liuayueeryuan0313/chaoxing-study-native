(() => {
  const dialog=document.getElementById('loginDialog'),img=document.getElementById('loginImage'),hint=document.getElementById('loginHint');
  let timer,phase='idle',fetching=false,announced=false;
  async function refresh(){
    clearTimeout(timer);if(!dialog.open)return;
    if(fetching){timer=setTimeout(refresh,3000);return;}fetching=true;
    try{const r=await fetch('./api/qr',{cache:'no-store'});const view=await r.json();
      if(view.available){img.src=view.image;img.hidden=false;img.dataset.kind='qr';hint.textContent='请用学习通 App 扫码，并在手机上确认。';}
      else{img.hidden=true;img.removeAttribute('src');hint.textContent=phase==='failed'?'请收起面板查看错误提示。':'正在检查会话；已有有效登录时无需再次扫码。';}
    }catch(e){hint.textContent='二维码请求失败，正在重试。';}
    finally{fetching=false;if(dialog.open)timer=setTimeout(refresh,3000);}
  }
  function open(){if(!dialog.open)dialog.showModal();refresh();}
  function close(){if(dialog.open)dialog.close();clearTimeout(timer);img.hidden=true;img.removeAttribute('src');}
  document.getElementById('loginClose').onclick=close;dialog.addEventListener('close',()=>clearTimeout(timer));
  window.cxLoginPanel={open,phase(next,qrReady){phase=next;if(next!=='logging_in')announced=false;if(next==='logging_in'&&qrReady&&!announced){announced=true;open();}if(['ready','scanning','running','completed','closed','stopped'].includes(next))close();}};
})();
