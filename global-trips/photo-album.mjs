export function createAlbum({root, apiBase, trip, getKey}) {
  let signedIn=false, generation=0, urls=[], busy=false;
  const status=root.querySelector('[data-photo-status]'), gallery=root.querySelector('[data-photo-gallery]'), form=root.querySelector('form'), file=form.querySelector('input[type=file]');
  const day=form.querySelector('select');
  for (const [index,item] of trip.itinerary.entries()) { const option=document.createElement('option'); option.value=new Date(Date.parse(trip.dates.start+'T00:00:00Z')+index*86400000).toISOString().slice(0,10); option.textContent=item.date; day.append(option); }
  const cover=document.querySelector('#privateCover');
  const base=`${apiBase}/v1/trips/${trip.id}/photos`;
  const clear=()=>{urls.forEach(URL.revokeObjectURL);urls=[];gallery.replaceChildren();document.querySelectorAll('.day-photos').forEach(node=>node.remove());cover.hidden=true;cover.removeAttribute('src');};
  async function request(path='', options={}) {
    const response=await fetch(base+path,{...options,cache:'no-store',headers:{Authorization:`Bearer ${getKey()}`,...options.headers},signal:AbortSignal.timeout(45000)});
    if(!response.ok){const messages={401:'登录已失效，请重新登录',409:'相册已满（24 张），请先移除不需要的照片',413:'图片太大，请换一张'};throw new Error(messages[response.status]||'照片暂时无法保存或读取，请重试');}
    return response;
  }
  async function refresh(){
    const epoch=++generation;status.textContent='正在读取照片…';
    try {
      const {photos}=await (await request()).json();
      const results=[];
      for(const photo of photos){
        if(epoch!==generation||!signedIn)return;
        const blob=await (await request('/'+photo.id)).blob();
        if(epoch!==generation||!signedIn)return;
        results.push({photo,blob});
      }
      if(epoch!==generation||!signedIn)return;
      clear();
      for(const {photo,blob} of results){
        const url=URL.createObjectURL(blob);urls.push(url);
        const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),remove=document.createElement('button');
        img.src=url;img.alt=photo.caption||'旅行照片';img.loading='lazy';
        caption.textContent=[photo.day==='cover'?'封面':photo.day,photo.caption].filter(Boolean).join(' · ');
        remove.type='button';remove.textContent='移除';remove.className='photo-remove';remove.setAttribute('aria-label',`移除${photo.caption||'这张照片'}`);
        remove.addEventListener('click',async()=>{if(busy||!signedIn)return;if(!confirm('从相册移除这张照片？'))return;busy=true;try{await request('/'+photo.id,{method:'DELETE'});await refresh()}catch(e){status.textContent=e.message}finally{busy=false}});
        figure.append(img,caption,remove);gallery.append(figure);
        const dayIndex=Math.round((Date.parse(photo.day+'T00:00:00Z')-Date.parse(trip.dates.start+'T00:00:00Z'))/86400000);
        const dayCard=document.querySelectorAll('#dayList .day')[dayIndex];
        if(dayCard){let photos=dayCard.querySelector('.day-photos');if(!photos){photos=document.createElement('div');photos.className='day-photos';dayCard.append(photos)}const copy=document.createElement('figure');copy.append(img.cloneNode(),caption.cloneNode(true));photos.append(copy);}
      }
      const hero=results.find(({photo})=>photo.day==='cover')||results[0];
      if(hero){const index=results.indexOf(hero);cover.src=urls[index];cover.hidden=false;}
      status.textContent=photos.length?`${photos.length} / 24 张 · 仅登录后可见`:'还没有照片，放一张喜欢的风景，开始这次旅行。';
    }catch(e){if(epoch===generation)status.textContent=e.message;}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!signedIn||busy||!file.files[0])return;
    busy=true;const epoch=generation;form.querySelector('button').disabled=true;status.textContent='正在压缩并上传…';
    try{
      const image=await compressPhoto(file.files[0]);
      if(!signedIn||epoch!==generation)return;
      await request('/'+crypto.randomUUID(),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({image,caption:form.querySelector('input[type=text]').value,day:day.value})});
      if(!signedIn||epoch!==generation)return;
      form.reset();await refresh();
    }catch(e){if(signedIn&&epoch===generation)status.textContent=e.message;}
    finally{busy=false;form.querySelector('button').disabled=!signedIn;}
  });
  root.querySelector('[data-photo-refresh]').addEventListener('click',()=>{if(signedIn&&!busy)refresh()});
  return {setAuth(value){if(value===signedIn)return;signedIn=value;form.querySelector('button').disabled=!value||busy;form.hidden=!value;root.querySelector('[data-photo-refresh]').hidden=!value;if(value)refresh();else{generation++;clear();file.value='';status.textContent='登录后可查看和上传私人照片';}}};
}
async function compressPhoto(file){
  if(file.size>30*1024*1024)throw new Error('请选一张小于 30 MB 的图片');
  let bitmap;
  try{bitmap=await createImageBitmap(file)}catch{throw new Error('这张图片暂不支持，请选择 JPEG、PNG 或 WebP 格式');}
  const canvas=document.createElement('canvas');const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  for(const quality of [.85,.7,.55,.4]){const encoded=canvas.toDataURL('image/jpeg',quality).split(',')[1];if(encoded.length<=700000)return encoded;}
  throw new Error('图片细节较多，压缩后仍太大，请裁剪后重试');
}
