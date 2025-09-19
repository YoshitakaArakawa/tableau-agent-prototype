(() => {
  const $ = (id) => document.getElementById(id);
  const chatEl = $('chat');
  const msgEl = $('message');
  const sendBtn = $('sendBtn');
  const stopBtn = $('stopBtn');
  const luidEl = $('datasourceLuid');
  const urlBase = new URLSearchParams(location.search).get('base') || 'http://localhost:8787';

  let es = null;
  let typingTimer = null;
  let conversationId = null;
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

  // Client log: do not render in UI; log to console for diagnostics only
  const clientLog = { add: (text) => { try { console.log(`[client] ${text}`); } catch {} } };

  // Step chips are removed; keep no-op helpers for compatibility
  function setChip(_step, _state) {}
  function resetChips() {}

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
    // Natural-language narration (smaller text)
    const narr = document.createElement('div');
    narr.className = 'stream-narr';
    // Raw deltas (for debug/partial text if any)
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
          if (!narrLines[key]) {
            const line = document.createElement('div');
            line.className = 'narr-line';
            line.textContent = text;
            narr.appendChild(line);
            narrLines[key] = line;
          } else {
            narrLines[key].textContent = text;
          }
        } catch {}
      },
      narrAppend: (key, extra) => {
        try {
          const line = narrLines[key];
          if (line) {
            line.textContent = (line.textContent || '') + ' ' + extra;
          } else {
            // fallback: create
            const l = document.createElement('div');
            l.className = 'narr-line';
            l.textContent = extra;
            narr.appendChild(l);
            narrLines[key] = l;
          }
        } catch {}
      },
      updateDuration: (key, label, ms) => {
        const dur = toDurationMs(ms);
        if (dur === null) return;
        let existing = null;
        for (const entry of durations) {
          if (entry.key === key) { existing = entry; break; }
        }
        if (existing) {
          existing.ms = dur;
          existing.label = label;
        } else {
          durations.push({ key, label, ms: dur });
        }
        renderTimes();
      },
      setTotal: (ms) => {
        const dur = toDurationMs(ms);
        if (dur === null) return;
        totalMs = dur;
        renderTimes();
      },
      finalize: () => { sum.textContent = 'Streaming complete'; panel.open = false; renderTimes(); },
    };
  }

  function narrateStep(type, detail){
    const map = {
      'triage:start': 'Reviewing your question and intent...',
      'triage:done': 'Clarification captured.',
      'metadata:start': 'Looking up the dataset’s fields...',
      'metadata:done': 'Metadata is ready.',
      'plan:start': 'Mapping out the analysis steps...',
      'plan:done': 'Analysis plan prepared; compiling the query.',
      'fetch:start': 'Executing the VizQL query...',
      'fetch:done': 'Data fetch complete.',
      'summarize:start': 'Summarizing the findings...'
    };
    let line = map[type];
    // Add a compact description of what will be fetched when plan is done
    try {
      if (type === 'plan:done') {
        const qs = detail && typeof detail.query_summary === 'string' ? detail.query_summary : '';
        if (qs) line = `${line} I will compute ${qs}.`;
      }
    } catch {}
    if (line) return line + '\n';
    return '';
  }

  function start(){
    if (es) es.close();
    const message = msgEl.value.trim();
    const luid = luidEl.value.trim();
    if (!message) return;
    persist();

    bubble('user', escapeHtml(message));
    msgEl.value = '';
    msgEl.style.height = 'auto';

    resetChips();
    setChip('triage','active');

    const base = urlBase.replace(/\/$/,'');
    const url = new URL(`${base}/chat/orchestrator/stream`);
    url.searchParams.set('message', message);
    if (luid) url.searchParams.set('datasourceLuid', luid);
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
            // Render candidates as a numbered list when present
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
          case 'metadata:start': setChip('metadata','active'); { stream.narrStart('metadata', 'Looking up the dataset’s fields...'); } break;
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
              stream.addNote(`Fields selected: ${detail.fields.join(', ')}`);
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
            stream.addWarn(msg ? `${prefix}: ${msg}` : prefix);
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
            es?.close();
            es = null;
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

  function stop(){
    if (es) { es.close(); es = null; }
    if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
    sendBtn.disabled = false;
    stopBtn.disabled = true;
  }

  const autosize = () => { msgEl.style.height = 'auto'; msgEl.style.height = Math.min(180, msgEl.scrollHeight) + 'px'; };
  msgEl.addEventListener('input', autosize); autosize();

  sendBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  msgEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); start(); } });
})();








