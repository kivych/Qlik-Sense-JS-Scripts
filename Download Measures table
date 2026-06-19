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
 
  function download(filename, content, mime = 'text/plain;charset=utf-8') {
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
 
  const vpPrefix = detectVpPrefix(location.pathname);
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsProto}://${location.host}${vpPrefix}/app/${appId}`;
 
  console.log('pathname =', location.pathname);
  console.log('virtual proxy prefix =', vpPrefix || '/');
  console.log('wsUrl =', wsUrl);
 
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
 
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
    const timer = setTimeout(() => reject(new Error('WebSocket timeout')), 15000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
  });
 
  // 1. OpenDoc
  const openDoc = await send(-1, 'OpenDoc', [appId]);
  const appHandle = openDoc.qReturn.qHandle;
  console.log('appHandle =', appHandle);
 
  // 2. CreateSessionObject exactly in the style of your working example
  const measureListDef = {
    qInfo: {
      qType: 'MeasureList'
    },
    qMeasureListDef: {
      qType: 'measure',
      qData: {
        title: '/title',
        tags: '/tags'
      }
    }
  };
 
  const measureListObj = await send(appHandle, 'CreateSessionObject', [measureListDef]);
  const measureListHandle = measureListObj.qReturn.qHandle;
  console.log('measureListHandle =', measureListHandle);
 
  // 3. GetLayout
  const measureListLayoutRes = await send(measureListHandle, 'GetLayout', []);
  const measureListLayout = measureListLayoutRes.qLayout || {};
  const measureItems = measureListLayout?.qMeasureList?.qItems || [];
 
  console.log('master measures found =', measureItems.length);
  console.log('raw measure list layout =', measureListLayout);
 
  async function getMeasureDetails(measureId) {
    const getMeasureRes = await send(appHandle, 'GetMeasure', [measureId]);
    const measureHandle = getMeasureRes.qReturn.qHandle;
 
    let info = null;
    let properties = null;
    let layout = null;
    let infoError = null;
    let propertiesError = null;
    let layoutError = null;
 
    try {
      const r = await send(measureHandle, 'GetInfo', []);
      info = r.qInfo || null;
    } catch (e) {
      infoError = String(e);
    }
 
    try {
      const r = await send(measureHandle, 'GetProperties', []);
      properties = r.qProp || null;
    } catch (e) {
      propertiesError = String(e);
    }
 
    try {
      const r = await send(measureHandle, 'GetLayout', []);
      layout = r.qLayout || null;
    } catch (e) {
      layoutError = String(e);
    }
 
    return {
      measureId,
      measureHandle,
      info,
      properties,
      layout,
      infoError,
      propertiesError,
      layoutError
    };
  }
 
  const full = [];
 
  for (const item of measureItems) {
    const measureId = item?.qInfo?.qId;
    if (!measureId) continue;
 
    try {
      const details = await getMeasureDetails(measureId);
      full.push({
        listItem: item,
        ...details
      });
      console.log('loaded:', item?.qMeta?.title || item?.qData?.title || measureId);
    } catch (e) {
      console.error('failed:', measureId, e);
      full.push({
        listItem: item,
        measureId,
        error: String(e)
      });
    }
  }
 
  const result = {
    exportedAt: new Date().toISOString(),
    appId,
    host: location.host,
    virtualProxyPrefix: vpPrefix,
    appHandle,
    measureListHandle,
    masterMeasureCount: full.length,
    rawMeasureListLayout: measureListLayout,
    masterMeasures: full
  };
 
  download(
    `qlik_master_measures_${appId}.txt`,
    JSON.stringify(result, null, 2)
  );
 
  console.log('Готово. TXT скачан.');
  window.__qlikMasterMeasuresDump = result;
 
  ws.close();
})();
