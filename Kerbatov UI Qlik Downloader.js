/* ============================================================================
 * Kerbatov metadata downloader · экспорт метаданных Qlik Sense
 * ----------------------------------------------------------------------------
 * Вставь весь файл в консоль DevTools, будучи авторизованным в Qlik Sense.
 * Запускать со страницы, где есть живая сессия и доступ к движку:
 *   · открытое приложение (…/app/<id>)
 *   · хаб
 *   · редактор загрузки
 *   · Engine API Explorer — после того как нажал «Connect to engine»
 * Прокси-префикс (dev-hub/dataloadeditor/дефолтный) определится сам.
 *
 * Язык интерфейса: тумблер RU · EN в шапке панели (выбор запоминается).
 *
 * Подключение к движку: скрипт сам получает CSRF-токен
 *             (…/qps/csrftoken → заголовок qlik-csrf-token) и передаёт его
 *             в WebSocket (?qlik-csrf-token=…&Xrfkey=…). Поэтому в норме
 *             в конфиге прокси НИЧЕГО менять не нужно.
 *             Только если движок не отвечает (в логе ошибка ws /
 *             «CSRF: не отдан») — временно и осознанно переключи в
 *             Proxy.exe.config (C:\Program Files\Qlik\Sense\Proxy\)
 *             WebSocketCSWSHCheckEnabled в false, а после работ верни true.
 *
 * Режимы:     Экспорт метаданных · Поиск подстроки в скриптах (test) ·
 *             Поиск подстроки в объектах (test)
 * Источники:  текущее приложение · список appId · поток по имени · все на сервере
 *             + фильтр по маске имени приложения (* и ?)
 * Данные:     Меры · Измерения · Переменные · Листы(Id+thumbnail) · Закладки ·
 *             Мастер-объекты · Общая инфа (thumbnail, тема, поток, публикация,
 *             lastReload) · Скрипты загрузки
 * Форматы:    CSV (свой разделитель) · JSON · XML
 *             В JSON скрипт хранится массивом строк scriptLines (спецификация
 *             JSON не допускает сырых переносов в строке; join('\n') вернёт код).
 * Разбиение:  галка «файл на приложение» × галка «файл на вид данных»
 * Дополнительно: упаковка в один ZIP (без библиотек, store) · «только проверка»
 *             (сводка без скачивания) · манифест ошибок · кнопка «Повтор ошибок»
 *             (перегоняет только сбойные приложения) · настраиваемый параллелизм
 *
 * Надёжность: автоподбор прокси-префикса (dev/dataloadeditor/дефолтный) ·
 *             изолированные engine-сессии (identity) · повтор при сбоях сети ·
 *             честная проба движка (GetDocList) · кнопка Стоп · прогресс-бар ·
 *             автосохранение настроек · уникальные имена файлов ·
 *             единый штамп времени на прогон
 * ============================================================================
 * Kerbatov metadata downloader · Qlik Sense metadata export
 * ----------------------------------------------------------------------------
 * Paste the whole file into the DevTools console while logged in to Qlik Sense.
 * Run it from a page that has a live session and engine access:
 *   · an opened app (…/app/<id>)
 *   · the hub
 *   · the data load editor
 *   · Engine API Explorer — after you clicked "Connect to engine"
 * The proxy prefix (dev-hub/dataloadeditor/default) is detected automatically.
 *
 * UI language: RU · EN toggle in the panel header (the choice is remembered).
 *
 * Engine connection: the script fetches the CSRF token itself
 *             (…/qps/csrftoken → qlik-csrf-token header) and passes it on the
 *             WebSocket (?qlik-csrf-token=…&Xrfkey=…). So normally you do NOT
 *             need to change anything in the proxy config.
 *             Only if the engine does not respond (ws error in the log /
 *             "CSRF: not returned") — temporarily and deliberately set
 *             WebSocketCSWSHCheckEnabled to false in Proxy.exe.config
 *             (C:\Program Files\Qlik\Sense\Proxy\) and restore true afterwards.
 *
 * Modes:      Export metadata · Search substring in scripts (test) ·
 *             Search substring in objects (test)
 * Sources:    current app · appId list · stream by name · all on server
 *             + app-name mask filter (* and ?)
 * Data:       Measures · Dimensions · Variables · Sheets(Id+thumbnail) ·
 *             Bookmarks · Master objects · General (thumbnail, theme, stream,
 *             published, lastReload) · Load scripts
 * Formats:    CSV (custom delimiter) · JSON · XML
 * Splitting:  "file per app" × "file per data type"
 * Extra:      single ZIP (no libs, store) · dry run (summary, no download) ·
 *             error manifest · "Retry errors" button · configurable parallelism
 * Reliability: proxy-prefix autodetect · isolated engine sessions (identity) ·
 *             network retry · honest engine probe (GetDocList) · Stop button ·
 *             progress bar · settings autosave · unique filenames · one run stamp
 * ==========================================================================*/
