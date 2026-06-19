(async () => {
  const appId = 'PASTE YOUR APPID';
 
  function detectVpPrefix(pathname) {
    const markers = ['/dev-hub/', '/engine-api-explorer', '/sense/app/'];
    for (const marker of markers) {
      const idx = pathname.indexOf(marker);
      if (idx >= 0) return pathname.slice(0, idx);
    }
    return '';
  }
 
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
 
  function escCsv(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
 
  const vpPrefix = detectVpPrefix(location.pathname);
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsProto}://${location.host}${vpPrefix}/app/${appId}`;
 
  console.log('location.pathname =', location.pathname);
  console.log('virtual proxy prefix =', vpPrefix || '/');
  console.log('wsUrl =', wsUrl);
 
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  let appHandle = null;
 
  function send(handle, method, params = []) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        handle,
        method,
        params
      }));
    });
  }
 
  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.error('Non-JSON message:', event.data);
      return;
    }
 
    if (!('id' in msg)) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
 
    if (msg.error) {
      p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`));
    } else {
      p.resolve(msg.result);
    }
  };
 
  ws.onerror = (e) => {
    console.error('WebSocket error:', e);
  };
 
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Таймаут открытия WebSocket')), 15000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
  });
 
  const openDoc = await send(-1, 'OpenDoc', [appId]);
  appHandle = openDoc.qReturn.qHandle;
  console.log('appHandle =', appHandle);
 
  const listDef = {
    qType: 'variable',
    qShowReserved: true,
    qShowConfig: true,
    qData: {
      tags: '/tags'
    }
  };
 
  const varsRes = await send(appHandle, 'GetVariables', [listDef]);
  const qList = varsRes.qList || [];
  console.log('variables found =', qList.length);
 
  async function getVarDetails(qName) {
    const byName = await send(appHandle, 'GetVariableByName', [qName]);
    const varHandle = byName.qReturn.qHandle;
 
    let props = null;
    let layout = null;
    let info = null;
    let propsError = null;
    let layoutError = null;
    let infoError = null;
 
    try {
      const r = await send(varHandle, 'GetProperties', []);
      props = r.qProp || null;
    } catch (e) {
      propsError = String(e);
    }
 
    try {
      const r = await send(varHandle, 'GetLayout', []);
      layout = r.qLayout || null;
    } catch (e) {
      layoutError = String(e);
    }
 
    try {
      const r = await send(varHandle, 'GetInfo', []);
      info = r.qInfo || null;
    } catch (e) {
      infoError = String(e);
    }
 
    return {
      qName,
      varHandle,
      properties: props,
      layout,
      info,
      propsError,
      layoutError,
      infoError
    };
  }
 
  const full = [];
  for (const item of qList) {
    const qName = item.qName;
    if (!qName) continue;
 
    try {
      const details = await getVarDetails(qName);
      full.push({
        listItem: item,
        ...details
      });
      console.log('loaded:', qName);
    } catch (e) {
      console.error('failed:', qName, e);
      full.push({
        listItem: item,
        qName,
        error: String(e)
      });
    }
  }
 
  const result = {
    exportedAt: new Date().toISOString(),
    appId,
    host: location.host,
    virtualProxyPrefix: vpPrefix,
    variableCount: full.length,
    variables: full
  };
 
  const csvRows = [];
  csvRows.push([
    'qName',
    'qId',
    'qType',
    'qDefinition',
    'qDescription',
    'qText',
    'qNum',
    'qTags',
    'qCreatedDate',
    'qModifiedDate',
    'qPrivileges',
    'propsError',
    'layoutError',
    'infoError',
    'error'
  ].join(';'));
 
  for (const v of full) {
    const li = v.listItem || {};
    const meta = li.qMeta || {};
    const props = v.properties || {};
    const layout = v.layout || {};
    const info = v.info || {};
    const qData = li.qData || {};
 
    csvRows.push([
      escCsv(v.qName),
      escCsv(info.qId || li.qInfo?.qId),
      escCsv(info.qType || li.qInfo?.qType),
      escCsv(props.qDefinition ?? li.qDefinition),
      escCsv(props.qComment ?? li.qDescription),
      escCsv(layout.qText),
      escCsv(layout.qNum),
      escCsv(qData.tags),
      escCsv(meta.createdDate),
      escCsv(meta.modifiedDate),
      escCsv(Array.isArray(meta.privileges) ? meta.privileges.join(', ') : ''),
      escCsv(v.propsError),
      escCsv(v.layoutError),
      escCsv(v.infoError),
      escCsv(v.error)
    ].join(';'));
  }
 
  download(`qlik_variables_${appId}.json`, JSON.stringify(result, null, 2), 'application/json;charset=utf-8');
  download(`qlik_variables_${appId}.csv`, csvRows.join('\r\n'), 'text/csv;charset=utf-8');
 
  console.log('Готово. JSON и CSV скачаны.');
  window.__qlikVariableDump = result;
 
  ws.close();
})();
