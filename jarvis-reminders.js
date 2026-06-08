// jarvis-reminders.js — JARVIS Reminder Engine v1
// ─────────────────────────────────────────────────────────────────
// PURELY ADDITIVE — does not modify any existing JARVIS functions.
// Drop this file in your repo root and add ONE line to index.html:
//   <script src="jarvis-reminders.js"></script>  ← before </body>
//
// What it does:
//   • Intercepts reminder/alarm intent from typed or voice input
//   • Calls /api/reminder to parse natural language time via Groq
//   • Stores reminders in localStorage
//   • Fires browser notification at the right time (setInterval checker)
//   • Falls back to Tasker HTTP on port 1820 if notification fails
//   • Adds a 🔔 button to the input bar (non-destructive injection)
//   • Adds a reminder panel accessible via the 🔔 button
// ─────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const REMINDER_KEY    = 'jarvis_reminders_v1';
  const TASKER_BASE     = 'http://localhost:1820/run';
  const CHECK_INTERVAL  = 15000; // check every 15 seconds

  // ── STORAGE ────────────────────────────────────────────────────
  function loadReminders() {
    try { return JSON.parse(localStorage.getItem(REMINDER_KEY)) || []; }
    catch { return []; }
  }

  function saveReminders(arr) {
    localStorage.setItem(REMINDER_KEY, JSON.stringify(arr));
    renderReminderPanel();
    updateReminderBadge();
  }

  function addReminder(label, isoTime, displayTime) {
    const reminders = loadReminders();
    reminders.push({
      id: Date.now(),
      label,
      isoTime,
      displayTime,
      fired: false
    });
    saveReminders(reminders);
  }

  function markFired(id) {
    const reminders = loadReminders();
    const r = reminders.find(r => r.id === id);
    if (r) r.fired = true;
    saveReminders(reminders);
  }

  function deleteReminder(id) {
    saveReminders(loadReminders().filter(r => r.id !== id));
  }

  // ── INTENT DETECTION ───────────────────────────────────────────
  // Returns true if the text looks like a reminder request
  const REMINDER_PATTERNS = [
    /remind\s+me/i,
    /set\s+(?:a\s+)?(?:reminder|alarm|alert|timer)/i,
    /alert\s+me/i,
    /wake\s+me/i,
    /notify\s+me/i,
    /alarm\s+(?:at|for|in)/i,
    /reminder\s+(?:at|for|in)/i,
  ];

  function isReminderIntent(text) {
    return REMINDER_PATTERNS.some(p => p.test(text));
  }

  // ── PARSE REMINDER VIA API ──────────────────────────────────────
  async function parseReminder(text) {
    const res = await fetch('/api/reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        nowISO: new Date().toISOString()
      })
    });
    return res.json(); // { label, isoTime, relativeMs, displayTime } or { error }
  }

  // ── FIRE REMINDER ───────────────────────────────────────────────
  async function fireReminder(reminder) {
    markFired(reminder.id);

    const message = `⏰ ${reminder.label}`;

    // 1. JARVIS speaks the reminder
    jarvisSpeak(`Sir, your reminder: ${reminder.label}`);

    // 2. Add to chat
    jarvisAddMsg('ai', `⏰ Reminder, Sir: <strong>${reminder.label}</strong>`, 'reminder');

    // 3. Browser notification
    let notifSent = false;
    if (Notification.permission === 'granted') {
      try {
        new Notification('JARVIS REMINDER', {
          body: reminder.label,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          vibrate: [200, 100, 200],
          tag: 'jarvis-reminder-' + reminder.id
        });
        notifSent = true;
      } catch (_) {}
    }

    // 4. Tasker fallback
    if (!notifSent) {
      try {
        await fetch(
          `${TASKER_BASE}?taskName=${encodeURIComponent('JARVIS Reminder')}&par1=${encodeURIComponent(reminder.label)}`,
          { signal: AbortSignal.timeout(3000) }
        );
      } catch (_) {}
    }
  }

  // ── REMINDER CHECKER ───────────────────────────────────────────
  function startReminderChecker() {
    setInterval(() => {
      const now = Date.now();
      const reminders = loadReminders();
      let changed = false;

      reminders.forEach(r => {
        if (!r.fired && new Date(r.isoTime).getTime() <= now) {
          fireReminder(r);
          r.fired = true;
          changed = true;
        }
      });

      if (changed) saveReminders(reminders);
    }, CHECK_INTERVAL);
  }

  // ── NOTIFICATION PERMISSION ─────────────────────────────────────
  function requestNotifPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // ── BRIDGE TO EXISTING JARVIS FUNCTIONS ────────────────────────
  // Uses window.speak and window.addMsg if available, graceful fallback
  function jarvisSpeak(text) {
    if (typeof window.speak === 'function') { window.speak(text); return; }
    // fallback
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.0; utt.pitch = 1.1;
    speechSynthesis.speak(utt);
  }

  function jarvisAddMsg(role, html, badge) {
    if (typeof window.addMsg === 'function') { window.addMsg(role, html, badge); return; }
    console.log('[JARVIS Reminder]', html);
  }

  function jarvisShowTyping() {
    if (typeof window.showTyping === 'function') window.showTyping();
  }

  function jarvisRemoveTyping() {
    if (typeof window.removeTyping === 'function') window.removeTyping();
  }

  // ── HANDLE REMINDER REQUEST ─────────────────────────────────────
  // Called by the interceptor when reminder intent is detected
  async function handleReminderRequest(text) {
    jarvisShowTyping();

    try {
      const result = await parseReminder(text);
      jarvisRemoveTyping();

      if (result.error) {
        const reply = `I couldn't figure out the time for that reminder, Sir. Try saying something like "remind me in 30 minutes to pray" or "remind me at 9pm".`;
        jarvisAddMsg('ai', reply);
        jarvisSpeak(reply);
        return;
      }

      addReminder(result.label, result.isoTime, result.displayTime);

      const reply = `Reminder set for ${result.displayTime}, Sir. I'll alert you: "${result.label}".`;
      jarvisAddMsg('ai', reply, 'reminder-set');
      jarvisSpeak(reply);

    } catch {
      jarvisRemoveTyping();
      const reply = `Reminder service unavailable, Sir. Please try again.`;
      jarvisAddMsg('ai', reply);
      jarvisSpeak(reply);
    }
  }

  // ── INTERCEPT EXISTING sendMessage ─────────────────────────────
  // Wraps the global sendMessage without replacing it
  // Reminder check runs first; non-reminder messages pass through untouched
  function installInterceptor() {
    const _original = window.sendMessage;
    if (typeof _original !== 'function') {
      // sendMessage not ready yet — retry
      setTimeout(installInterceptor, 300);
      return;
    }

    window.sendMessage = function (text) {
      if (!text?.trim()) return;
      if (isReminderIntent(text.trim())) {
        // Show user message in chat first
        if (typeof window.addMsg === 'function') window.addMsg('user', text.trim());
        if (typeof window.clearWelcome === 'function') window.clearWelcome();
        handleReminderRequest(text.trim());
      } else {
        _original.call(this, text);
      }
    };
  }

  // ── UI INJECTION ────────────────────────────────────────────────
  // Injects 🔔 button + reminder panel into existing DOM without touching anything
  function injectUI() {
    // ── CSS ──
    const style = document.createElement('style');
    style.textContent = `
      #jrvReminderBtn {
        width: 42px; height: 42px; border-radius: 50%;
        background: rgba(255,200,0,0.08);
        border: 1px solid rgba(255,200,0,0.3);
        color: #ffc800; font-size: 16px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; flex-shrink: 0; transition: all 0.2s;
        user-select: none; position: relative;
      }
      #jrvReminderBtn:active { background: rgba(255,200,0,0.2); border-color: #ffc800; }
      #jrvReminderDot {
        position: absolute; top: 5px; right: 5px;
        width: 7px; height: 7px; border-radius: 50%;
        background: #ffc800; box-shadow: 0 0 6px #ffc800;
        display: none;
      }

      /* Reminder panel */
      #jrvReminderPanel {
        position: fixed; inset: 0; z-index: 210;
        background: rgba(2,10,20,0.97);
        display: none; flex-direction: column;
        padding: 24px 20px; gap: 16px;
        font-family: 'Courier New', monospace;
      }
      #jrvReminderPanel.open { display: flex; }
      .jrv-panel-header { display: flex; align-items: center; justify-content: space-between; }
      .jrv-panel-title  { font-size: 12px; letter-spacing: 4px; color: #ffc800; }
      .jrv-panel-close  {
        background: transparent; border: 1px solid #0a2040;
        color: #4a7a9b; font-family: inherit; font-size: 12px;
        padding: 6px 14px; border-radius: 8px; cursor: pointer;
      }
      .jrv-panel-close:hover { border-color: #00d4ff; color: #00d4ff; }
      .jrv-panel-sub { font-size: 9px; letter-spacing: 2px; color: #4a7a9b; }
      #jrvReminderList { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
      .jrv-reminder-item {
        display: flex; align-items: flex-start; gap: 10px;
        background: rgba(255,200,0,0.04);
        border: 1px solid rgba(255,200,0,0.15);
        border-radius: 10px; padding: 10px 12px;
        font-size: 12px; color: #c8e8ff;
      }
      .jrv-reminder-item.fired { opacity: 0.4; border-color: rgba(255,255,255,0.08); }
      .jrv-reminder-info { flex: 1; display: flex; flex-direction: column; gap: 3px; }
      .jrv-reminder-label { font-size: 13px; }
      .jrv-reminder-time  { font-size: 10px; letter-spacing: 1px; color: #ffc800; }
      .jrv-reminder-fired { font-size: 9px; color: #4a7a9b; letter-spacing: 1px; }
      .jrv-del-btn {
        background: transparent; border: none; color: #4a7a9b;
        font-size: 15px; cursor: pointer; padding: 0 4px;
      }
      .jrv-del-btn:hover { color: #ff3333; }
      .jrv-empty {
        color: #4a7a9b; font-size: 11px; letter-spacing: 2px;
        text-align: center; padding: 40px 0;
      }
      .jrv-add-row { display: flex; gap: 8px; }
      #jrvNewReminder {
        flex: 1; background: rgba(255,200,0,0.04);
        border: 1px solid rgba(255,200,0,0.2);
        border-radius: 20px; color: #c8e8ff;
        font-family: inherit; font-size: 12px;
        padding: 10px 14px; outline: none;
      }
      #jrvNewReminder:focus { border-color: #ffc800; }
      #jrvNewReminder::placeholder { color: #4a7a9b; }
      #jrvSetBtn {
        background: rgba(255,200,0,0.1);
        border: 1px solid rgba(255,200,0,0.35);
        border-radius: 20px; color: #ffc800;
        font-family: inherit; font-size: 11px;
        letter-spacing: 1px; padding: 10px 16px;
        cursor: pointer; white-space: nowrap;
      }
      #jrvSetBtn:hover { background: rgba(255,200,0,0.2); }
      .jrv-hint { font-size: 9px; letter-spacing: 1px; color: #4a7a9b; line-height: 1.7; }

      /* badge styles for reminder messages in chat */
      .reminder-set-badge  { font-size: 8px; color: #ffc800; letter-spacing: 1px; opacity: 0.9; }
      .reminder-badge      { font-size: 8px; color: #ff8800; letter-spacing: 1px; opacity: 0.9; }
    `;
    document.head.appendChild(style);

    // ── 🔔 BUTTON → inject into input bar ──
    const inputBar = document.getElementById('inputBar');
    if (inputBar) {
      const btn = document.createElement('div');
      btn.className = 'icon-btn';
      btn.id = 'jrvReminderBtn';
      btn.title = 'Reminders';
      btn.innerHTML = '🔔<span id="jrvReminderDot"></span>';
      btn.onclick = openReminderPanel;
      // Insert before the liveBtn (last child)
      const liveBtn = document.getElementById('liveBtn');
      inputBar.insertBefore(btn, liveBtn || null);
    }

    // ── REMINDER PANEL ──
    const panel = document.createElement('div');
    panel.id = 'jrvReminderPanel';
    panel.innerHTML = `
      <div class="jrv-panel-header">
        <div class="jrv-panel-title">🔔 JARVIS REMINDERS</div>
        <button class="jrv-panel-close" onclick="window._jrvClosePanel()">✕ CLOSE</button>
      </div>
      <div class="jrv-panel-sub">SCHEDULED ALERTS</div>
      <div id="jrvReminderList"></div>
      <div class="jrv-add-row">
        <input id="jrvNewReminder" type="text"
          placeholder='e.g. "remind me in 1 hour to call Ali"'
          autocomplete="off"
          onkeydown="if(event.key==='Enter') window._jrvAddFromPanel()"/>
        <button id="jrvSetBtn" onclick="window._jrvAddFromPanel()">+ SET</button>
      </div>
      <div class="jrv-hint">
        💡 Voice: "Remind me at 9pm to pray" or "Set alarm for 7am"<br/>
        Typed: works the same way in the main input bar.
      </div>
    `;
    document.body.appendChild(panel);

    // Patch addMsg to support reminder badges (non-destructive)
    patchAddMsg();
  }

  // ── PATCH addMsg FOR REMINDER BADGES ───────────────────────────
  // Adds support for badge='reminder-set' and badge='reminder'
  // without touching original addMsg logic
  function patchAddMsg() {
    const _orig = window.addMsg;
    if (typeof _orig !== 'function') { setTimeout(patchAddMsg, 300); return; }
    window.addMsg = function(role, text, badge) {
      // reminder badges need special label — delegate HTML rendering
      if (badge === 'reminder-set' || badge === 'reminder') {
        const messagesEl = document.getElementById('messages');
        if (!messagesEl) { _orig(role, text, badge); return; }
        if (typeof window.clearWelcome === 'function') window.clearWelcome();

        const badgeHtml = badge === 'reminder-set'
          ? '<span class="reminder-set-badge">🔔 REMINDER SET</span>'
          : '<span class="reminder-badge">⏰ REMINDER</span>';

        const d = document.createElement('div');
        d.className = `msg ${role === 'user' ? 'user' : 'ai'}`;
        d.innerHTML = `
          <div class="msg-label">JARVIS ${badgeHtml}</div>
          <div class="msg-bubble">${text}</div>
        `;
        messagesEl.appendChild(d);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return;
      }
      _orig.apply(this, arguments);
    };
  }

  // ── PANEL FUNCTIONS (exposed on window for inline onclick) ──────
  function openReminderPanel() {
    renderReminderPanel();
    document.getElementById('jrvReminderPanel').classList.add('open');
  }

  window._jrvClosePanel = function () {
    document.getElementById('jrvReminderPanel').classList.remove('open');
  };

  window._jrvAddFromPanel = async function () {
    const input = document.getElementById('jrvNewReminder');
    const val   = input.value.trim();
    if (!val) return;
    input.value = '';
    document.getElementById('jrvReminderPanel').classList.remove('open');

    // Re-use the same flow as voice/text — show in chat + confirm
    if (typeof window.addMsg === 'function') window.addMsg('user', val);
    await handleReminderRequest(val);
  };

  window._jrvDeleteReminder = function (id) {
    deleteReminder(id);
  };

  function renderReminderPanel() {
    const list = document.getElementById('jrvReminderList');
    if (!list) return;
    const reminders = loadReminders();
    list.innerHTML = '';

    if (reminders.length === 0) {
      list.innerHTML = '<div class="jrv-empty">NO REMINDERS SET YET</div>';
      return;
    }

    // Sort: upcoming first, then fired
    const sorted = [...reminders].sort((a, b) => {
      if (a.fired !== b.fired) return a.fired ? 1 : -1;
      return new Date(a.isoTime) - new Date(b.isoTime);
    });

    sorted.forEach(r => {
      const item = document.createElement('div');
      item.className = `jrv-reminder-item${r.fired ? ' fired' : ''}`;
      item.innerHTML = `
        <div class="jrv-reminder-info">
          <div class="jrv-reminder-label">${r.label}</div>
          <div class="jrv-reminder-time">⏰ ${r.displayTime}</div>
          ${r.fired ? '<div class="jrv-reminder-fired">✓ FIRED</div>' : ''}
        </div>
        <button class="jrv-del-btn" onclick="window._jrvDeleteReminder(${r.id})">✕</button>
      `;
      list.appendChild(item);
    });
  }

  function updateReminderBadge() {
    const dot       = document.getElementById('jrvReminderDot');
    const pending   = loadReminders().filter(r => !r.fired);
    if (dot) dot.style.display = pending.length > 0 ? 'block' : 'none';
  }

  // ── BOOT ───────────────────────────────────────────────────────
  function boot() {
    requestNotifPermission();
    injectUI();
    installInterceptor();
    startReminderChecker();
    updateReminderBadge();
    console.log('[JARVIS Reminders] Engine loaded ✓');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    // DOM already ready (script loaded late)
    setTimeout(boot, 100);
  }

})();