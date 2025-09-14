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
    const delta = document.createElement('pre');
    delta.className = 'stream-delta';
    const debug = document.createElement('div');
    debug.className = 'stream-debug';
    const debugTitle = document.createElement('div');
    debugTitle.className = 'stream-debug-title';
    debugTitle.textContent = 'Debug';
    debug.appendChild(debugTitle);
    panel.appendChild(sum);
    panel.appendChild(events);
    panel.appendChild(debug);
    panel.appendChild(delta);
    wrap.appendChild(panel);
    chatEl.appendChild(wrap);
    chatEl.scrollTop = chatEl.scrollHeight;
    return {
      addNote: (text) => { const p = document.createElement('div'); p.className = 'note'; p.textContent = text; events.appendChild(p); },
      appendDelta: (text) => { delta.textContent += text; delta.scrollTop = delta.scrollHeight; },
      addWarn: (text) => { const p = document.createElement('div'); p.className = 'warn'; p.textContent = text; debug.appendChild(p); },
      addDebug: (text) => { const p = document.createElement('div'); p.className = 'debug'; p.textContent = text; debug.appendChild(p); },
      finalize: () => { sum.textContent = 'Streaming complete'; panel.open = false; },
    };
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
          case 'triage:start': setChip('triage','active'); break;
          case 'triage:done': setChip('triage','done'); stream.addNote('Triage completed'); break;
          case 'metadata:start': setChip('metadata','active'); break;
          case 'triage:delta': stream.appendDelta(`[triage] ${data?.detail?.text || ''}`); break;
          case 'metadata:delta': stream.appendDelta(`[metadata] ${data?.detail?.text || ''}`); break;
          case 'plan:delta': stream.appendDelta(`[plan] ${data?.detail?.text || ''}`); break;
          case 'fetch:delta': stream.appendDelta(`[fetch] ${data?.detail?.text || ''}`); break;
          case 'metadata:done': setChip('metadata','done'); stream.addNote('Metadata loaded'); break;
          case 'plan:start': setChip('plan','active'); stream.addNote('Planning started'); break;
          case 'plan:error': {
            setChip('plan','error');
            const n = Array.isArray(data?.detail?.issues) ? data.detail.issues.length : 0;
            stream.addNote(`Plan validation failed (${n} issues). Using safe fallback.`);
            break; }
          case 'plan:done': {
            setChip('plan','done');
            stream.addNote('Plan finalized');
            if (data?.detail?.query_summary) stream.addDebug(`Query: ${data.detail.query_summary}`);
            break; }
          case 'fetch:start': setChip('fetch','active'); stream.addNote('Fetching started'); break;
          case 'fetch:warning': {
            const msg = data?.detail?.message || '';
            const hint = data?.detail?.hint;
            stream.addWarn(hint ? `${msg} (${hint})` : msg);
            break; }
          case 'fetch:retry': {
            const rsn = data?.detail?.reason || '';
            const hint = data?.detail?.hint;
            stream.addWarn(hint ? `Fetch retry: ${hint}` : `Fetch retry: ${rsn}`);
            break; }
          case 'fetch:done': setChip('fetch','done'); stream.addNote('Data fetched'); break;
          case 'summarize:start': setChip('summarize','active'); stream.addNote('Summarization started'); break;
          case 'final:delta': { const text = data?.detail?.text || ''; stream.appendDelta(text); break; }
          case 'final': {
            setChip('summarize','done'); setChip('final','done');
            const text = data?.detail?.reply || '';
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
