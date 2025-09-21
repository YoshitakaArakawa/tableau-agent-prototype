(() => {
  const $ = (id) => document.getElementById(id);
  const chatEl = $('chat');
  const msgEl = $('message');
  const sendBtn = $('sendBtn');
  const stopBtn = $('stopBtn');
  const luidEl = $('datasourceLuid');
  const dsSelectBlock = $('datasourceSelectBlock');
  const dsSelect = $('datasourceSelect');
  const manualBlock = $('datasourceInputBlock');
  const refreshDatasourcesBtn = $('refreshDatasourcesBtn');
  const dsStatus = $('datasourceStatus');
  const integrationStatusEl = $('integrationStatus');
  const urlBase = new URLSearchParams(location.search).get('base') || 'http://localhost:8787';
  const apiBase = urlBase.endsWith('/') ? urlBase.slice(0, -1) : urlBase;
  const maybeTableau = (() => { try { return typeof tableau !== 'undefined' ? tableau : undefined; } catch { return undefined; } })();

  let es = null;
  let typingTimer = null;
  let conversationId = null;
  let lastDatasourceItems = [];
  let integrationMode = 'standalone';
  let collectingDatasources = false;
  try { conversationId = localStorage.getItem('chat-conv-id') || null; } catch {}

  // restore saved advanced
  try {
    const saved = JSON.parse(localStorage.getItem('chat-advanced') || '{}');
    if (saved.luid) luidEl.value = saved.luid;
  } catch {}

  function persist() {
    try {
      localStorage.setItem('chat-advanced', JSON.stringify({ luid: luidEl.value.trim() }));
    } catch {}
  }

  function setStatus(detail, level) {
    if (!dsStatus) return;
    dsStatus.textContent = detail || '';
    dsStatus.className = 'control-status';
    if (level === 'warn') dsStatus.classList.add('warn');
    else if (level === 'error') dsStatus.classList.add('error');
  }

  function setIntegrationStatus(mode, detail, level) {
    integrationMode = mode;
    if (integrationStatusEl) {
      integrationStatusEl.className = 'status-pill';
      if (mode === 'extension') integrationStatusEl.classList.add('success');
      else if (mode === 'error') integrationStatusEl.classList.add('error');
      else if (mode === 'connecting') integrationStatusEl.classList.add('busy');
      const label = mode === 'extension' ? 'Tableau Extension'
        : mode === 'connecting' ? 'Connecting...'
        : mode === 'error' ? 'Extension Error'
        : 'Standalone';
      integrationStatusEl.textContent = label;
    }
    if (typeof detail === 'string') {
      setStatus(detail, level);
    }
  }

  function getActiveDatasourceLuid() {
    const selectValue = dsSelect && !dsSelect.hidden && dsSelect.options?.length ? dsSelect.value : '';
    const manual = (luidEl?.value || '').trim();
    return selectValue || manual;
  }

  function populateDatasourceOptions(items) {
    if (!dsSelect) return;
    lastDatasourceItems = Array.isArray(items) ? items : [];
    dsSelect.innerHTML = '';
    for (const item of lastDatasourceItems) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.projectName ? `${item.name} - ${item.projectName}` : item.name;
      dsSelect.appendChild(option);
    }
    if (dsSelectBlock) dsSelectBlock.hidden = lastDatasourceItems.length === 0;
    if (lastDatasourceItems.length) {
      const current = getActiveDatasourceLuid();
      const match = lastDatasourceItems.find((item) => item.id === current);
      const value = match ? match.id : lastDatasourceItems[0].id;
      dsSelect.value = value;
      if (luidEl) {
        luidEl.value = value;
        persist();
      }
    }
  }

  // Client log: do not render in UI; log to console for diagnostics only
  const clientLog = { add: (text) => { try { console.log(`[client] ${text}`); } catch {} } };

  // Step chips are removed; keep no-op helpers for compatibility
  function setChip(_step, _state) {}
  function resetChips() {}

  async function collectDashboardDatasourceNames() {
    if (!maybeTableau?.extensions) return [];
    try {
      const dashboard = maybeTableau.extensions.dashboardContent?.dashboard;
      if (!dashboard) return [];
      const names = new Set();
      const worksheets = Array.isArray(dashboard.worksheets) ? dashboard.worksheets : [];
      await Promise.all(worksheets.map(async (ws) => {
        try {
          const list = await ws.getDataSourcesAsync();
          list.forEach((ds) => {
            const name = typeof ds?.name === 'string' ? ds.name.trim() : '';
            if (name) names.add(name);
          });
        } catch (err) {
          clientLog.add(`extensions:worksheet_error ${err?.message || err}`);
        }
      }));
      return Array.from(names);
    } catch (err) {
      clientLog.add(`extensions:collect_failed ${err?.message || err}`);
      throw err;
    }
  }

  async function requestDatasourceResolution(names) {
    const payload = Array.isArray(names) && names.length ? { names } : {};
    const res = await fetch(`${apiBase}/datasources/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = typeof json?.error === 'string' ? json.error : 'Failed to resolve datasources via server.';
      throw new Error(message);
    }
    return Array.isArray(json?.items) ? json.items : [];
  }

  async function refreshDatasourceList(reason) {
    if (!maybeTableau?.extensions) return;
    if (collectingDatasources) return;
    collectingDatasources = true;
    try {
      setIntegrationStatus('extension', reason || 'Resolving datasources...');
      const names = await collectDashboardDatasourceNames();
      if (!names.length) {
        populateDatasourceOptions([]);
        setIntegrationStatus('extension', 'No datasources detected on this dashboard.', 'warn');
        if (manualBlock) manualBlock.hidden = false;
        return;
      }
      const items = await requestDatasourceResolution(names);
      populateDatasourceOptions(items);
      if (items.length) {
        setIntegrationStatus('extension', 'Datasource resolved from dashboard.');
        if (manualBlock) manualBlock.hidden = false;
      } else {
        setIntegrationStatus('extension', 'No matching published datasource. Provide LUID manually.', 'warn');
        if (manualBlock) manualBlock.hidden = false;
      }
    } catch (err) {
      setIntegrationStatus('error', err?.message || 'Datasource resolution failed.', 'error');
      if (manualBlock) manualBlock.hidden = false;
      clientLog.add(`extensions:resolve_failed ${err?.message || err}`);
    } finally {
      collectingDatasources = false;
    }
  }

  async function initializeExtensionsIntegration() {
    if (!maybeTableau?.extensions) {
      setIntegrationStatus('standalone', 'Extensions API not detected. Provide datasource LUID manually.');
      if (manualBlock) manualBlock.hidden = false;
      return;
    }
    try {
      setIntegrationStatus('connecting', 'Initializing Tableau Extensions API...');
      await maybeTableau.extensions.initializeAsync();
      setIntegrationStatus('extension', 'Extensions API connected. Resolving datasources...');
      await refreshDatasourceList();
    } catch (err) {
      setIntegrationStatus('error', err?.message || 'Extension initialization failed. Enter LUID manually.', 'error');
      if (manualBlock) manualBlock.hidden = false;
      clientLog.add(`extensions:init_failed ${err?.message || err}`);
    }
  }

  function escapeHtml(s){ return String(s||'').replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function renderMarkdown(text){
    let t = String(text||'');
    t = t.replace(/```([\s\S]*?)```/g, (_,code)=>`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
    t = escapeHtml(t);
    t = t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    t = t.replace(/`([^`]+)`/g,'<code>$1</code>');
    t = t.replace(/\n\n+/g,'\n\n');
    return t.replace(/\n\n/g,'<br/><br/>').replace(/\n/g,'<br/>');
  }

  function formatDuration(ms){
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '--';
    const seconds = ms / 1000;
    if (seconds >= 100) return `${Math.round(seconds)} s`;
    if (seconds >= 10) return `${seconds.toFixed(1)} s`;
    return `${seconds.toFixed(2)} s`;
  }
  function toDurationMs(value){
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? num : null;
  }

  function bubble(role, html){
    const div = document.createElement('div');
    div.className = `bubble ${role}`;
    div.innerHTML = html;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
    return div;
  }

  function createStreamPanel(){
    const wrap = document.createElement('div');
    wrap.className = 'bubble system';
    const panel = document.createElement('details');
    panel.className = 'stream-panel';
    panel.open = true;
    const sum = document.createElement('summary');
    sum.textContent = 'Streaming... (expand/collapse)';
    const events = document.createElement('div');
    events.className = 'stream-events';
    const times = document.createElement('div');
    times.className = 'stream-times';
    times.hidden = true;
    const timesTitle = document.createElement('div');
    timesTitle.className = 'stream-times-title';
    timesTitle.textContent = 'Durations';
    const totalLine = document.createElement('div');
    totalLine.className = 'stream-time total';
    totalLine.textContent = 'Total: --';
    const timeList = document.createElement('div');
    timeList.className = 'stream-time-list';
    times.appendChild(timesTitle);
    times.appendChild(totalLine);
    times.appendChild(timeList);
    const narr = document.createElement('div');
    narr.className = 'stream-narr';
    const delta = document.createElement('pre');
    delta.className = 'stream-delta';
    panel.appendChild(sum);
    panel.appendChild(events);
    panel.appendChild(times);
    panel.appendChild(narr);
    panel.appendChild(delta);
    wrap.appendChild(panel);
    chatEl.appendChild(wrap);
    chatEl.scrollTop = chatEl.scrollHeight;
    const narrLines = Object.create(null);
    let totalMs = null;
    const durations = [];
    const renderTimes = () => {
      if (!durations.length && totalMs === null) {
        times.hidden = true;
        return;
      }
      times.hidden = false;
      totalLine.textContent = totalMs === null ? 'Total: --' : `Total: ${formatDuration(totalMs)}`;
      timeList.textContent = '';
      for (const entry of durations) {
        const row = document.createElement('div');
        row.className = 'stream-time';
        row.textContent = `${entry.label}: ${formatDuration(entry.ms)}`;
        timeList.appendChild(row);
      }
    };
    renderTimes();
    return {
      addNote: (text) => { const p = document.createElement('div'); p.className = 'note'; p.textContent = text; events.appendChild(p); },
      appendDelta: (text) => { delta.textContent += text; delta.scrollTop = delta.scrollHeight; },
      addWarn: (text) => { const p = document.createElement('div'); p.className = 'warn'; p.textContent = text; events.appendChild(p); },
      narrStart: (key, text) => {
        try {
          narrLines[key] = text;
          narr.textContent = Object.values(narrLines).join('\n');
        } catch {}
      },
      narrAppend: (key, text) => {
        try {
          const prev = narrLines[key] || '';
          narrLines[key] = prev ? `${prev} ${text}` : text;
          narr.textContent = Object.values(narrLines).join('\n');
        } catch {}
      },
      updateDuration: (key, label, ms) => {
        const existing = durations.find((d) => d.key === key);
        if (existing) existing.ms = ms;
        else durations.push({ key, label, ms });
        renderTimes();
      },
      setTotal: (ms) => { totalMs = ms; renderTimes(); },
      finalize: () => { panel.open = true; },
    };
  }

  function stop(){
    if (es) { es.close(); es = null; }
    if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
    sendBtn.disabled = false;
    stopBtn.disabled = true;
  }

  function start(){
    if (es) es.close();
    const message = msgEl.value.trim();
    const luid = getActiveDatasourceLuid().trim();
    if (!message) return;
    if (!luid) { setStatus('Datasource LUID is required.', 'error'); return; }
    persist();

    bubble('user', escapeHtml(message));
    msgEl.value = '';
    msgEl.style.height = 'auto';

    resetChips();
    setChip('triage','active');

    const url = new URL(`${apiBase}/chat/orchestrator/stream`);
    url.searchParams.set('message', message);
    url.searchParams.set('datasourceLuid', luid);
    if (conversationId) url.searchParams.set('conversationId', conversationId);

    clientLog.add(`connect ${url.toString()}`);
    es = new EventSource(url.toString());
    sendBtn.disabled = true;
    stopBtn.disabled = false;

    const stream = createStreamPanel();
    const runStartedAt = Date.now();

    let firstMessage = true;
    es.onmessage = (ev) => {
      if (firstMessage) { clientLog.add('stream opened'); firstMessage = false; }
      try {
        const data = JSON.parse(ev.data);
        const t = data?.type || '';
        switch (t){
          case 'narrate': {
            const text = data?.detail?.text || '';
            if (text) stream.appendDelta(`[narrate] ${text}\n`);
            break; }
          case 'clarify:request': {
            const detail = data?.detail || {};
            let text = detail.text || detail.note || 'Clarification is required.';
            try {
              if (Array.isArray(detail.candidates) && detail.candidates.length) {
                const lines = detail.candidates.map((c, i) => `${i+1}. ${c.fieldCaption || c}`);
                text += `\n\n` + lines.join('\n');
              }
            } catch {}
            stream.addNote('Clarification requested');
            bubble('assistant', renderMarkdown(text));
            break; }
          case 'session:init': {
            const id = data?.detail?.conversationId;
            if (id && typeof id === 'string') { conversationId = id; try { localStorage.setItem('chat-conv-id', id); } catch {} }
            break; }
          case 'triage:start': setChip('triage','active'); { stream.narrStart('triage', 'Reviewing your question and intent...'); } break;
          case 'triage:done': {
            setChip('triage','done');
            stream.narrAppend('triage', 'Clarification captured.');
            const ms = toDurationMs(data?.detail?.durationMs);
            if (ms !== null) stream.updateDuration('triage', 'Triage', ms);
            break;
          }
          case 'metadata:start': setChip('metadata','active'); { stream.narrStart('metadata', 'Looking up the dataset fields...'); } break;
          case 'triage:delta': stream.appendDelta(`[triage] ${data?.detail?.text || ''}`); break;
          case 'metadata:delta': stream.appendDelta(`[metadata] ${data?.detail?.text || ''}`); break;
          case 'plan:delta': stream.appendDelta(`[plan] ${data?.detail?.text || ''}`); break;
          case 'fetch:delta': stream.appendDelta(`[fetch] ${data?.detail?.text || ''}`); break;
          case 'metadata:done': {
            setChip('metadata','done');
            stream.narrAppend('metadata', 'Metadata is ready.');
            const ms = toDurationMs(data?.detail?.durationMs);
            if (ms !== null) stream.updateDuration('metadata', 'Metadata', ms);
            break;
          }
          case 'selector:done': {
            const detail = data?.detail || {};
            if (Array.isArray(detail.fields) && detail.fields.length) {
              const names = detail.fields.join(', ');
              clientLog.add(`selector:fields ${names}`);
            }
            const ms = toDurationMs(detail.durationMs);
            if (ms !== null) stream.updateDuration('selector', 'Field selection', ms);
            break;
          }
          case 'selector:error': {
            const detail = data?.detail || {};
            const msg = detail.message || detail.reason || 'Field selection failed.';
            stream.addWarn(msg);
            const ms = toDurationMs(detail.durationMs);
            if (ms !== null) stream.updateDuration('selector', 'Field selection', ms);
            break;
          }
          case 'plan:start': setChip('plan','active'); { stream.narrStart('plan', 'Mapping out the analysis steps...'); } break;
          case 'plan:analysis:done': {
            const detail = data?.detail || {};
            const ms = toDurationMs(detail.durationMs);
            if (ms !== null) stream.updateDuration('plan-analysis', 'Planning (analysis)', ms);
            break;
          }
          case 'plan:compile:done': {
            const detail = data?.detail || {};
            const ms = toDurationMs(detail.durationMs);
            if (ms !== null) stream.updateDuration('plan-compile', 'Planning (compile)', ms);
            break;
          }
          case 'plan:error': {
            setChip('plan','error');
            const n = Array.isArray(data?.detail?.issues) ? data.detail.issues.length : 0;
            stream.addWarn(`Plan validation failed (${n} issues). Using safe fallback.`);
            const ms = toDurationMs(data?.detail?.durationMs);
            if (ms !== null) stream.updateDuration('plan', 'Planning', ms);
            break; }
          case 'plan:done': {
            setChip('plan','done');
            const detail = data?.detail || {};
            const qs = typeof detail.query_summary === 'string' ? detail.query_summary.trim() : '';
            const planOverview = typeof detail.analysis_plan?.overview === 'string' ? detail.analysis_plan.overview.trim() : '';
            const pieces = ['Analysis plan prepared'];
            if (qs) pieces.push(`I will compute ${qs}.`);
            if (planOverview && !qs.includes(planOverview)) pieces.push(planOverview);
            stream.narrAppend('plan', pieces.join(' '));
            const analysisMs = toDurationMs(detail.analysis_duration_ms);
            if (analysisMs !== null) stream.updateDuration('plan-analysis', 'Planning (analysis)', analysisMs);
            const compileMs = toDurationMs(detail.compile_duration_ms);
            if (compileMs !== null) stream.updateDuration('plan-compile', 'Planning (compile)', compileMs);
            break; }
          case 'fetch:start': setChip('fetch','active'); { stream.narrStart('fetch', 'Executing the VizQL query...'); } break;
          case 'fetch:warning': {
            const msg = data?.detail?.message || '';
            const hint = data?.detail?.hint;
            stream.addWarn(hint ? `${msg} (${hint})` : msg);
            break; }
          case 'fetch:retry': {
            const detail = data?.detail || {};
            const attempt = detail.attempt;
            const source = detail.source;
            const msg = detail.message || detail.reason || '';
            const contextParts = [];
            if (typeof attempt === 'number') contextParts.push(`attempt ${attempt}`);
            if (typeof source === 'string' && source) contextParts.push(source);
            const prefix = contextParts.length ? `Fetch retry (${contextParts.join(' / ')})` : 'Fetch retry';
            const warnText = msg ? `${prefix}: ${msg}` : prefix;
            clientLog.add(`stream:${warnText}`);
            break; }
          case 'fetch:done': {
            setChip('fetch','done');
            stream.narrAppend('fetch', 'Data fetch complete.');
            const ms = toDurationMs(data?.detail?.durationMs);
            if (ms !== null) stream.updateDuration('fetch', 'Fetch', ms);
            break;
          }
          case 'summarize:start': setChip('summarize','active'); { stream.narrStart('summarize', 'Summarizing the findings...'); } break;
          case 'final:delta': { const text = data?.detail?.text || ''; stream.appendDelta(text); break; }
          case 'final': {
            setChip('summarize','done'); setChip('final','done');
            const detail = data?.detail || {};
            let text = detail.reply;
            if (typeof text !== 'string') {
              try { text = JSON.stringify(text ?? detail ?? {}, null, 2); } catch { text = String(text ?? ''); }
            }
            const summarizeMs = toDurationMs(detail.durationMs);
            if (summarizeMs !== null) stream.updateDuration('summarize', 'Summarize', summarizeMs);
            stream.setTotal(Date.now() - runStartedAt);
            es?.close();
            es = null;
            stream.finalize();
            bubble('assistant', renderMarkdown(text));
            clientLog.add('stream closed (ok)');
            break; }
          default: break;
        }
      } catch {}
    };

    es.onerror = () => {
      sendBtn.disabled = false;
      stopBtn.disabled = true;
      try { bubble('system', 'Connection failed. Check server URL (base) and network.'); } catch {}
      stream.setTotal(Date.now() - runStartedAt);
      clientLog.add('stream closed (error)');
      es?.close();
      es = null;
    };
  }

  if (dsSelect) {
    dsSelect.addEventListener('change', () => {
      const value = dsSelect.value;
      if (luidEl) {
        luidEl.value = value;
        persist();
      }
      const selectedLabel = dsSelect.options?.length ? dsSelect.options[dsSelect.selectedIndex]?.text : value;
      setStatus(selectedLabel ? `Datasource selected: ${selectedLabel}` : 'Datasource updated.');
    });
  }

  if (refreshDatasourcesBtn) {
    refreshDatasourcesBtn.addEventListener('click', () => {
      if (!maybeTableau?.extensions) {
        setIntegrationStatus('standalone', 'Extensions API not available. Provide LUID manually.', 'warn');
        return;
      }
      refreshDatasourceList('Refreshing datasources...');
    });
  }

  setIntegrationStatus('standalone', 'Enter datasource LUID manually.');
  if (manualBlock) manualBlock.hidden = false;
  initializeExtensionsIntegration();

  const autosize = () => { msgEl.style.height = 'auto'; msgEl.style.height = Math.min(180, msgEl.scrollHeight) + 'px'; };
  msgEl.addEventListener('input', autosize); autosize();

  sendBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  msgEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); start(); } });
})();
