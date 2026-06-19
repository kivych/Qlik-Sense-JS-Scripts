(async () => {
  // ===== реальные GUID приложений =====
  const APP_IDS = [
    'ВАШ-APP-ID',
  ];
  const TIMEOUT_MS = 15000;
  const VERBOSE = true;
 
  const m = location.pathname.match(/^(.*?)\/(hub|sense|dev-hub)\b/i);
  const PREFIX = m ? m[1] : '';
  const HTTP = location.origin + PREFIX;
  const WS   = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + PREFIX;
  const abs  = u => (!u ? null : (u.startsWith('http') ? u : HTTP + u));
  console.log('[cfg] WS =', WS, '| HTTP =', HTTP);
  if (APP_IDS.some(x => /ВАШ-APP-ID|aaaaaaaa-bbbb/.test(x)))
    console.warn('[!] APP_IDS не заполнен реальными GUID — впиши их.');
 
  function processApp(appId) {
    return new Promise(resolve => {
      const res = { appId, appName: null, appThumbUrl: null, sheets: [], error: null };
      let done = false, ws, appH = null, rid = 0, idOpen, idProps, idCreate, idLayout;
      const finish = () => { if (done) return; done = true; clearTimeout(timer);
        try { if (ws && ws.readyState === 1) ws.close(); } catch (_) {} resolve(res); };
      const timer = setTimeout(() => { res.error = res.error || ('timeout ' + TIMEOUT_MS + 'ms');
        console.warn('[timeout]', appId); finish(); }, TIMEOUT_MS);
 
      try { ws = new WebSocket(`${WS}/app/${encodeURIComponent(appId)}`); }
      catch (e) { res.error = 'WS ctor: ' + e.message; return finish(); }
 
      const send = (method, handle, params) => {
        const id = ++rid; ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, handle, params })); return id; };
 
      ws.onopen  = () => { if (VERBOSE) console.log('[open]', appId); idOpen = send('OpenDoc', -1, [appId, '', '', '', true]); };
      ws.onerror = () => console.error('[ws error]', appId);
      ws.onclose = e => { if (VERBOSE) console.warn('[close]', appId, 'code=', e.code, 'reason=', e.reason || '(пусто)');
        if (!done) { res.error = res.error || ('closed ' + e.code); finish(); } };
 
      ws.onmessage = ev => {
        let r; try { r = JSON.parse(ev.data); } catch (_) { return; }
        if (typeof r.id !== 'number') {
          if (VERBOSE && r.method) console.log('[notify]', appId, r.method, (r.params && r.params.qSessionState) || ''); return; }
        if (r.error) { res.error = r.error.message || JSON.stringify(r.error); console.error('[rpc error]', appId, res.error); return finish(); }
 
        if (r.id === idOpen) {
          appH = r.result.qReturn.qHandle;
          idProps = send('GetAppProperties', appH, []);
        } else if (r.id === idProps) {
          const p = (r.result && r.result.qProp) || {};
          res.appName = p.qTitle || null;
          res.appThumbUrl = abs(p.qThumbnail && p.qThumbnail.qUrl);
          idCreate = send('CreateSessionObject', appH, [{
            qInfo: { qType: 'SheetList' },
            qAppObjectListDef: { qType: 'sheet', qData: { title: '/qMetaDef/title', thumbnail: '/thumbnail' } } }]);
        } else if (r.id === idCreate) {
          idLayout = send('GetLayout', r.result.qReturn.qHandle, []);
        } else if (r.id === idLayout) {
          const items = (r.result.qLayout && r.result.qLayout.qAppObjectList && r.result.qLayout.qAppObjectList.qItems) || [];
          res.sheets = items.map(s => {
            const t = s.qData && s.qData.thumbnail;
            const url = t && ((t.qStaticContentUrl && t.qStaticContentUrl.qUrl) || (t.qStaticContentUrlDef && t.qStaticContentUrlDef.qUrl));
            return { sheetId: s.qInfo.qId, sheetName: (s.qMeta && s.qMeta.title) || (s.qData && s.qData.title) || null, sheetThumbUrl: abs(url) }; });
          finish();
        }
      };
    });
  }
 
  const out = [];
  for (const id of APP_IDS) out.push(await processApp(id));
 
  console.log(JSON.stringify(out, null, 2));
  const flat = out.flatMap(a => a.sheets.length
    ? a.sheets.map(s => ({ app: a.appName, appId: a.appId, appThumb: a.appThumbUrl, sheet: s.sheetName, sheetId: s.sheetId, sheetThumb: s.sheetThumbUrl }))
    : [{ app: a.appName, appId: a.appId, appThumb: a.appThumbUrl, sheet: '(' + (a.error || 'нет листов') + ')', sheetId: '', sheetThumb: null }]);
  console.table(flat);
  window.__qlikPreviews = out;
  try { copy(JSON.stringify(out, null, 2)); console.log('[ok] JSON в буфере'); } catch (_) {}
  return out;
})();
(() => {
  const data = window.__qlikPreviews || [];
  const SEP = '|';
  const headers = ['app', 'appId', 'appThumb', 'sheet', 'sheetId', 'sheetThumb'];
 
  const rows = data.flatMap(a => a.sheets.length
    ? a.sheets.map(s => [a.appName, a.appId, a.appThumbUrl, s.sheetName, s.sheetId, s.sheetThumbUrl])
    : [[a.appName, a.appId, a.appThumbUrl, '(' + (a.error || 'нет листов') + ')', '', '']]);
 
  // экранируем только если в значении есть | " перевод строки
  const esc = v => { v = (v == null ? '' : String(v));
    return /[|"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
 
  const csv = '\uFEFF' + [headers.join(SEP), ...rows.map(r => r.map(esc).join(SEP))].join('\r\n'); // BOM — чтобы Excel не ломал кириллицу
 
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: 'qlik_previews_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv'
  });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  console.log('[csv] скачан, строк:', rows.length);
})();
