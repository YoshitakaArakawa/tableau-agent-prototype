(() => {
  const chat = document.getElementById('chat');
  const txt = document.getElementById('message');
  const luid = document.getElementById('datasourceLuid');
  const limit = document.getElementById('limit');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  let es = null;

  function append(role, text) {
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    d.textContent = text;
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
  }

  async function runOnce() {
    const message = txt.value.trim();
    const ds = luid.value.trim();
    const lim = Number(limit.value) || undefined;
    if (!message || !ds) { alert('message and datasource LUID are required'); return; }
    append('user', message);
    try {
      const res = await fetch('/api/orchestrate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, datasourceLuid: ds, limit: lim }) });
      const json = await res.json();
      (json.events || []).forEach(ev => { if (ev && ev.type) append('sys', `[${ev.type}] ${ev.detail ? JSON.stringify(ev.detail) : ''}`); });
      append('bot', json.reply || '(no reply)');
    } catch (e) { append('sys', 'error: ' + (e?.message || e)); }
  }

  function runStream() {
    const message = txt.value.trim();
    const ds = luid.value.trim();
    const lim = Number(limit.value) || undefined;
    if (!message || !ds) { alert('message and datasource LUID are required'); return; }
    append('user', message);
    const q = new URLSearchParams({ message, datasourceLuid: ds });
    if (lim) q.set('limit', String(lim));
    es = new EventSource(`/api/orchestrate/stream?${q.toString()}`);
    sendBtn.disabled = true; stopBtn.disabled = false;
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === 'message' && ev.detail && ev.detail.text) append('sys', ev.detail.text);
        else if (ev.type === 'final') append('bot', (ev.detail && ev.detail.reply) || '(no reply)');
        else if (ev.type) append('sys', `[${ev.type}] ${ev.detail ? JSON.stringify(ev.detail) : ''}`);
      } catch { append('sys', e.data); }
    };
    es.onerror = () => { try { es.close(); } catch {}; es = null; sendBtn.disabled = false; stopBtn.disabled = true; };
  }

  sendBtn.addEventListener('click', () => { if (es) return; // prevent duplicate
    // Shift+Enter対応はtextarea側で標準動作
    // デフォルトはSSEストリームにします
    runStream();
  });
  stopBtn.addEventListener('click', () => { if (es) { try { es.close(); } catch {}; es = null; sendBtn.disabled = false; stopBtn.disabled = true; append('sys', 'stopped'); } });

  // Enterで送信、Shift+Enterで改行
  txt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) sendBtn.click(); }
  });
})();