(() => {
  // ---------- очистка прошлой панели ----------
  document.getElementById('qme-panel')?.remove();
  document.getElementById('qme-style')?.remove();

  // ---------- общие хелперы ----------
  const SKEY = 'kmd_settings_v5';
  let LANG = 'ru';
  try { const _s = JSON.parse(localStorage.getItem(SKEY) || 'null'); if (_s && _s.lang) LANG = _s.lang; } catch {}

  let PREFIX = '', HTTP = location.origin, WS = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  const applyPrefix = p => { PREFIX = p || ''; HTTP = location.origin + PREFIX; WS = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + PREFIX; };
  const prefixCandidates = () => {
    const c = [];
    const mm = location.pathname.match(/^(.*?)\/(hub|sense|dev-hub|dataloadeditor|single|app)\b/i);
    if (mm) c.push(mm[1]);
    const seg = location.pathname.split('/')[1];
    if (seg) c.push('/' + seg);
    c.push('');
    return [...new Set(c)];
  };
  applyPrefix(prefixCandidates()[0]);

  const abs = u => (!u ? '' : (u.startsWith('http') ? u : HTTP + u));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const grp = g => g === 'H' ? t('grpH') : (g === 'N' ? t('grpN') : (g || ''));
  const xrf = Array.from({ length: 16 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('');
  let CSRF = null;
  let ABORT = false;
  let LAST_FAILED = [];   // приложения с ошибками последнего прогона — для кнопки «Повтор ошибок»
  const ts = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const safe = s => String(s || 'app').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60);
  const maskToRe = mask => { const esc = mask.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'); return new RegExp('^' + esc + '$', 'i'); };
  const splitLines = s => String(s || '').split(/\r\n|\n|\r/);

  // рекурсивный обход только строковых значений (для поиска подстроки в свойствах объекта)
  function walkStrings(v, cb) {
    if (v == null) return;
    if (typeof v === 'string') { cb(v); return; }
    if (Array.isArray(v)) { for (const x of v) walkStrings(x, cb); return; }
    if (typeof v === 'object') { for (const k in v) walkStrings(v[k], cb); }
  }
  const containsIn = (v, nd, ci) => { let hit = false; walkStrings(v, s => { if (hit) return; const hay = ci ? s.toLowerCase() : s; if (hay.indexOf(nd) !== -1) hit = true; }); return hit; };

  // ---------- i18n ----------
  const I18N = {
    ru: {
      subtitle: 'Qlik Sense · экспорт метаданных', close: 'Закрыть',
      secMode: 'Режим', modeExport: 'Экспорт метаданных', modeSearchScript: 'Поиск подстроки в скриптах', modeSearchObject: 'Поиск подстроки в объектах',
      needlePh: 'Подстрока для поиска', ci: 'Без учёта регистра',
      secApps: 'Приложения', srcCurrent: 'Текущее приложение', srcList: 'Список appId', srcStream: 'Поток (по имени)', srcAll: 'Все приложения на сервере',
      idsPh: 'appId через пробел, запятую или с новой строки', streamPh: 'Имя потока',
      maskPh: 'Маска имени приложения, напр. *Финанс* или Отчет_20??', maskHint: '* — любые символы, ? — один символ; пусто = без фильтра',
      perApp: 'Отдельный файл на каждое приложение',
      secData: 'Данные', toggleAllNone: 'все / нет',
      dMeasures: 'Меры', dDimensions: 'Измерения', dVariables: 'Переменные', dSheets: 'Листы (Id + thumbnail)', dBookmarks: 'Закладки',
      dMaster: 'Мастер-объекты (визуализации)', dGeneral: 'Общая инфа (thumbnail, тема, поток)', dScript: 'Скрипты загрузки',
      perCat: 'Отдельный файл для каждого вида данных',
      secFormat: 'Формат', delimPh: 'Разделитель CSV', zip: 'Упаковать всё в один ZIP', dry: 'Только проверка (сводка без скачивания)', limitLabel: 'Параллельно приложений:',
      btnRun: 'Запуск', btnRetry: 'Повтор ошибок', btnRetryTitle: 'Повторный прогон только приложений с ошибками', btnStop: 'Стоп',
      grpH: 'иерархия', grpN: 'одиночное', boolYes: 'да', boolNo: 'нет',
      ready: 'Панель готова. Настрой и нажми «Запуск».',
      detectingProxy: 'Определяю прокси и CSRF-токен…', checkingEngine: 'Проверяю соединение с движком…', engineOk: 'Движок: ок',
      errEngine: m => `Движок недоступен (${m}). Похоже на неверный прокси-префикс или устаревшую сессию — обнови страницу (F5), авторизуйся и перезапусти панель.`,
      proxyDefault: '(дефолтный)', csrfOk: 'ок', csrfNo: 'не отдан (продолжаю)',
      proxyCsrf: (p, ok) => `Прокси: "${p || '(дефолтный)'}" · CSRF: ${ok ? 'ок' : 'не отдан (продолжаю)'}`,
      proxyCsrfStatus: (p, st) => `Прокси "${p || '(дефолтный)'}": csrftoken → ${st}`,
      proxyErr: (p, m) => `Прокси "${p || '(дефолтный)'}": ${m}`,
      noProxyConfirmed: 'Ни один прокси не подтвердил сессию — пробую с текущим префиксом, но возможны отказы.',
      qrsStatus: (path, st) => `QRS ${path} → ${st}`,
      retryMsg: (att, total, id, err) => `   повтор ${att}/${total} для ${id}: ${err}`,
      errCurrentApp: 'Текущее приложение не определено по URL — открой приложение или выбери другой источник.',
      errEmptyIds: 'Список appId пуст.', errNoStream: 'Укажи имя потока.',
      errQrsStream: 'QRS недоступен — состав потока через Repository не получить (нужны права).',
      errStreamNotFound: (name, list) => `Поток "${name}" не найден. Есть: ${list}`,
      errUnknownSrc: 'Неизвестный источник.',
      maskMsg: (mask, n, before) => `Маска "${mask}": ${n} из ${before}`,
      qrsFallbackEngine: 'QRS недоступен — беру список из движка (GetDocList).',
      qrsNoEnrich: 'QRS недоступен — поля "поток/публикация" останутся пустыми.',
      zipWarn: 'Внимание: файлов больше 65000 — формат ZIP без ZIP64 может не открыться; сократи объём или выключи ZIP.',
      errNoData: 'Не отмечено ни одного типа данных.',
      errDelim: d => `Разделитель "${d}" не годится (буквы/цифры/кавычки исказят данные).`,
      retryRun: n => `Повторный прогон приложений с ошибками: ${n}`,
      resolvingApps: 'Определяю список приложений…', appsCount: n => `Приложений: ${n}`, errEmptyApps: 'Пустой список приложений.',
      confirmMany: n => `Будет обработано ${n} приложений. Это может занять заметное время. Продолжить?`,
      errCancelled: 'Отменено пользователем.',
      progressOk: (d, tot, name, r) => `[${d}/${tot}] ${name} (мер:${r.measures.length} изм:${r.dimensions.length} перем:${r.variables.length} лист:${r.sheets.length} зкл:${r.bookmarks.length} мо:${r.masterobjects.length} скрипт:${r.script ? r.script.length : 0})`,
      progressErr: (d, tot, name, err) => `[${d}/${tot}] ${name} — ОШИБКА: ${err}`,
      aborted: (d, tot) => `Прервано: обработано ${d} из ${tot} — выгружаю собранное.`,
      enriching: 'Обогащаю общую инфу из QRS (поток, публикация)…',
      drySummary: (apps, me, di, va, sh, bk, mo, sc, er) => `ПРОВЕРКА (файлы не скачаны): приложений ${apps} · мер ${me} · изм ${di} · перем ${va} · листов ${sh} · закладок ${bk} · мастер-объектов ${mo} · скриптов с текстом ${sc} · ошибок ${er}`,
      withErrors: list => 'С ошибками: ' + list,
      resultInWindow: 'Результат в window.__qlikExport — можно посмотреть в консоли.',
      buildingFiles: 'Формирую файлы…',
      doneZip: (packed, errs) => `Готово. В ZIP-архиве файлов: ${packed}. Ошибок: ${errs}.`,
      doneFiles: (n, errs) => `Готово. Скачано файлов: ${n}. Ошибок: ${errs}.`,
      retryHint: n => `Кнопка «Повтор ошибок» перегонит ${n} сбойных приложений с текущими настройками.`,
      stopping: 'Остановка по запросу — доделываю текущие приложения…',
      failPrefix: 'СБОЙ: ',
      errNoNeedle: 'Укажи подстроку для поиска.',
      searchStartScript: 'Поиск подстроки в скриптах загрузки (test)…',
      searchStartObject: 'Поиск подстроки в объектах (test): меры, измерения, переменные, мастер-объекты и объекты листов (глубокий разбор свойств). Может быть медленно.',
      searchAppErr: (name, err) => `   ${name} — ОШИБКА: ${err}`,
      searchHitScript: (d, tot, name, m) => `[${d}/${tot}] ${name} — найдено совпадений: ${m}`,
      searchHitObj: (d, tot, name, m) => `[${d}/${tot}] ${name} — объектов с совпадением: ${m}`,
      searchNoHit: (d, tot, name) => `[${d}/${tot}] ${name} — нет`,
      searchSummary: (rows, errs) => `Итог поиска: совпадений ${rows} · ошибок ${errs}.`,
      resultInWindowSearch: 'Результат в window.__qlikSearch — можно посмотреть в консоли.',
      searchNothing: 'Совпадений не найдено — файл не создан.',
      searchDone: rows => `Готово. Строк в результате: ${rows}. Файл скачан.`,
    },
    en: {
      subtitle: 'Qlik Sense · metadata export', close: 'Close',
      secMode: 'Mode', modeExport: 'Export metadata', modeSearchScript: 'Search substring in scripts', modeSearchObject: 'Search substring in objects',
      needlePh: 'Substring to search', ci: 'Case-insensitive',
      secApps: 'Applications', srcCurrent: 'Current app', srcList: 'App ID list', srcStream: 'Stream (by name)', srcAll: 'All apps on server',
      idsPh: 'app IDs separated by space, comma or newline', streamPh: 'Stream name',
      maskPh: 'App-name mask, e.g. *Finance* or Report_20??', maskHint: '* — any chars, ? — one char; empty = no filter',
      perApp: 'Separate file per app',
      secData: 'Data', toggleAllNone: 'all / none',
      dMeasures: 'Measures', dDimensions: 'Dimensions', dVariables: 'Variables', dSheets: 'Sheets (Id + thumbnail)', dBookmarks: 'Bookmarks',
      dMaster: 'Master objects (visualizations)', dGeneral: 'General (thumbnail, theme, stream)', dScript: 'Load scripts',
      perCat: 'Separate file per data type',
      secFormat: 'Format', delimPh: 'CSV delimiter', zip: 'Pack everything into one ZIP', dry: 'Dry run (summary, no download)', limitLabel: 'Apps in parallel:',
      btnRun: 'Run', btnRetry: 'Retry errors', btnRetryTitle: 'Re-run only the apps that failed', btnStop: 'Stop',
      grpH: 'hierarchy', grpN: 'single', boolYes: 'yes', boolNo: 'no',
      ready: 'Panel ready. Configure and click Run.',
      detectingProxy: 'Detecting proxy and CSRF token…', checkingEngine: 'Checking engine connection…', engineOk: 'Engine: ok',
      errEngine: m => `Engine unavailable (${m}). Looks like a wrong proxy prefix or a stale session — reload the page (F5), sign in and restart the panel.`,
      proxyDefault: '(default)', csrfOk: 'ok', csrfNo: 'not returned (continuing)',
      proxyCsrf: (p, ok) => `Proxy: "${p || '(default)'}" · CSRF: ${ok ? 'ok' : 'not returned (continuing)'}`,
      proxyCsrfStatus: (p, st) => `Proxy "${p || '(default)'}": csrftoken → ${st}`,
      proxyErr: (p, m) => `Proxy "${p || '(default)'}": ${m}`,
      noProxyConfirmed: 'No proxy confirmed the session — trying the current prefix, but failures are possible.',
      qrsStatus: (path, st) => `QRS ${path} → ${st}`,
      retryMsg: (att, total, id, err) => `   retry ${att}/${total} for ${id}: ${err}`,
      errCurrentApp: 'Current app is not detected from the URL — open an app or choose another source.',
      errEmptyIds: 'App ID list is empty.', errNoStream: 'Enter a stream name.',
      errQrsStream: 'QRS unavailable — cannot get stream contents via Repository (permissions needed).',
      errStreamNotFound: (name, list) => `Stream "${name}" not found. Available: ${list}`,
      errUnknownSrc: 'Unknown source.',
      maskMsg: (mask, n, before) => `Mask "${mask}": ${n} of ${before}`,
      qrsFallbackEngine: 'QRS unavailable — taking the list from the engine (GetDocList).',
      qrsNoEnrich: 'QRS unavailable — the "stream/published" fields will stay empty.',
      zipWarn: 'Warning: more than 65000 files — a ZIP without ZIP64 may not open; reduce the volume or turn ZIP off.',
      errNoData: 'No data type selected.',
      errDelim: d => `Delimiter "${d}" is not suitable (letters/digits/quotes will corrupt the data).`,
      retryRun: n => `Re-running failed apps: ${n}`,
      resolvingApps: 'Resolving the app list…', appsCount: n => `Apps: ${n}`, errEmptyApps: 'Empty app list.',
      confirmMany: n => `${n} apps will be processed. This may take a while. Continue?`,
      errCancelled: 'Cancelled by the user.',
      progressOk: (d, tot, name, r) => `[${d}/${tot}] ${name} (meas:${r.measures.length} dim:${r.dimensions.length} var:${r.variables.length} sheet:${r.sheets.length} bkm:${r.bookmarks.length} mo:${r.masterobjects.length} script:${r.script ? r.script.length : 0})`,
      progressErr: (d, tot, name, err) => `[${d}/${tot}] ${name} — ERROR: ${err}`,
      aborted: (d, tot) => `Aborted: processed ${d} of ${tot} — exporting what was collected.`,
      enriching: 'Enriching general info from QRS (stream, published)…',
      drySummary: (apps, me, di, va, sh, bk, mo, sc, er) => `DRY RUN (nothing downloaded): apps ${apps} · measures ${me} · dims ${di} · vars ${va} · sheets ${sh} · bookmarks ${bk} · master objects ${mo} · scripts with text ${sc} · errors ${er}`,
      withErrors: list => 'With errors: ' + list,
      resultInWindow: 'Result is in window.__qlikExport — you can inspect it in the console.',
      buildingFiles: 'Building files…',
      doneZip: (packed, errs) => `Done. Files in ZIP: ${packed}. Errors: ${errs}.`,
      doneFiles: (n, errs) => `Done. Files downloaded: ${n}. Errors: ${errs}.`,
      retryHint: n => `The "Retry errors" button will re-run ${n} failed apps with the current settings.`,
      stopping: 'Stopping on request — finishing the apps in progress…',
      failPrefix: 'FAILED: ',
      errNoNeedle: 'Enter a substring to search.',
      searchStartScript: 'Searching substring in load scripts (test)…',
      searchStartObject: 'Searching substring in objects (test): measures, dimensions, variables, master objects and sheet objects (deep property scan). May be slow.',
      searchAppErr: (name, err) => `   ${name} — ERROR: ${err}`,
      searchHitScript: (d, tot, name, m) => `[${d}/${tot}] ${name} — matches found: ${m}`,
      searchHitObj: (d, tot, name, m) => `[${d}/${tot}] ${name} — objects matched: ${m}`,
      searchNoHit: (d, tot, name) => `[${d}/${tot}] ${name} — none`,
      searchSummary: (rows, errs) => `Search summary: matches ${rows} · errors ${errs}.`,
      resultInWindowSearch: 'Result is in window.__qlikSearch — you can inspect it in the console.',
      searchNothing: 'No matches found — no file created.',
      searchDone: rows => `Done. Result rows: ${rows}. File downloaded.`,
    },
  };
  const t = (k, ...a) => { const d = I18N[LANG] || I18N.ru; let v = (k in d) ? d[k] : I18N.ru[k]; if (v == null) return k; return (typeof v === 'function') ? v(...a) : v; };

  async function authDetect() {
    for (const p of prefixCandidates()) {
      try {
        const r = await fetch(`${location.origin}${p}/qps/csrftoken?Xrfkey=${xrf}`, { headers: { 'X-Qlik-Xrfkey': xrf }, credentials: 'include' });
        if (r.ok) {
          let tok = null;
          for (const [k, v] of r.headers.entries()) if (/csrf/i.test(k)) { tok = v; break; }
          applyPrefix(p); CSRF = tok;
          log(t('proxyCsrf', p, !!tok));
          return true;
        }
        log(t('proxyCsrfStatus', p, r.status));
      } catch (e) { log(t('proxyErr', p, e.message)); }
    }
    log(t('noProxyConfirmed'));
    return false;
  }

  const wsUrl = (id, identity) => { const q = ['Xrfkey=' + xrf]; if (CSRF) q.push('qlik-csrf-token=' + encodeURIComponent(CSRF)); const idp = identity ? `/identity/${encodeURIComponent(identity)}` : ''; return `${WS}/app/${encodeURIComponent(id)}${idp}?` + q.join('&'); };

  async function qrsGet(path) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetch(`${HTTP}${path}${sep}Xrfkey=${xrf}`, { headers: { 'X-Qlik-Xrfkey': xrf }, credentials: 'include' });
    if (!r.ok) { log(t('qrsStatus', path.split('?')[0], r.status)); return null; }
    return r.json();
  }

  // ---------- WebSocket RPC ----------
  const CALL_TIMEOUT = 30000, CONNECT_TIMEOUT = 20000;
  function openWs(id) {
    return new Promise((resolve, reject) => {
      const identity = 'kmd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      let ws; try { ws = new WebSocket(wsUrl(id, identity)); } catch (e) { return reject(e); }
      const pending = new Map(); let nid = 0, closed = false, opened = false;
      const fail = err => { if (closed) return; closed = true; for (const p of pending.values()) p.reject(err); };
      const connTimer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('ws connect timeout')); }, CONNECT_TIMEOUT);
      ws.onclose = () => {
        if (!opened) { clearTimeout(connTimer); if (!closed) { closed = true; reject(new Error('ws closed до установления сессии (прокси/CSRF)')); } return; }
        fail(new Error('ws closed'));
      };
      ws.onerror = () => {};
      ws.onmessage = ev => { let r; try { r = JSON.parse(ev.data); } catch { return; } if (typeof r.id !== 'number') return;
        const p = pending.get(r.id); if (!p) return; pending.delete(r.id); r.error ? p.reject(new Error(r.error.message || 'rpc')) : p.resolve(r.result); };
      const call = (method, handle, params) => new Promise((res, rej) => {
        const i = ++nid;
        const to = setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('rpc timeout: ' + method)); } }, CALL_TIMEOUT);
        pending.set(i, { resolve: v => { clearTimeout(to); res(v); }, reject: e => { clearTimeout(to); rej(e); } });
        try { ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, handle, params })); } catch (e) { clearTimeout(to); pending.delete(i); rej(e); }
      });
      ws.onopen = () => { opened = true; clearTimeout(connTimer); resolve({ call, close: () => { try { ws.close(); } catch {} } }); };
    });
  }

  // единый список сессионных объектов приложения (используется экспортом и поиском по объектам)
  async function makeListFetcher(conn, appH) {
    return async (qType, defKey, def, lk) => {
      const c = await conn.call('CreateSessionObject', appH, [{ qInfo: { qType }, [defKey]: def }]);
      return (await conn.call('GetLayout', c.qReturn.qHandle, [])).qLayout?.[lk]?.qItems || [];
    };
  }
  const LISTDEFS = {
    measures: ['MeasureList', 'qMeasureListDef', { qType: 'measure', qData: { def: '/qMeasure/qDef', label: '/qMeasure/qLabel', labelExpr: '/qMeasure/qLabelExpression' } }, 'qMeasureList'],
    dimensions: ['DimensionList', 'qDimensionListDef', { qType: 'dimension', qData: { grouping: '/qDim/qGrouping', fields: '/qDim/qFieldDefs', labelExpr: '/qDim/qLabelExpression' } }, 'qDimensionList'],
    variables: ['VariableList', 'qVariableListDef', { qType: 'variable', qShowReserved: false, qShowConfig: false, qData: { tags: '/tags' } }, 'qVariableList'],
    masterobjects: ['MasterObjectList', 'qAppObjectListDef', { qType: 'masterobject', qData: { title: '/qMetaDef/title', description: '/qMetaDef/description', visualization: '/visualization' } }, 'qAppObjectList'],
    sheets: ['SheetList', 'qAppObjectListDef', { qType: 'sheet', qData: { title: '/qMetaDef/title' } }, 'qAppObjectList'],
  };

  async function collectApp(appId, sel) {
    const res = { appId, appName: null, thumbnail: '', theme: '', stream: '', published: null, lastReload: null,
      variables: [], dimensions: [], measures: [], sheets: [], bookmarks: [], masterobjects: [], script: '', error: null };
    let conn;
    try {
      conn = await openWs(appId);
      const appH = (await conn.call('OpenDoc', -1, [appId, '', '', '', true])).qReturn.qHandle;
      const props = await conn.call('GetAppProperties', appH, []);
      res.appName = props.qProp?.qTitle ?? null;
      res.thumbnail = abs(props.qProp?.qThumbnail?.qUrl);
      const fetchList = await makeListFetcher(conn, appH);
      if (sel.general) {
        try { res.lastReload = (await conn.call('GetAppLayout', appH, [])).qLayout?.qLastReloadTime ?? null; } catch {}
        try { const ap = await fetchList('AppPropsList', 'qAppObjectListDef', { qType: 'appprops', qData: { theme: '/theme' } }, 'qAppObjectList');
          res.theme = (ap[0]?.qData?.theme) || ''; } catch {}
      }
      if (sel.variables) res.variables = (await fetchList(...LISTDEFS.variables))
        .map(v => ({ name: v.qName, definition: v.qDefinition, description: v.qDescription, scriptCreated: !!v.qIsScriptCreated }));
      if (sel.dimensions) res.dimensions = (await fetchList(...LISTDEFS.dimensions))
        .map(d => ({ id: d.qInfo.qId, title: d.qMeta?.title, fields: d.qData?.fields || [], labelExpr: d.qData?.labelExpr, type: grp(d.qData?.grouping), description: d.qMeta?.description, tags: d.qMeta?.tags || [] }));
      if (sel.measures) res.measures = (await fetchList(...LISTDEFS.measures))
        .map(me => ({ id: me.qInfo.qId, title: me.qMeta?.title, definition: me.qData?.def, label: me.qData?.label, labelExpr: me.qData?.labelExpr, description: me.qMeta?.description, tags: me.qMeta?.tags || [] }));
      if (sel.sheets) res.sheets = (await fetchList('SheetList', 'qAppObjectListDef', { qType: 'sheet', qData: { title: '/qMetaDef/title', thumbnail: '/thumbnail' } }, 'qAppObjectList'))
        .map(s => { const th = s.qData?.thumbnail; return { sheetId: s.qInfo.qId, sheetName: s.qMeta?.title, thumbnail: abs(th && (th.qStaticContentUrl?.qUrl || th.qStaticContentUrlDef?.qUrl)) }; });
      if (sel.bookmarks) res.bookmarks = (await fetchList('BookmarkList', 'qBookmarkListDef', { qType: 'bookmark', qData: { title: '/qMetaDef/title', description: '/qMetaDef/description', sheetId: '/sheetId', selectionFields: '/selectionFields', creationDate: '/creationDate' } }, 'qBookmarkList'))
        .map(b => ({ id: b.qInfo.qId, title: b.qMeta?.title || b.qData?.title, description: b.qMeta?.description || b.qData?.description, sheetId: b.qData?.sheetId || '', fields: b.qData?.selectionFields || '', created: b.qData?.creationDate || '' }));
      if (sel.masterobjects) res.masterobjects = (await fetchList('MasterObjectList', 'qAppObjectListDef', { qType: 'masterobject', qData: { title: '/qMetaDef/title', description: '/qMetaDef/description', visualization: '/visualization', tags: '/qMetaDef/tags' } }, 'qAppObjectList'))
        .map(o => ({ id: o.qInfo.qId, title: o.qMeta?.title || o.qData?.title, visualization: o.qData?.visualization || '', description: o.qMeta?.description || o.qData?.description, tags: o.qMeta?.tags || [] }));
      if (sel.script) { try { res.script = (await conn.call('GetScript', appH, {})).qScript || ''; } catch (e) { if (!res.error) res.error = 'script: ' + e.message; } }
    } catch (e) { res.error = e.message || String(e); }
    finally { conn?.close(); }
    return res;
  }

  const RETRIES = 2;
  async function collectWithRetry(appId, sel) {
    let last = null;
    for (let att = 1; att <= RETRIES; att++) {
      const r = await collectApp(appId, sel);
      if (!r.error || !/ws closed|ws connect|timeout/i.test(r.error)) return r;
      last = r;
      if (att < RETRIES && !ABORT) { log(t('retryMsg', att, RETRIES - 1, appId, r.error)); await sleep(900); }
    }
    return last;
  }

  // ---------- сканеры для режимов поиска (test) ----------
  async function scanScript(appId, needle, ci) {
    let conn;
    try {
      conn = await openWs(appId);
      const appH = (await conn.call('OpenDoc', -1, [appId, '', '', '', true])).qReturn.qHandle;
      const script = (await conn.call('GetScript', appH, {})).qScript || '';
      const nd = ci ? needle.toLowerCase() : needle;
      let matches = 0, sample = '';
      for (const ln of splitLines(script)) {
        const hay = ci ? ln.toLowerCase() : ln;
        if (hay.indexOf(nd) !== -1) { matches++; if (!sample) sample = ln.trim().slice(0, 200); }
      }
      return { matches, sample };
    } catch (e) { return { error: e.message || String(e), matches: 0, sample: '' }; }
    finally { conn?.close(); }
  }

  async function scanObjects(appId, needle, ci) {
    const out = []; let conn;
    const nd = ci ? needle.toLowerCase() : needle;
    const hit = s => (ci ? String(s || '').toLowerCase() : String(s || '')).indexOf(nd) !== -1;
    const any = (...vals) => vals.some(v => Array.isArray(v) ? v.some(hit) : hit(v));
    try {
      conn = await openWs(appId);
      const appH = (await conn.call('OpenDoc', -1, [appId, '', '', '', true])).qReturn.qHandle;
      const fetchList = await makeListFetcher(conn, appH);
      const propsOf = async id => { try { const h = (await conn.call('GetObject', appH, [id])).qReturn?.qHandle; if (!h) return null; const p = await conn.call('GetProperties', h, []); return p.qProp || p; } catch { return null; } };

      // меры
      for (const m of await fetchList(...LISTDEFS.measures)) {
        if (ABORT) break;
        if (any(m.qMeta?.title, m.qData?.def, m.qData?.label, m.qData?.labelExpr, m.qMeta?.description))
          out.push({ objectType: 'measure', objectId: m.qInfo.qId, title: m.qMeta?.title || '' });
      }
      // измерения
      for (const d of await fetchList(...LISTDEFS.dimensions)) {
        if (ABORT) break;
        if (any(d.qMeta?.title, d.qData?.fields, d.qData?.labelExpr, d.qMeta?.description))
          out.push({ objectType: 'dimension', objectId: d.qInfo.qId, title: d.qMeta?.title || '' });
      }
      // переменные
      for (const v of await fetchList(...LISTDEFS.variables)) {
        if (ABORT) break;
        if (any(v.qName, v.qDefinition, v.qDescription))
          out.push({ objectType: 'variable', objectId: v.qInfo?.qId || v.qName, title: v.qName || '' });
      }
      // мастер-объекты (глубокий разбор свойств — ловит выражения внутри)
      for (const o of await fetchList(...LISTDEFS.masterobjects)) {
        if (ABORT) break;
        let matched = any(o.qMeta?.title, o.qData?.title, o.qData?.description, o.qData?.visualization);
        if (!matched) { const p = await propsOf(o.qInfo.qId); if (p && containsIn(p, nd, ci)) matched = true; }
        if (matched) out.push({ objectType: 'masterobject', objectId: o.qInfo.qId, title: o.qMeta?.title || o.qData?.title || '', visualization: o.qData?.visualization || '' });
      }
      // объекты листов (глубокий разбор свойств — где живёт большинство выражений)
      for (const s of await fetchList(...LISTDEFS.sheets)) {
        if (ABORT) break;
        try {
          const sh = (await conn.call('GetObject', appH, [s.qInfo.qId])).qReturn?.qHandle; if (!sh) continue;
          const kid = await conn.call('GetChildInfos', sh, []);
          const infos = kid?.qInfos || (Array.isArray(kid) ? kid : []);
          for (const inf of infos) {
            if (ABORT) break;
            const cid = inf?.qId; if (!cid) continue;
            const p = await propsOf(cid);
            if (p && containsIn(p, nd, ci))
              out.push({ objectType: (p.qInfo?.qType || inf.qType || 'sheet-object'), objectId: cid, title: (p.qMetaDef?.title || p.title || ''), sheetId: s.qInfo.qId });
          }
        } catch {}
      }
    } catch (e) { return { error: e.message || String(e), matches: out }; }
    finally { conn?.close(); }
    return { matches: out };
  }

  // ---------- источник приложений ----------
  async function docListEngine() { const c = await openWs('engineData'); try { return ((await c.call('GetDocList', -1, [])).qDocList || []).map(d => ({ id: d.qDocId, name: d.qTitle || d.qDocName })); } finally { c.close(); } }
  async function resolveApps(cfg) {
    let apps;
    if (cfg.source === 'current') {
      const mm = location.href.match(/\/app\/([^/?#]+)/);
      if (!mm) throw new Error(t('errCurrentApp'));
      apps = [{ id: decodeURIComponent(mm[1]) }];
    } else if (cfg.source === 'list') {
      const ids = [...new Set(cfg.idsText.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))];
      if (!ids.length) throw new Error(t('errEmptyIds'));
      apps = ids.map(id => ({ id }));
    } else if (cfg.source === 'stream') {
      if (!cfg.streamName) throw new Error(t('errNoStream'));
      let arr = await qrsGet(`/qrs/app/full?filter=${encodeURIComponent(`stream.name eq '${cfg.streamName}'`)}`);
      if (!arr) throw new Error(t('errQrsStream'));
      if (!arr.length) { const all = await qrsGet('/qrs/app/full') || []; arr = all.filter(a => a.stream && a.stream.name?.toLowerCase() === cfg.streamName.toLowerCase());
        if (!arr.length) throw new Error(t('errStreamNotFound', cfg.streamName, [...new Set(all.filter(a => a.stream).map(a => a.stream.name))].sort().join(', '))); }
      apps = arr.map(a => ({ id: a.id, name: a.name }));
    } else if (cfg.source === 'all') {
      let all = await qrsGet('/qrs/app/full');
      if (!all) { log(t('qrsFallbackEngine')); apps = await docListEngine(); }
      else apps = all.map(a => ({ id: a.id, name: a.name }));
    } else throw new Error(t('errUnknownSrc'));

    if (cfg.mask && (cfg.source === 'stream' || cfg.source === 'all')) {
      const re = maskToRe(cfg.mask);
      const before = apps.length;
      apps = apps.filter(a => re.test(a.name || ''));
      log(t('maskMsg', cfg.mask, apps.length, before));
    }
    return apps;
  }

  async function qrsAppMap() {
    const all = await qrsGet('/qrs/app/full');
    const m = new Map();
    if (all) for (const a of all) m.set(a.id, { stream: a.stream?.name || '', name: a.name });
    return m;
  }

  async function enrichFromQrs(results) {
    const all = await qrsGet('/qrs/app/full');
    if (!all) { log(t('qrsNoEnrich')); return; }
    const map = new Map(all.map(a => [a.id, a]));
    for (const r of results) {
      const q = map.get(r.appId); if (!q) continue;
      r.stream = q.stream?.name || '';
      r.published = !!q.published;
      if (!r.appName && q.name) r.appName = q.name;
    }
  }

  // ---------- сериализация ----------
  const SCHEMA = {
    general:       ['appId', 'appName', 'thumbnail', 'theme', 'stream', 'published', 'lastReload'],
    variables:     ['appId', 'appName', 'name', 'definition', 'description', 'scriptCreated'],
    dimensions:    ['appId', 'appName', 'id', 'title', 'fields', 'labelExpr', 'type', 'description', 'tags'],
    measures:      ['appId', 'appName', 'id', 'title', 'definition', 'label', 'labelExpr', 'description', 'tags'],
    sheets:        ['appId', 'appName', 'sheetId', 'sheetName', 'thumbnail'],
    bookmarks:     ['appId', 'appName', 'id', 'title', 'description', 'sheetId', 'fields', 'created'],
    masterobjects: ['appId', 'appName', 'id', 'title', 'visualization', 'description', 'tags'],
    script:        ['appId', 'appName', 'line'],
  };
  const DATA_CATS = ['variables', 'dimensions', 'measures', 'sheets', 'bookmarks', 'masterobjects'];   // вложенные списки приложения
  const CATLABEL = { general: 'general', variables: 'variables', dimensions: 'dimensions', measures: 'measures', sheets: 'sheets', bookmarks: 'bookmarks', masterobjects: 'masterobjects', script: 'scripts' };
  const ITEMNAME = { variables: 'variable', dimensions: 'dimension', measures: 'measure', sheets: 'sheet', bookmarks: 'bookmark', masterobjects: 'masterObject', script: 'scriptLine' };
  const flat = v => Array.isArray(v) ? v.join(', ') : (typeof v === 'boolean' ? (v ? t('boolYes') : t('boolNo')) : (v == null ? '' : v));

  function rowsFor(cat, apps) {
    const rows = [];
    for (const a of apps) {
      if (cat === 'general') rows.push({ appId: a.appId, appName: a.appName, thumbnail: a.thumbnail, theme: a.theme, stream: a.stream, published: a.published, lastReload: a.lastReload });
      else if (cat === 'script') { for (const ln of splitLines(a.script)) rows.push({ appId: a.appId, appName: a.appName, line: ln }); }
      else for (const it of a[cat]) rows.push({ appId: a.appId, appName: a.appName, ...it });
    }
    return rows;
  }
  function toCSV(cols, rows, delim, bom = true) {
    const esc = v => { v = String(flat(v)); return (v.includes(delim) || v.includes('"') || /[\r\n]/.test(v)) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return (bom ? '\uFEFF' : '') + [cols.join(delim), ...rows.map(r => cols.map(c => esc(r[c])).join(delim))].join('\r\n');
  }
  const xe = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cdata = s => '<![CDATA[' + String(s || '').replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
  const XMLHEAD = '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n';

  function appToObj(a, sel) {
    const o = { appId: a.appId, appName: a.appName };
    if (sel.general) { o.thumbnail = a.thumbnail; o.theme = a.theme; o.stream = a.stream; o.published = a.published; o.lastReload = a.lastReload; }
    for (const c of DATA_CATS) if (sel[c]) o[c] = a[c];
    if (sel.script) o.scriptLines = splitLines(a.script);
    if (a.error) o.error = a.error;
    return o;
  }
  function appToXml(a, sel) {
    let s = `  <app id="${xe(a.appId)}" name="${xe(a.appName)}">\n`;
    if (sel.general) s += `    <thumbnail>${xe(a.thumbnail)}</thumbnail>\n    <theme>${xe(a.theme)}</theme>\n    <stream>${xe(a.stream)}</stream>\n    <published>${xe(flat(a.published))}</published>\n    <lastReload>${xe(a.lastReload)}</lastReload>\n`;
    for (const c of DATA_CATS) {
      if (!sel[c]) continue; const items = a[c];
      if (!items.length) { s += `    <${c}/>\n`; continue; }
      s += `    <${c}>\n`;
      for (const it of items) { s += `      <${ITEMNAME[c]}>\n`; for (const [k, v] of Object.entries(it)) s += `        <${k}>${xe(flat(v))}</${k}>\n`; s += `      </${ITEMNAME[c]}>\n`; }
      s += `    </${c}>\n`;
    }
    if (sel.script) s += `    <script>${cdata(a.script)}</script>\n`;
    if (a.error) s += `    <error>${xe(a.error)}</error>\n`;
    return s + '  </app>\n';
  }
  function rowsToXml(cat, rows) {
    let s = `<${CATLABEL[cat]}>\n`;
    for (const r of rows) { s += `  <${ITEMNAME[cat] || 'row'}>\n`; for (const [k, v] of Object.entries(r)) s += `    <${k}>${xe(flat(v))}</${k}>\n`; s += `  </${ITEMNAME[cat] || 'row'}>\n`; }
    return s + `</${CATLABEL[cat]}>\n`;
  }
  // сериализация результата поиска (единый плоский список строк)
  function searchToFile(kind, cols, rows, fmt, delim) {
    if (fmt === 'json') return { ext: 'json', mime: 'application/json', body: JSON.stringify({ generatedAt: new Date().toISOString(), kind, rows }, null, 2) };
    if (fmt === 'xml') {
      const item = kind === 'script' ? 'app' : 'match';
      let s = XMLHEAD + `<search kind="${xe(kind)}" generatedAt="${xe(new Date().toISOString())}">\n`;
      for (const r of rows) { s += `  <${item}>\n`; for (const c of cols) s += `    <${c}>${xe(flat(r[c]))}</${c}>\n`; s += `  </${item}>\n`; }
      return { ext: 'xml', mime: 'application/xml', body: s + `</search>\n` };
    }
    return { ext: 'csv', mime: 'text/csv', body: toCSV(cols, rows, delim) };
  }

  // ---------- ZIP (store, без библиотек) ----------
  const CRC_TABLE = (() => { const t2 = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t2[n] = c >>> 0; } return t2; })();
  const crc32 = data => { let c = 0xFFFFFFFF; for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = (((now.getFullYear() - 1980) & 0x7F) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = []; let offset = 0, count = 0;
    for (const f of files) {
      const nameB = enc.encode(f.name), data = f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameB.length, true);
      parts.push(new Uint8Array(lh.buffer), nameB, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
      cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameB.length, true); cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameB);
      offset += 30 + nameB.length + data.length; count++;
    }
    const cdSize = central.reduce((s, a) => s + a.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, count, true); eocd.setUint16(10, count, true);
    eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
  }

  // ---------- эмиттер файлов: напрямую или в ZIP, с уникальными именами ----------
  function makeEmitter(zipMode) {
    const used = new Set(); const entries = []; const enc = new TextEncoder();
    const uniq = n => { let f = n, i = 2; while (used.has(f)) f = n.replace(/(\.[a-z0-9]+)$/i, `_${i++}$1`); used.add(f); return f; };
    const dlBlob = (name, blob) => { const u = URL.createObjectURL(blob); const a = Object.assign(document.createElement('a'), { href: u, download: name }); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); };
    return {
      async emit(name, content, mime) {
        name = uniq(name);
        if (zipMode) entries.push({ name, data: enc.encode(content) });
        else { dlBlob(name, new Blob([content], { type: mime + ';charset=utf-8;' })); await sleep(280); }
      },
      finish(stamp) {
        if (!zipMode || !entries.length) return 0;
        if (entries.length > 65000) log(t('zipWarn'));
        dlBlob(`kerbatov_export_${stamp}.zip`, makeZip(entries));
        return entries.length;
      },
    };
  }

  // ---------- экспорт: perApp × perCat ----------
  async function exportAll(apps, sel, fmt, delim, perApp, perCat, em, stamp) {
    const cats = ['general', ...DATA_CATS, 'script'].filter(c => sel[c]);
    if (!cats.length) return 0;
    let files = 0;
    const groups = perApp ? apps.map(a => ({ tag: safe(a.appName || a.appId), apps: [a] })) : [{ tag: null, apps }];

    for (const g of groups) {
      const base = g.tag ? g.tag : `qlik_${stamp}`;
      if (perCat) {
        for (const cat of cats) {
          if (cat === 'script' && perApp) { await em.emit(`${base}.qvs`, '\uFEFF' + (g.apps[0].script || ''), 'text/plain'); files++; continue; }
          const fname = g.tag ? `${g.tag}_${CATLABEL[cat]}` : `qlik_${CATLABEL[cat]}_${stamp}`;
          if (fmt === 'csv') await em.emit(`${fname}.csv`, toCSV(SCHEMA[cat], rowsFor(cat, g.apps), delim), 'text/csv');
          else if (fmt === 'json') {
            const payload = cat === 'script'
              ? { generatedAt: new Date().toISOString(), scripts: g.apps.map(a => ({ appId: a.appId, appName: a.appName, scriptLines: splitLines(a.script) })) }
              : { generatedAt: new Date().toISOString(), category: cat, rows: rowsFor(cat, g.apps) };
            await em.emit(`${fname}.json`, JSON.stringify(payload, null, 2), 'application/json');
          } else {
            const body = cat === 'script'
              ? `<scripts>\n` + g.apps.map(a => `  <app id="${xe(a.appId)}" name="${xe(a.appName)}"><script>${cdata(a.script)}</script></app>\n`).join('') + `</scripts>\n`
              : rowsToXml(cat, rowsFor(cat, g.apps));
            await em.emit(`${fname}.xml`, XMLHEAD + body, 'application/xml');
          }
          files++;
        }
      } else {
        const fname = g.tag ? g.tag : `qlik_meta_${stamp}`;
        if (fmt === 'json') { await em.emit(`${fname}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), apps: g.apps.map(a => appToObj(a, sel)) }, null, 2), 'application/json'); files++; }
        else if (fmt === 'xml') { await em.emit(`${fname}.xml`, XMLHEAD + `<export generatedAt="${xe(new Date().toISOString())}">\n` + g.apps.map(a => appToXml(a, sel)).join('') + '</export>\n', 'application/xml'); files++; }
        else {
          const parts = [];
          for (const cat of cats) parts.push(`#=== ${CATLABEL[cat]} ===`, toCSV(SCHEMA[cat], rowsFor(cat, g.apps), delim, false));
          await em.emit(`${fname}.csv`, '\uFEFF' + parts.join('\r\n'), 'text/csv'); files++;
        }
      }
    }
    return files;
  }

  // ---------- UI ----------
  const css = `
  #qme-panel{position:fixed;top:20px;right:20px;width:384px;max-height:92vh;overflow:auto;z-index:2147483647;background:#fbfbfd;color:#1d2330;border:1px solid #d7dbe3;border-radius:12px;box-shadow:0 14px 44px rgba(20,28,45,.26);font:13.5px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  #qme-panel *{box-sizing:border-box}
  #qme-panel::-webkit-scrollbar{width:10px}
  #qme-panel::-webkit-scrollbar-thumb{background:#cdd2dc;border-radius:6px;border:2px solid #fbfbfd}
  #qme-head{cursor:move;padding:14px 16px;background:linear-gradient(135deg,#2b3550,#3d2f63);color:#fff;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
  .qme-title{font-weight:700;font-size:15.5px;letter-spacing:.2px}
  .qme-sub{font-size:11.5px;opacity:.72;margin-top:2px}
  .qme-headright{display:flex;gap:8px;align-items:center;flex:none}
  .qme-lang{display:flex;gap:2px;align-items:center;background:rgba(255,255,255,.14);border-radius:7px;padding:2px}
  .qme-lang-b{font-size:11px;font-weight:700;color:#fff;opacity:.6;cursor:pointer;padding:2px 6px;border-radius:5px;user-select:none}
  .qme-lang-b.on{background:rgba(255,255,255,.30);opacity:1}
  #qme-head button{background:rgba(255,255,255,.14);border:0;color:#fff;width:26px;height:26px;border-radius:7px;font-size:17px;cursor:pointer;line-height:1;flex:none;transition:background .15s}
  #qme-head button:hover{background:rgba(255,255,255,.3)}
  .qme-body{padding:16px}
  .qme-sec{background:#fff;border:1px solid #e6e9f0;border-radius:10px;padding:11px 13px;margin-bottom:12px}
  .qme-sec>.t{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;color:#6a7390}
  .qme-toggle{font-weight:600;font-size:10.5px;text-transform:none;letter-spacing:0;color:#7a68c4;cursor:pointer;user-select:none}
  .qme-toggle:hover{text-decoration:underline}
  .qme-row{display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer}
  .qme-row label{cursor:pointer;user-select:none}
  .qme-row input[type=radio],.qme-row input[type=checkbox]{margin:0;width:15px;height:15px;accent-color:#5b4b9e;cursor:pointer;flex:none}
  .qme-badge{display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#8a5a00;background:#ffe6b3;border:1px solid #f0c869;border-radius:5px;padding:0 5px;margin-left:4px;vertical-align:middle}
  .qme-opt{margin-top:9px;padding-top:9px;border-top:1px dashed #e2e5ee}
  .qme-opt .qme-row label{font-size:12.5px;color:#4b5470}
  .qme-search-box{margin-top:9px;padding-top:9px;border-top:1px dashed #e2e5ee}
  .qme-inline{display:flex;align-items:center;gap:8px;margin-top:6px}
  .qme-inline label{font-size:12.5px;color:#4b5470}
  #qme-panel input[type=text],#qme-panel textarea{width:100%;padding:8px 9px;border:1px solid #d2d7e1;border-radius:7px;font:inherit;margin-top:8px;background:#fff;color:#1d2330;transition:border-color .15s,box-shadow .15s}
  #qme-panel input[type=text].qme-small{width:56px;margin-top:0;text-align:center;padding:5px 6px}
  #qme-panel input[type=text]:focus,#qme-panel textarea:focus{outline:0;border-color:#7a68c4;box-shadow:0 0 0 3px rgba(122,104,196,.16)}
  #qme-panel textarea{min-height:64px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12px}
  .qme-hint{font-size:11px;color:#8a91a8;margin-top:4px}
  .qme-btns{display:flex;gap:8px}
  #qme-run{flex:1;padding:11px;background:linear-gradient(135deg,#2f8a3e,#1f6e34);color:#fff;border:0;border-radius:9px;font-weight:700;font-size:14.5px;letter-spacing:.3px;cursor:pointer;box-shadow:0 4px 12px rgba(31,110,52,.28);transition:filter .15s,transform .05s}
  #qme-run:hover{filter:brightness(1.07)}
  #qme-run:active{transform:translateY(1px)}
  #qme-run:disabled{background:#9db8a3;box-shadow:none;cursor:default;filter:none}
  #qme-retry{width:auto;padding:11px 12px;background:#fff;color:#5b4b9e;border:1px solid #cfc6ec;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;transition:background .15s}
  #qme-retry:hover:not(:disabled){background:#f3f0fb}
  #qme-retry:disabled{color:#c6cbd8;border-color:#e4e7ee;cursor:default}
  #qme-stop{width:74px;padding:11px;background:#fff;color:#b03636;border:1px solid #e0b9b9;border-radius:9px;font-weight:700;font-size:13.5px;cursor:pointer;transition:background .15s}
  #qme-stop:hover:not(:disabled){background:#fbeeee}
  #qme-stop:disabled{color:#c6cbd8;border-color:#e4e7ee;cursor:default}
  #qme-prog{margin-top:12px;height:7px;background:#e8eaf1;border-radius:4px;overflow:hidden;display:none}
  #qme-prog>div{height:100%;width:0;background:linear-gradient(90deg,#5b4b9e,#7a68c4);border-radius:4px;transition:width .25s}
  #qme-log{margin-top:12px;background:#171c28;border-radius:8px;padding:9px 10px;font:11.5px/1.4 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:170px;overflow:auto;color:#c9d2e3}
  #qme-log:empty{display:none}
  .qme-hide{display:none}`;
  const style = document.createElement('style'); style.id = 'qme-style'; style.textContent = css; document.head.appendChild(style);

  const panel = document.createElement('div'); panel.id = 'qme-panel';
  panel.innerHTML = `
    <div id="qme-head">
      <div><div class="qme-title">Kerbatov metadata downloader</div><div class="qme-sub" data-i18n="subtitle">Qlik Sense · экспорт метаданных</div></div>
      <div class="qme-headright">
        <div class="qme-lang"><span class="qme-lang-b" data-lang="ru">RU</span><span class="qme-lang-b" data-lang="en">EN</span></div>
        <button title="Закрыть" data-i18n-title="close">×</button>
      </div>
    </div>
    <div class="qme-body">
      <div class="qme-sec">
        <div class="t"><span data-i18n="secMode">Режим</span></div>
        <div class="qme-row"><input type="radio" name="qme-mode" id="qme-mode-export" value="export" checked><label for="qme-mode-export" data-i18n="modeExport">Экспорт метаданных</label></div>
        <div class="qme-row"><input type="radio" name="qme-mode" id="qme-mode-sscript" value="search-script"><label for="qme-mode-sscript"><span data-i18n="modeSearchScript">Поиск подстроки в скриптах</span><span class="qme-badge">test</span></label></div>
        <div class="qme-row"><input type="radio" name="qme-mode" id="qme-mode-sobject" value="search-object"><label for="qme-mode-sobject"><span data-i18n="modeSearchObject">Поиск подстроки в объектах</span><span class="qme-badge">test</span></label></div>
        <div class="qme-search-box qme-hide" id="qme-search-box">
          <input type="text" id="qme-needle" placeholder="Подстрока для поиска" data-i18n-ph="needlePh">
          <div class="qme-row" style="margin-top:6px"><input type="checkbox" id="qme-ci" checked><label for="qme-ci" data-i18n="ci">Без учёта регистра</label></div>
        </div>
      </div>
      <div class="qme-sec">
        <div class="t"><span data-i18n="secApps">Приложения</span></div>
        <div class="qme-row"><input type="radio" name="qme-src" id="qme-src-cur" value="current" checked><label for="qme-src-cur" data-i18n="srcCurrent">Текущее приложение</label></div>
        <div class="qme-row"><input type="radio" name="qme-src" id="qme-src-list" value="list"><label for="qme-src-list" data-i18n="srcList">Список appId</label></div>
        <div class="qme-row"><input type="radio" name="qme-src" id="qme-src-stream" value="stream"><label for="qme-src-stream" data-i18n="srcStream">Поток (по имени)</label></div>
        <div class="qme-row"><input type="radio" name="qme-src" id="qme-src-all" value="all"><label for="qme-src-all" data-i18n="srcAll">Все приложения на сервере</label></div>
        <textarea id="qme-ids" class="qme-hide" placeholder="appId через пробел, запятую или с новой строки" data-i18n-ph="idsPh"></textarea>
        <input type="text" id="qme-stream" class="qme-hide" value="Т_Перенос" placeholder="Имя потока" data-i18n-ph="streamPh">
        <input type="text" id="qme-mask" class="qme-hide" placeholder="Маска имени приложения, напр. *Финанс* или Отчет_20??" data-i18n-ph="maskPh">
        <div class="qme-hint qme-hide" id="qme-mask-hint" data-i18n="maskHint">* — любые символы, ? — один символ; пусто = без фильтра</div>
        <div class="qme-opt">
          <div class="qme-row" id="qme-row-perapp"><input type="checkbox" id="qme-per-app"><label for="qme-per-app" data-i18n="perApp">Отдельный файл на каждое приложение</label></div>
        </div>
      </div>
      <div class="qme-sec" id="qme-sec-data">
        <div class="t"><span data-i18n="secData">Данные</span><span class="qme-toggle" id="qme-datatoggle" data-i18n="toggleAllNone">все / нет</span></div>
        <div class="qme-row"><input type="checkbox" id="qme-d-measures" checked><label for="qme-d-measures" data-i18n="dMeasures">Меры</label></div>
        <div class="qme-row"><input type="checkbox" id="qme-d-dimensions" checked><label for="qme-d-dimensions" data-i18n="dDimensions">Измерения</label></div>
        <div class="qme-row"><input type="checkbox" id="qme-d-variables" checked><label for="qme-d-variables" data-i18n="dVariables">Переменные</label></div>
        <div class="qme-row"><input type="checkbox" id="qme-d-sheets"><label for="qme-d-sheets" data-i18n="dSheets">Листы (Id + thumbnail)</label></div>
        <div class="qme-row"><input type="checkbox" id="qme-d-bookmarks"><label for="qme-d-bookmarks" data-i18n="dBookmarks">Закладки</label></div>
        <div class="qme-row"><input type="checkbox" id="qme-d-masterobjects"><label for="qme-d-masterobjects" data-i18n="dMaster">Мастер-объекты (визуализации)</label></div>
        <div class="qme-row"><input type="checkbox" id="qme-d-general"><label for="qme-d-general" data-i18n="dGeneral">Общая инфа (thumbnail, тема, поток)</label></div>
        <div class="qme-row"><input type="checkbox" id="qme-d-script"><label for="qme-d-script" data-i18n="dScript">Скрипты загрузки</label></div>
        <div class="qme-opt">
          <div class="qme-row"><input type="checkbox" id="qme-per-cat" checked><label for="qme-per-cat" data-i18n="perCat">Отдельный файл для каждого вида данных</label></div>
        </div>
      </div>
      <div class="qme-sec">
        <div class="t"><span data-i18n="secFormat">Формат</span></div>
        <div class="qme-row"><input type="radio" name="qme-fmt" id="qme-fmt-csv" value="csv" checked><label for="qme-fmt-csv">CSV</label></div>
        <div class="qme-row"><input type="radio" name="qme-fmt" id="qme-fmt-json" value="json"><label for="qme-fmt-json">JSON</label></div>
        <div class="qme-row"><input type="radio" name="qme-fmt" id="qme-fmt-xml" value="xml"><label for="qme-fmt-xml">XML</label></div>
        <input type="text" id="qme-delim" value="|" placeholder="Разделитель CSV" maxlength="3" data-i18n-ph="delimPh">
        <div class="qme-opt">
          <div class="qme-row" id="qme-row-zip"><input type="checkbox" id="qme-zip"><label for="qme-zip" data-i18n="zip">Упаковать всё в один ZIP</label></div>
          <div class="qme-row"><input type="checkbox" id="qme-dry"><label for="qme-dry" data-i18n="dry">Только проверка (сводка без скачивания)</label></div>
          <div class="qme-inline"><label for="qme-limit" data-i18n="limitLabel">Параллельно приложений:</label><input type="text" class="qme-small" id="qme-limit" value="3" maxlength="1"></div>
        </div>
      </div>
      <div class="qme-btns">
        <button id="qme-run" data-i18n="btnRun">Запуск</button>
        <button id="qme-retry" disabled title="Повторный прогон только приложений с ошибками" data-i18n="btnRetry" data-i18n-title="btnRetryTitle">Повтор ошибок</button>
        <button id="qme-stop" disabled data-i18n="btnStop">Стоп</button>
      </div>
      <div id="qme-prog"><div></div></div>
      <div id="qme-log"></div>
    </div>`;
  document.body.appendChild(panel);

  const $ = s => panel.querySelector(s);
  const logEl = $('#qme-log'), progEl = $('#qme-prog'), progBar = $('#qme-prog>div');
  function log(msg) { const tm = new Date().toLocaleTimeString(); logEl.textContent += `[${tm}] ${msg}\n`; logEl.scrollTop = logEl.scrollHeight; console.log('[qme]', msg); }
  function setProgress(done, total) { if (total <= 0) { progEl.style.display = 'none'; return; } progEl.style.display = 'block'; progBar.style.width = Math.round(done / total * 100) + '%'; }

  // применение перевода по data-атрибутам
  function applyI18n() {
    const d = I18N[LANG] || I18N.ru;
    panel.querySelectorAll('[data-i18n]').forEach(el => { const k = el.getAttribute('data-i18n'); if (typeof d[k] === 'string') el.textContent = d[k]; });
    panel.querySelectorAll('[data-i18n-ph]').forEach(el => { const k = el.getAttribute('data-i18n-ph'); if (typeof d[k] === 'string') el.setAttribute('placeholder', d[k]); });
    panel.querySelectorAll('[data-i18n-title]').forEach(el => { const k = el.getAttribute('data-i18n-title'); if (typeof d[k] === 'string') el.setAttribute('title', d[k]); });
  }
  function updateLangUI() { panel.querySelectorAll('.qme-lang-b').forEach(b => b.classList.toggle('on', b.getAttribute('data-lang') === LANG)); }

  // ---------- автосохранение настроек ----------
  const FIELDS = {
    radios: ['qme-src', 'qme-fmt', 'qme-mode'],
    checks: ['qme-per-app', 'qme-per-cat', 'qme-zip', 'qme-dry', 'qme-ci', 'qme-d-measures', 'qme-d-dimensions', 'qme-d-variables', 'qme-d-sheets', 'qme-d-bookmarks', 'qme-d-masterobjects', 'qme-d-general', 'qme-d-script'],
    texts: ['qme-ids', 'qme-stream', 'qme-mask', 'qme-delim', 'qme-limit', 'qme-needle'],
  };
  function saveSettings() {
    try {
      const s = { r: {}, c: {}, t: {}, lang: LANG };
      for (const n of FIELDS.radios) s.r[n] = panel.querySelector(`input[name=${n}]:checked`)?.value;
      for (const id of FIELDS.checks) s.c[id] = $('#' + id).checked;
      for (const id of FIELDS.texts) s.t[id] = $('#' + id).value;
      localStorage.setItem(SKEY, JSON.stringify(s));
    } catch {}
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SKEY) || 'null'); if (!s) return;
      if (s.lang) LANG = s.lang;
      for (const n of FIELDS.radios) { const el = panel.querySelector(`input[name=${n}][value="${s.r?.[n]}"]`); if (el) el.checked = true; }
      for (const id of FIELDS.checks) if (id in (s.c || {})) $('#' + id).checked = !!s.c[id];
      for (const id of FIELDS.texts) if (id in (s.t || {})) $('#' + id).value = s.t[id];
    } catch {}
  }
  loadSettings();
  applyI18n(); updateLangUI();
  panel.querySelectorAll('input,textarea').forEach(el => el.addEventListener('change', saveSettings));

  // переключатель языка
  panel.querySelectorAll('.qme-lang-b').forEach(b => b.onclick = () => { LANG = b.getAttribute('data-lang'); applyI18n(); updateLangUI(); saveSettings(); });

  // переключатель «все / нет» для типов данных
  const DATA_CHECK_IDS = ['qme-d-measures', 'qme-d-dimensions', 'qme-d-variables', 'qme-d-sheets', 'qme-d-bookmarks', 'qme-d-masterobjects', 'qme-d-general', 'qme-d-script'];
  $('#qme-datatoggle').onclick = () => {
    const anyOff = DATA_CHECK_IDS.some(id => !$('#' + id).checked);
    DATA_CHECK_IDS.forEach(id => { $('#' + id).checked = anyOff; });
    saveSettings();
  };

  // показ/скрытие зависимых полей
  const sync = () => {
    const mode = panel.querySelector('input[name=qme-mode]:checked').value;
    const isSearch = mode !== 'export';
    const src = panel.querySelector('input[name=qme-src]:checked').value;
    $('#qme-ids').classList.toggle('qme-hide', src !== 'list');
    $('#qme-stream').classList.toggle('qme-hide', src !== 'stream');
    const maskVisible = (src === 'stream' || src === 'all');
    $('#qme-mask').classList.toggle('qme-hide', !maskVisible);
    $('#qme-mask-hint').classList.toggle('qme-hide', !maskVisible);
    const fmt = panel.querySelector('input[name=qme-fmt]:checked').value;
    $('#qme-delim').classList.toggle('qme-hide', fmt !== 'csv');
    // режим-зависимые блоки
    $('#qme-search-box').classList.toggle('qme-hide', !isSearch);
    $('#qme-sec-data').classList.toggle('qme-hide', isSearch);
    $('#qme-row-perapp').classList.toggle('qme-hide', isSearch);
    $('#qme-row-zip').classList.toggle('qme-hide', isSearch);
    $('#qme-retry').classList.toggle('qme-hide', isSearch);
  };
  panel.querySelectorAll('input[name=qme-src],input[name=qme-fmt],input[name=qme-mode]').forEach(el => el.addEventListener('change', sync)); sync();

  // закрытие + перетаскивание
  $('#qme-head button').onclick = () => { panel.remove(); style.remove(); };
  (() => { const h = $('#qme-head'); let dx, dy, drag = false;
    h.addEventListener('mousedown', e => { if (e.target.closest('button') || e.target.closest('.qme-lang')) return; drag = true; const r = panel.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; panel.style.right = 'auto'; panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px'; e.preventDefault(); });
    document.addEventListener('mousemove', e => { if (!drag) return; panel.style.left = (e.clientX - dx) + 'px'; panel.style.top = Math.max(0, e.clientY - dy) + 'px'; });
    document.addEventListener('mouseup', () => drag = false); })();

  // кнопка Стоп
  $('#qme-stop').onclick = () => { ABORT = true; log(t('stopping')); $('#qme-stop').disabled = true; };

  // общее: авторизация + проба движка
  async function ensureEngine() {
    log(t('detectingProxy')); await authDetect();
    log(t('checkingEngine'));
    try { const probe = await openWs('engineData'); try { await probe.call('GetDocList', -1, []); } finally { probe.close(); } log(t('engineOk')); }
    catch (e) { throw new Error(t('errEngine', e.message || e)); }
  }
  function readSource() {
    return {
      source: panel.querySelector('input[name=qme-src]:checked').value,
      idsText: $('#qme-ids').value, streamName: $('#qme-stream').value.trim(), mask: $('#qme-mask').value.trim(),
    };
  }
  const readLimit = () => Math.min(8, Math.max(1, parseInt($('#qme-limit').value, 10) || 3));

  // ---------- основной прогон: экспорт ----------
  async function runExport(appsOverride) {
    const btnRun = $('#qme-run'), btnStop = $('#qme-stop'), btnRetry = $('#qme-retry');
    btnRun.disabled = true; btnRetry.disabled = true; btnStop.disabled = false; ABORT = false;
    logEl.textContent = ''; setProgress(0, 0);
    try {
      const cfg = readSource();
      const sel = {
        measures: $('#qme-d-measures').checked, dimensions: $('#qme-d-dimensions').checked, variables: $('#qme-d-variables').checked,
        sheets: $('#qme-d-sheets').checked, bookmarks: $('#qme-d-bookmarks').checked, masterobjects: $('#qme-d-masterobjects').checked,
        general: $('#qme-d-general').checked, script: $('#qme-d-script').checked,
      };
      const fmt = panel.querySelector('input[name=qme-fmt]:checked').value;
      const delim = ($('#qme-delim').value || '|');
      const perApp = $('#qme-per-app').checked;
      const perCat = $('#qme-per-cat').checked;
      const zipMode = $('#qme-zip').checked;
      const dryRun = $('#qme-dry').checked;
      const LIMIT = readLimit();

      // предпроверки
      if (!Object.values(sel).some(Boolean)) throw new Error(t('errNoData'));
      if (fmt === 'csv' && (/^[\p{L}\p{N}]+$/u.test(delim) || delim.includes('"'))) throw new Error(t('errDelim', delim));

      await ensureEngine();

      let apps;
      if (appsOverride) { apps = appsOverride; log(t('retryRun', apps.length)); }
      else {
        log(t('resolvingApps'));
        apps = await resolveApps(cfg);
        log(t('appsCount', apps.length));
        if (!apps.length) throw new Error(t('errEmptyApps'));
        if (apps.length > 50 && !dryRun && !confirm(t('confirmMany', apps.length))) throw new Error(t('errCancelled'));
      }

      const runStamp = ts();   // единый штамп времени на прогон — все файлы датируются одинаково
      const results = []; let done = 0;
      setProgress(0, apps.length);
      const queue = apps.slice();
      await Promise.all(Array.from({ length: Math.min(LIMIT, apps.length) }, async () => {
        while (queue.length && !ABORT) {
          const a = queue.shift();
          const r = await collectWithRetry(a.id, sel);
          if (a.name && !r.appName) r.appName = a.name;
          results.push(r); done++; setProgress(done, apps.length);
          log(r.error ? t('progressErr', done, apps.length, r.appName || a.id, r.error) : t('progressOk', done, apps.length, r.appName || a.id, r));
        }
      }));
      if (ABORT) log(t('aborted', results.length, apps.length));
      const order = new Map(apps.map((x, i) => [x.id, i]));
      results.sort((a, b) => (order.get(a.appId) ?? 0) - (order.get(b.appId) ?? 0));

      if (sel.general) { log(t('enriching')); await enrichFromQrs(results); }

      const errs = results.filter(r => r.error);
      LAST_FAILED = errs.map(r => ({ id: r.appId, name: r.appName }));
      window.__qlikExport = results;

      if (dryRun) {
        const sum = c => results.reduce((s, r) => s + (Array.isArray(r[c]) ? r[c].length : 0), 0);
        log(t('drySummary', results.length, sum('measures'), sum('dimensions'), sum('variables'), sum('sheets'), sum('bookmarks'), sum('masterobjects'), results.filter(r => r.script).length, errs.length));
        if (errs.length) log(t('withErrors', errs.map(r => (r.appName || r.appId) + ' (' + r.error + ')').join('; ')));
        log(t('resultInWindow'));
        return;
      }

      log(t('buildingFiles'));
      const em = makeEmitter(zipMode);
      const n = await exportAll(results, sel, fmt, delim, perApp, perCat, em, runStamp);
      if (errs.length) await em.emit(`qlik_errors_${runStamp}.txt`, '\uFEFF' + errs.map(r => `${r.appId}|${r.appName || ''}|${r.error}`).join('\r\n'), 'text/plain');
      const packed = em.finish(runStamp);
      log(zipMode ? t('doneZip', packed, errs.length) : t('doneFiles', n + (errs.length ? 1 : 0), errs.length));
      if (errs.length) log(t('withErrors', errs.map(r => (r.appName || r.appId) + ' (' + r.error + ')').join('; ')));
    } catch (e) { log(t('failPrefix') + (e.message || e)); }
    finally {
      $('#qme-run').disabled = false; $('#qme-stop').disabled = true;
      $('#qme-retry').disabled = !LAST_FAILED.length;
      if (LAST_FAILED.length) log(t('retryHint', LAST_FAILED.length));
    }
  }

  // ---------- прогон: поиск подстроки (test) ----------
  async function runSearch(kind) {   // kind: 'script' | 'object'
    const btnRun = $('#qme-run'), btnStop = $('#qme-stop'), btnRetry = $('#qme-retry');
    btnRun.disabled = true; btnRetry.disabled = true; btnStop.disabled = false; ABORT = false;
    logEl.textContent = ''; setProgress(0, 0);
    try {
      const needle = $('#qme-needle').value;
      const ci = $('#qme-ci').checked;
      if (!needle) throw new Error(t('errNoNeedle'));
      const cfg = readSource();
      const fmt = panel.querySelector('input[name=qme-fmt]:checked').value;
      const delim = ($('#qme-delim').value || '|');
      const dryRun = $('#qme-dry').checked;
      const LIMIT = readLimit();

      await ensureEngine();
      log(kind === 'script' ? t('searchStartScript') : t('searchStartObject'));

      log(t('resolvingApps'));
      const apps = await resolveApps(cfg);
      log(t('appsCount', apps.length));
      if (!apps.length) throw new Error(t('errEmptyApps'));
      if (apps.length > 50 && !confirm(t('confirmMany', apps.length))) throw new Error(t('errCancelled'));

      const smap = await qrsAppMap();
      const rows = []; const errs = []; let done = 0;
      setProgress(0, apps.length);
      const queue = apps.slice();
      await Promise.all(Array.from({ length: Math.min(LIMIT, apps.length) }, async () => {
        while (queue.length && !ABORT) {
          const a = queue.shift();
          const meta = smap.get(a.id) || {};
          const appName = a.name || meta.name || '';
          const stream = meta.stream || '';
          if (kind === 'script') {
            const r = await scanScript(a.id, needle, ci);
            done++; setProgress(done, apps.length);
            if (r.error) { errs.push({ appId: a.id, error: r.error }); log(t('searchAppErr', appName || a.id, r.error)); }
            else if (r.matches > 0) { rows.push({ stream, appName, appId: a.id, matches: r.matches, sample: r.sample }); log(t('searchHitScript', done, apps.length, appName || a.id, r.matches)); }
            else log(t('searchNoHit', done, apps.length, appName || a.id));
          } else {
            const r = await scanObjects(a.id, needle, ci);
            done++; setProgress(done, apps.length);
            if (r.error) { errs.push({ appId: a.id, error: r.error }); log(t('searchAppErr', appName || a.id, r.error)); }
            else {
              for (const m of r.matches) rows.push({ stream, appName, appId: a.id, objectType: m.objectType, objectId: m.objectId, title: m.title || '' });
              log(r.matches.length ? t('searchHitObj', done, apps.length, appName || a.id, r.matches.length) : t('searchNoHit', done, apps.length, appName || a.id));
            }
          }
        }
      }));
      if (ABORT) log(t('aborted', done, apps.length));

      window.__qlikSearch = rows;
      log(t('searchSummary', rows.length, errs.length));
      if (errs.length) log(t('withErrors', errs.map(e => e.appId + ' (' + e.error + ')').join('; ')));

      if (dryRun) { log(t('resultInWindowSearch')); return; }
      if (!rows.length) { log(t('searchNothing')); return; }

      const cols = kind === 'script'
        ? ['stream', 'appName', 'appId', 'matches', 'sample']
        : ['stream', 'appName', 'appId', 'objectType', 'objectId', 'title'];
      const stamp = ts();
      const f = searchToFile(kind, cols, rows, fmt, delim);
      const em = makeEmitter(false);
      await em.emit(`qlik_search_${kind === 'script' ? 'scripts' : 'objects'}_${stamp}.${f.ext}`, f.body, f.mime);
      log(t('searchDone', rows.length));
    } catch (e) { log(t('failPrefix') + (e.message || e)); }
    finally {
      $('#qme-run').disabled = false; $('#qme-stop').disabled = true;
      $('#qme-retry').disabled = !LAST_FAILED.length;
    }
  }

  $('#qme-run').onclick = () => {
    const mode = panel.querySelector('input[name=qme-mode]:checked').value;
    if (mode === 'search-script') runSearch('script');
    else if (mode === 'search-object') runSearch('object');
    else runExport(null);
  };
  $('#qme-retry').onclick = () => { if (LAST_FAILED.length) runExport(LAST_FAILED.slice()); };

  log(t('ready'));
})();
