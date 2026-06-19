(async () => {
  const TIMEOUT_MS = 15000;
  const CONCURRENCY = 4;   // сколько приложений опрашивать параллельно
 
  const m = location.pathname.match(/^(.*?)\/(hub|sense|dev-hub)\b/i);
  const PREFIX = m ? m[1] : '';
  const HTTP = location.origin + PREFIX;
  const WS   = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + PREFIX;
 
  // ---- xrfkey + CSRF-токен ----
  const xrf = Array.from({length:16}, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random()*62)]).join('');
  let CSRF = null;
  try {
    const r = await fetch(`${HTTP}/qps/csrftoken?Xrfkey=${xrf}`, { headers: { 'X-Qlik-Xrfkey': xrf }, credentials: 'include' });
    for (const [k, v] of r.headers.entries()) if (/csrf/i.test(k)) { CSRF = v; break; }
    console.log('[csrf] status', r.status, '| token', CSRF ? CSRF.slice(0,6)+'…' : '(НЕ найден)');
  } catch (e) { console.error('[csrf] fail', e); }
 
  const wsUrl = id => {
    const q = ['Xrfkey=' + xrf]; if (CSRF) q.push('qlik-csrf-token=' + encodeURIComponent(CSRF));
    return `${WS}/app/${encodeURIComponent(id)}?` + q.join('&');
  };
 
  // ---- 1. список всех приложений + поток (QRS) ----
  async function appsFromQRS() {
    const r = await fetch(`${HTTP}/qrs/app/full?Xrfkey=${xrf}`, { headers: { 'X-Qlik-Xrfkey': xrf }, credentials: 'include' });
    if (!r.ok) { console.warn('[qrs] /qrs/app/full ->', r.status, '— переключаюсь на GetDocList'); return null; }
    const arr = await r.json();
    return arr.map(a => ({ id: a.id, name: a.name, streamName: a.stream ? a.stream.name : '' }));
  }
  // запасной путь — список из движка (без потока)
  function appsFromEngine() {
    return new Promise(resolve => {
      let done = false, ws; const fin = l => { if (done) return; done = true; clearTimeout(t); try{ws&&ws.readyState===1&&ws.close();}catch(_){}; resolve(l); };
      const t = setTimeout(() => fin([]), TIMEOUT_MS);
      try { ws = new WebSocket(`${WS}/app/engineData?Xrfkey=${xrf}` + (CSRF ? '&qlik-csrf-token=' + encodeURIComponent(CSRF) : '')); } catch (e) { return fin([]); }
      ws.onopen = () => ws.send(JSON.stringify({ jsonrpc:'2.0', id:1, method:'GetDocList', handle:-1, params:[] }));
      ws.onclose = () => { if (!done) fin([]); };
      ws.onmessage = ev => { let r; try { r = JSON.parse(ev.data); } catch(_){ return; } if (r.id !== 1) return;
        const docs = (r.result && r.result.qDocList) || []; fin(docs.map(d => ({ id: d.qDocId, name: d.qTitle || d.qDocName, streamName: '' }))); };
    });
  }
 
  // ---- 2. тема приложения (Engine: appprops) ----
  function getTheme(appId) {
    return new Promise(resolve => {
      let done = false, ws, rid = 0, appH, idOpen, idCreate, idLayout;
      const fin = (theme, err) => { if (done) return; done = true; clearTimeout(timer); try{ws&&ws.readyState===1&&ws.close();}catch(_){}; resolve({ theme: theme || '', error: err || null }); };
      const timer = setTimeout(() => fin('', 'timeout'), TIMEOUT_MS);
      try { ws = new WebSocket(wsUrl(appId)); } catch (e) { return fin('', 'ctor'); }
      const send = (mth, h, p) => { const id = ++rid; ws.send(JSON.stringify({ jsonrpc:'2.0', id, method:mth, handle:h, params:p })); return id; };
      ws.onopen = () => { idOpen = send('OpenDoc', -1, [appId, '', '', '', true]); };
      ws.onclose = () => { if (!done) fin('', 'closed'); };
      ws.onmessage = ev => {
        let r; try { r = JSON.parse(ev.data); } catch(_){ return; }
        if (typeof r.id !== 'number') return;
        if (r.error) return fin('', r.error.message || 'rpc');
        if (r.id === idOpen) {
          appH = r.result.qReturn.qHandle;
          idCreate = send('CreateSessionObject', appH, [{ qInfo: { qType: 'AppPropsList' }, qAppObjectListDef: { qType: 'appprops', qData: { theme: '/theme' } } }]);
        } else if (r.id === idCreate) {
          idLayout = send('GetLayout', r.result.qReturn.qHandle, []);
        } else if (r.id === idLayout) {
          const items = (r.result.qLayout && r.result.qLayout.qAppObjectList && r.result.qLayout.qAppObjectList.qItems) || [];
          fin(items.length && items[0].qData ? items[0].qData.theme : '', null);
        }
      };
    });
  }
 
  // ---- пул параллельных запросов ----
  async function mapPool(items, fn, limit) {
    const res = new Array(items.length); let idx = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (idx < items.length) { const i = idx++; res[i] = await fn(items[i], i); } }));
    return res;
  }
 
  // ---- запуск ----
  let apps = await appsFromQRS();
  if (!apps) apps = await appsFromEngine();
  console.log('[apps] всего к обработке:', apps.length);
 
  const out = await mapPool(apps, async (a, i) => {
    const { theme, error } = await getTheme(a.id);
    console.log(`[${i+1}/${apps.length}]`, a.name, '| поток:', a.streamName || '—', '| тема:', theme || '(по умолчанию)', error ? '| ' + error : '');
    return { appName: a.name, streamName: a.streamName, theme: theme || '(по умолчанию)', appId: a.id };
  }, CONCURRENCY);
 
  console.table(out);
  window.__qlikAppThemes = out;
 
  // ---- CSV с разделителем | ----
  const SEP = '|';
  const headers = ['Имя приложения', 'Имя потока', 'Тема', 'ID приложения'];
  const esc = v => { v = (v == null ? '' : String(v)); return /[|"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = '\uFEFF' + [headers.join(SEP), ...out.map(o => [o.appName, o.streamName, o.theme, o.appId].map(esc).join(SEP))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'qlik_app_themes_' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'-') + '.csv' });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  console.log('[csv] скачан, строк:', out.length);
  return out;
})();
