(async () => {
  const path = location.pathname;
  const m = path.match(/^(.*)\/sense\/app\/([0-9a-f-]+)/i);
  if (!m) {
    throw new Error("Не удалось определить appId из URL.");
  }
 
  const vpPrefix = m[1] || "";
  const appId = m[2];
  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${wsProto}://${location.host}${vpPrefix}/app/${appId}`;
 
  console.log("Qlik appId:", appId);
  console.log("Virtual proxy prefix:", vpPrefix || "/");
  console.log("WebSocket URL:", wsUrl);
 
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let msgId = 1;
  let appHandle = null;
 
  function send(handle, method, params = []) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
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
      console.error("Не JSON:", event.data);
      return;
    }
 
    if (!("id" in msg)) {
      return;
    }
 
    const p = pending.get(msg.id);
    if (!p) {
      return;
    }
    pending.delete(msg.id);
 
    if (msg.error) {
      p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`));
    } else {
      p.resolve(msg.result);
    }
  };
 
  ws.onerror = (e) => {
    console.error("WebSocket error", e);
  };
 
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    setTimeout(() => reject(new Error("Таймаут открытия WebSocket")), 15000);
  });
 
  // даже если appId есть в URI, OpenDoc всё равно нужен
  const openDocResult = await send(-1, "OpenDoc", [appId]);
  appHandle = openDocResult.qReturn.qHandle;
  console.log("App handle:", appHandle);
 
  const listDef = {
    qType: "variable",
    qShowReserved: true,
    qShowConfig: true,
    qData: {
      tags: "/tags"
    }
  };
 
  const listResult = await send(appHandle, "GetVariables", [listDef]);
  const variableList = listResult.qList || [];
  console.log("Variables found:", variableList.length);
 
  async function getVariableFull(name) {
    const byName = await send(appHandle, "GetVariableByName", [name]);
    const h = byName.qReturn.qHandle;
 
    let props = null;
    let layout = null;
    let raw = null;
    let propsError = null;
    let layoutError = null;
    let rawError = null;
 
    try {
      props = await send(h, "GetProperties", []);
    } catch (e) {
      propsError = String(e);
    }
 
    try {
      layout = await send(h, "GetLayout", []);
    } catch (e) {
      layoutError = String(e);
    }
 
    try {
      raw = await send(h, "GetRawContent", []);
    } catch (e) {
      rawError = String(e);
    }
 
    return {
      name,
      handle: h,
      properties: props ? props.qProp : null,
      layout: layout ? layout.qLayout : null,
      rawContent: raw || null,
      propsError,
      layoutError,
      rawError
    };
  }
 
  const full = [];
  for (const item of variableList) {
    const name = item.qName;
    if (!name) continue;
 
    try {
      const details = await getVariableFull(name);
      full.push({
        listItem: item,
        ...details
      });
      console.log(`Loaded: ${name}`);
    } catch (e) {
      console.error(`Ошибка для ${name}:`, e);
      full.push({
        listItem: item,
        name,
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
 
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
 
  function escCsv(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[;"\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }
 
  const csvRows = [];
  csvRows.push([
    "name",
    "qId",
    "qType",
    "qText",
    "qNum",
    "qDefinition",
    "qComment",
    "qTags",
    "qIsScriptCreated",
    "qIncludeInBookmark",
    "qIsReserved",
    "propsError",
    "layoutError",
    "rawError"
  ].join(";"));
 
  for (const v of full) {
    const li = v.listItem || {};
    const props = v.properties || {};
    const layout = v.layout || {};
    const qInfo = layout.qInfo || {};
    const qData = li.qData || {};
 
    csvRows.push([
      escCsv(v.name),
      escCsv(qInfo.qId),
      escCsv(qInfo.qType),
      escCsv(layout.qText),
      escCsv(layout.qNum),
      escCsv(props.qDefinition ?? li.qDefinition),
      escCsv(props.qComment ?? li.qDescription),
      escCsv(qData.tags),
      escCsv(props.qIsScriptCreated),
      escCsv(props.qIncludeInBookmark),
      escCsv(li.qIsReserved),
      escCsv(v.propsError),
      escCsv(v.layoutError),
      escCsv(v.rawError)
    ].join(";"));
  }
 
  download(`qlik_variables_${appId}.json`, JSON.stringify(result, null, 2), "application/json;charset=utf-8");
  download(`qlik_variables_${appId}.csv`, csvRows.join("\r\n"), "text/csv;charset=utf-8");
 
  console.log("Готово. JSON и CSV скачаны.");
  window.__qlikVariablesExport = result;
})();
