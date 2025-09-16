(() => {
  const $ = (id) => document.getElementById(id);
  const chatEl = $("chat");
  const msgEl = $("message");
  const sendBtn = $("sendBtn");
  const stopBtn = $("stopBtn");
  const luidEl = $("datasourceLuid");
  const limitEl = $("limit");
  const urlBase = new URLSearchParams(location.search).get('base') || 'http://localhost:8787';

  let es = null;
  let typingTimer = null;
  let conversationId = null;
  try { conversationId = localStorage.getItem('chat-conv-id') || null; } catch {}

  // restore saved advanced
  try {
    const saved = JSON.parse(localStorage.getItem('chat-advanced') || '{}');
    if (saved.luid) luidEl.value = saved.luid;
    if (saved.limit) limitEl.value = String(saved.limit);
  } catch {}

  function persist() {
    try {
      localStorage.setItem('chat-advanced', JSON.stringify({ luid: luidEl.value.trim(), limit: Number(limitEl.value) || 50 }));
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
    // Natural-language narration (smaller text)
    const narr = document.createElement('div');
    narr.className = 'stream-narr';
    // Raw deltas (for debug/partial text if any)
    const delta = document.createElement('pre');
    delta.className = 'stream-delta';
    panel.appendChild(sum);
    panel.appendChild(events);
    panel.appendChild(narr);
    panel.appendChild(delta);
    wrap.appendChild(panel);
    chatEl.appendChild(wrap);
    chatEl.scrollTop = chatEl.scrollHeight;
    const narrLines = Object.create(null);
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
      finalize: () => { sum.textContent = 'Streaming complete'; panel.open = false; },
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
    if (line) return line + "\n";
    return '';
  }

  function start(){
    if (es) es.close();
    const message = msgEl.value.trim();
    const luid = luidEl.value.trim();
    const limit = Number(limitEl.value) || 50;
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
    if (limit) url.searchParams.set('limit', String(limit));
    if (conversationId) url.searchParams.set('conversationId', conversationId);

    clientLog.add(`connect ${url.toString()}`);
    es = new EventSource(url.toString());
    sendBtn.disabled = true;
    stopBtn.disabled = false;

    const stream = createStreamPanel();

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
          case 'triage:done': setChip('triage','done'); { stream.narrAppend('triage', 'Clarification captured.'); } break;
          case 'metadata:start': setChip('metadata','active'); { stream.narrStart('metadata', 'Looking up the dataset\u2019s fields...'); } break;
          case 'triage:delta': stream.appendDelta(`[triage] ${data?.detail?.text || ''}`); break;
          case 'metadata:delta': stream.appendDelta(`[metadata] ${data?.detail?.text || ''}`); break;
          case 'plan:delta': stream.appendDelta(`[plan] ${data?.detail?.text || ''}`); break;
          case 'fetch:delta': stream.appendDelta(`[fetch] ${data?.detail?.text || ''}`); break;
          case 'metadata:done': setChip('metadata','done'); { stream.narrAppend('metadata', 'Metadata is ready.'); } break;
          case 'plan:start': setChip('plan','active'); { stream.narrStart('plan', 'Mapping out the analysis steps...'); } break;
          case 'plan:error': {
            setChip('plan','error');
            const n = Array.isArray(data?.detail?.issues) ? data.detail.issues.length : 0;
            stream.addWarn(`Plan validation failed (${n} issues). Using safe fallback.`);
            break; }
          case 'plan:done': {
            setChip('plan','done');
            const qs = data?.detail?.query_summary;
            const extra = qs ? `Analysis plan prepared; compiling the query. I will compute ${qs}.` : 'Analysis plan prepared; compiling the query.';
            stream.narrAppend('plan', extra);
            break; }
          case 'fetch:start': setChip('fetch','active'); { stream.narrStart('fetch', 'Executing the VizQL query...'); } break;
          case 'fetch:warning': {
            const msg = data?.detail?.message || '';
            const hint = data?.detail?.hint;
            stream.addWarn(hint ? `${msg} (${hint})` : msg);
            break; }
          case 'fetch:retry': { const rsn = data?.detail?.reason || ''; const hint = data?.detail?.hint; stream.addWarn(hint ? `Fetch retry: ${hint}` : `Fetch retry: ${rsn}`); break; }
          case 'fetch:done': setChip('fetch','done'); { stream.narrAppend('fetch', 'Data fetch complete.'); } break;
          case 'summarize:start': setChip('summarize','active'); { stream.narrStart('summarize', 'Summarizing the findings...'); } break;
          case 'final:delta': { const text = data?.detail?.text || ''; stream.appendDelta(text); break; }
          case 'final': {
            setChip('summarize','done'); setChip('final','done');
            let text = data?.detail?.reply;
            if (typeof text !== 'string') {
              try { text = JSON.stringify(text ?? data?.detail ?? {}, null, 2); } catch { text = String(text ?? '') }
            }
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

