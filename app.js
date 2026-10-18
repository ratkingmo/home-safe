const MOM_TEXT = { ot:'is staying late for OT', leaving:'is on the way home', home:'made it home safe' };
// Only accept a plain name from the network: letters, spaces, apostrophes. No numbers or links.
const NAME_RE = /^([A-Za-z][A-Za-z'-]{0,19}) (?:is staying late|is on the way home|made it home)$/;
const ACTIONS = {
  ot:      { emoji:'🌙', label:'Staying for OT', sub:'Working late tonight', tags:'crescent_moon',
             title:n=>`${n} is staying late`, msg:t=>`Staying for overtime tonight. I’ll let you know when I leave. (${t})` },
  leaving: { emoji:'🚗', label:'Heading home',   sub:'Just left work',       tags:'car',
             title:n=>`${n} is on the way home`, msg:t=>`Just left work, heading home now. (${t})` },
  home:    { emoji:'🏠', label:'Home safe',      sub:'Made it home',         tags:'house',
             title:n=>`${n} made it home`, msg:t=>`Home safe! Love you 💛 (${t})` }
};
const TAG_TO_KEY = { crescent_moon:'ot', car:'leaving', house:'home' };
const $ = id => document.getElementById(id);
const NTFY = 'https://ntfy.sh/';

function load(k, f){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; }catch{ return f; } }
function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }

const CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';   // no look-alikes (l/1, o/0)
function newTopic(){
  let out = '';
  while (out.length < 20){
    const b = crypto.getRandomValues(new Uint8Array(32));
    for (const x of b) if (x < 248 && out.length < 20) out += CHARS[x % 31];   // no modulo bias
  }
  return 'homesafe-' + out;
}
const validTopic = t => /^[a-z0-9_-]{8,64}$/.test(t);

let settings = load('hs-settings', null);
if (!settings || typeof settings !== 'object') settings = {};
settings = {
  role: ['me','mom'].includes(settings.role) ? settings.role : null,
  name: typeof settings.name === 'string' ? ((settings.name.match(/^[A-Za-z][A-Za-z'-]{0,19}/) || [''])[0]) : '',
  topic: typeof settings.topic === 'string' && validTopic(settings.topic) ? settings.topic : ''
};
if (settings.role === 'me' && !settings.topic) settings.topic = newTopic();
let history = (Array.isArray(load('hs-history', [])) ? load('hs-history', []) : []).filter(h => h && Object.hasOwn(ACTIONS, h.k) && Number.isFinite(h.at));       // sender's own log
let sonName = (typeof load('hs-son', '') === 'string' && /^[A-Za-z][A-Za-z'-]{0,19}$/.test(load('hs-son',''))) ? load('hs-son','') : '';
let sonNameAt = Number(load('hs-sonat', 0)) || 0;
let momLog = [].concat(load('hs-momlog', [])).filter(m => m && Object.hasOwn(MOM_TEXT, m.k) && Number.isFinite(m.at));         // updates Mom's side has seen

const timeStr = d => new Date(d).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
function dayStr(d){
  const x = new Date(d), now = new Date();
  if (x.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate()-1);
  if (x.toDateString() === y.toDateString()) return 'Yesterday';
  return x.toLocaleDateString([], { month:'short', day:'numeric' });
}
function agoStr(ms){
  const m = Math.round((Date.now()-ms)/60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m/60); return h === 1 ? '1 hour ago' : `${h} hours ago`;
}
const DAY = 86400000;
function dayHeader(d){
  const x = new Date(d), now = new Date();
  if (x.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate()-1);
  if (x.toDateString() === y.toDateString()) return 'Yesterday';
  const sameYear = x.getFullYear() === now.getFullYear();
  return x.toLocaleDateString([], { weekday:'long', month:'short', day:'numeric', ...(sameYear ? {} : { year:'numeric' }) });
}
function renderDays(list, showVia){
  if (!list.length) return '<p class="empty">Nothing yet.</p>';
  const groups = [];
  for (const h of list.slice(0,100)){
    const key = new Date(h.at).toDateString();
    if (!groups.length || groups[groups.length-1].key !== key) groups.push({ key, at:h.at, items:[] });
    groups[groups.length-1].items.push(h);
  }
  return groups.slice(0,7).map(g => {
    const today = g.key === new Date().toDateString();
    return `<div class="day${today ? ' today' : ''}"><h3>${dayHeader(g.at)}</h3>` + g.items.map(h => {
      const a = ACTIONS[h.k];
      const via = showVia ? `<small>${h.via === 'push' ? 'Sent as notification' : 'Sent as text'}</small>` : '';
      return `<div class="entry" data-k="${h.k}"><span class="ic">${a.emoji}</span><span class="what">${a.label}${via}</span><span class="when">${timeStr(h.at)}</span></div>`;
    }).join('') + '</div>';
  }).join('');
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const setScene = (k, at) => $('scene').dataset.state = (at && Date.now()-at < 16*3600*1000) ? k : 'idle';

let toastTimer;
function toast(msg, ms=2800){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'), ms); }

/* ---------- screens ---------- */
function show(){
  const r = settings.role;
  $('vWelcome').classList.toggle('on', !r);
  $('vMe').classList.toggle('on', r === 'me');
  $('vMom').classList.toggle('on', r === 'mom');
  $('hdr').style.display = r ? 'flex' : 'none';
  $('scene').style.display = r ? 'block' : 'none';
  const needs = r === 'me' ? !settings.name : r === 'mom' ? !settings.topic : false;
  $('setupNote').style.display = needs ? 'block' : 'none';
  $('setupText').textContent = r === 'mom' ? 'Add the channel name your son sent you to start seeing updates.' : 'Add your first name and send Mom the setup steps.';
  if (r === 'me'){ warm(); processQueue(); renderMe(); renderAsk(); renderPushCard(); checkAsks(); refreshPush(); }
  if (r === 'mom'){ renderMom(); loop(); refreshPush(); }
}
$('pickMe').onclick = () => { settings.role='me'; if(!settings.topic) settings.topic=newTopic(); save('hs-settings',settings); show(); openSettings(); };
$('pickMom').onclick = () => { settings.role='mom'; settings.topic=''; save('hs-settings',settings); show(); openSettings(); };

/* ---------- sender side ---------- */
function renderMe(){
  $('actions').innerHTML = Object.entries(ACTIONS).map(([k,a]) =>
    `<button class="act" data-k="${k}"><span class="em">${a.emoji}</span><span><strong>${a.label}</strong><small>${a.sub}</small></span></button>`).join('');
  document.querySelectorAll('#actions .act').forEach(b => b.onclick = () => { b.classList.add('done'); setTimeout(() => b.classList.remove('done'), 600); send(b.dataset.k); });
  const last = history[0];
  if (last){
    $('status').innerHTML = `Mom last heard: <b>${ACTIONS[last.k].label}</b>, ${dayStr(last.at).toLowerCase()} at ${timeStr(last.at)}`;
    setScene(last.k, last.at);
  } else { $('status').textContent = 'Tap a button to let Mom know.'; setScene(); }
  $('history').innerHTML = renderDays(history, true);
}

/* Warm-up: on weak signal the slow part isn't the 300-byte message, it's the setup
   (DNS lookup → TCP connect → TLS encryption handshake). We do that setup as soon as the
   app opens or you touch the screen, so when you tap a button only the message has to go.
   The ping is ~100 bytes and only fires if the app hasn't talked to ntfy in the last 25s. */
let lastNet = 0;
function warm(){
  if (settings.role !== 'me' || !navigator.onLine || Date.now() - lastNet < 25000) return;
  lastNet = Date.now();
  fetch(`${NTFY}v1/health`, { cache:'no-store' }).catch(() => {});
}
addEventListener('pointerdown', warm, { passive:true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') warm(); });

const askTopic = () => settings.topic + '-ask';   // Mom → Gabriel channel
async function pushNtfy(title, message, tags, topic = settings.topic, timeoutMs = 8000){
  if (!validTopic(topic)) return false;
  lastNet = Date.now();
  const url = `${NTFY}${encodeURIComponent(topic)}?title=${encodeURIComponent(title)}&tags=${tags}`;
  const ctrl = new AbortController(); const timer = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{ const res = await fetch(url, { method:'POST', body:message, signal:ctrl.signal }); return res.ok; }
  catch{ return false; } finally{ clearTimeout(timer); }
}

/* ---------- Sending with automatic retry (no texts) ----------
   Taps go into a small queue saved on the phone. The app keeps retrying until ntfy confirms,
   backing off (2s, 4s, 8s… up to 30s) so it doesn't hammer a weak signal. It retries instantly
   when signal comes back. If you close the app, it picks up where it left off next time.
   Each send carries the time you tapped (tag at-<time>), so Mom sees when you actually left
   and a duplicate from a retry is ignored. */
let queue = [].concat(load('hs-queue', [])).filter(q => q && Object.hasOwn(ACTIONS, q.k) && Number.isFinite(q.at)).slice(0,5);
let working = false, wake = null;
const saveQueue = () => save('hs-queue', queue);

function send(k){
  if (queue.length >= 5){ toast('Still trying to send earlier updates. Hang tight.'); return; }
  queue.push({ k, at:Date.now() }); saveQueue(); processQueue();
}
function panel(state, item, info){
  const p = $('sendPanel'), bar = $('spBar'), fill = $('spFill');
  if (state === 'off'){ p.className = 'sendpanel'; return; }
  const a = ACTIONS[item.k], more = queue.length > 1 ? ` (+${queue.length-1} more)` : '';
  p.className = 'sendpanel on' + (state === 'wait' ? ' waiting' : '');
  bar.className = 'bar' + (state === 'sending' ? ' indet' : state === 'wait' ? ' wait' : ' ok');
  fill.style.transition = 'none'; fill.style.width = state === 'sending' ? '' : '0%';
  if (state === 'sending'){
    $('spText').textContent = `${a.emoji} Sending “${a.label}”…${more}`;
    $('spSub').textContent = info ? `Attempt ${info + 1}` : 'Talking to Mom’s phone';
  } else if (state === 'wait'){
    $('spText').textContent = navigator.onLine ? `${a.emoji} Weak signal. Will keep trying${more}` : `${a.emoji} No signal. Sends when it’s back${more}`;
    $('spSub').textContent = `Retrying in ${Math.round(info/1000)}s · tapped at ${timeStr(item.at)}`;
    requestAnimationFrame(() => { fill.style.transition = `width ${info}ms linear`; fill.style.width = '100%'; });
  } else {
    $('spText').textContent = `${a.emoji} Sent to Mom 💛`; $('spSub').textContent = `Tapped at ${timeStr(item.at)}`;
  }
}
function waitOrWake(ms){
  return new Promise(ok => { const t = setTimeout(done, ms); function done(){ clearTimeout(t); wake = null; ok(); } wake = done; });
}
async function processQueue(){
  if (working || settings.role !== 'me') return; working = true;
  let attempt = 0;
  while (queue.length){
    const item = queue[0], a = ACTIONS[item.k];
    if (Date.now() - item.at > 12*3600*1000){   // too old to matter anymore
      queue.shift(); saveQueue(); toast(`“${a.label}” couldn’t send for 12 hours, so it was dropped.`, 4500); continue;
    }
    panel('sending', item, attempt);
    const ok = navigator.onLine && await pushNtfy(a.title(settings.name || 'Your son'), a.msg(timeStr(item.at)), `${a.tags},at-${Math.floor(item.at/1000)}`, settings.topic, 15000);
    if (queue[0] !== item) { attempt = 0; continue; }   // cancelled while sending
    if (ok){
      queue.shift(); saveQueue(); log(item.k, item.at, 'push'); attempt = 0;
      panel('ok', item); await waitOrWake(1400);
    } else {
      attempt++;
      const delay = navigator.onLine ? Math.min(30000, 2000 * 2 ** Math.min(attempt - 1, 4)) : 30000;
      panel('wait', item, delay); await waitOrWake(delay);
    }
  }
  panel('off'); working = false;
}
$('spRetry').onclick = () => wake && wake();
$('spCancel').onclick = () => {
  if (!queue.length || !confirm(`Cancel sending “${ACTIONS[queue[0].k].label}”?`)) return;
  queue.shift(); saveQueue(); wake && wake();
};
addEventListener('online', () => wake && wake());   // signal's back → try right away
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible'){ if (wake) wake(); else if (queue.length) processQueue(); } });

// Mom's "Where are you at?" asks
let lastAsk = Number(load('hs-lastask', 0)) || 0;
function renderAsk(){
  const show = settings.role === 'me' && lastAsk && Date.now() - lastAsk < 12*3600*1000 && (!history[0] || history[0].at < lastAsk);
  $('askBanner').classList.toggle('on', !!show);
  if (show) $('askTime').textContent = `${dayHeader(lastAsk)} at ${timeStr(lastAsk)} · tap a button below to answer`;
}
function takeAsk(e){
  if (!e || e.event !== 'message' || !Array.isArray(e.tags) || !e.tags.includes('question') || !Number.isFinite(e.time)) return;
  const at = e.time * 1000; if (at > Date.now() + 5*60*1000 || at <= lastAsk) return;
  lastAsk = at; save('hs-lastask', lastAsk); renderAsk();
}
async function checkAsks(){
  if (settings.role !== 'me' || !validTopic(askTopic()) || !navigator.onLine) return;
  try{
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${NTFY}${encodeURIComponent(askTopic())}/json?poll=1&since=${sinceParam(lastAsk)}`, { signal:ctrl.signal, cache:'no-store' });
    clearTimeout(timer); if (!res.ok) return;
    const raw = await res.text(); if (raw.length > 500000) return;
    raw.trim().split('\n').slice(-50).forEach(l => { try{ takeAsk(JSON.parse(l)); }catch{} });
  }catch{}
}
setInterval(() => { if (settings.role === 'me' && document.visibilityState === 'visible') checkAsks(); }, 5*60*1000);

function log(k, at, via){ history.unshift({k,at,via}); history = history.slice(0,100); save('hs-history',history); renderMe(); renderAsk(); }

/* ---------- Mom side ---------- */
// Work schedule: Mon–Fri, 3 PM to midnight (Mom's phone time). Change here if the shift changes.
const SHIFT = { days:[1,2,3,4,5], start:15, end:24, label:'3 PM – 12 AM' };
function shiftStart(){   // start time of the shift happening right now, or null
  const n = new Date(), h = n.getHours() + n.getMinutes()/60;
  if (!SHIFT.days.includes(n.getDay()) || h < SHIFT.start || h >= SHIFT.end) return null;
  const s = new Date(n); s.setHours(SHIFT.start, 0, 0, 0); return s.getTime();
}

function renderMom(){
  const last = momLog[0], who = sonName || 'He', ss = shiftStart();
  if (ss && (!last || last.at < ss)){   // at work and nothing new yet this shift
    $('momBig').textContent = `💼 ${who} is at work`;
    $('momSub').textContent = `His shift is ${SHIFT.label}. Wait until it ends for an update.`;
    $('momAgo').textContent = last ? `Last update: ${ACTIONS[last.k].label}, ${dayHeader(last.at).toLowerCase()} at ${timeStr(last.at)}` : '';
    $('scene').dataset.state = 'work';
  } else if (last){
    $('momBig').textContent = `${ACTIONS[last.k].emoji} ${who} ${MOM_TEXT[last.k]}`;
    $('momSub').textContent = `${dayHeader(last.at)} at ${timeStr(last.at)}`;
    $('momAgo').textContent = agoStr(last.at);
    setScene(last.k, last.at);
  } else {
    $('momBig').textContent = 'No updates yet';
    $('momSub').textContent = settings.topic ? 'His next update will show up here.' : 'Tap ⚙️ and add the channel name to get started.';
    $('momAgo').textContent = ''; setScene();
  }
  $('momHistory').innerHTML = renderDays(momLog, false);
  renderPushCard(); renderAskBtn();
}

// Takes messages from ntfy, keeps only real, well-formed status updates. Returns how many were new.
// Reads the "tapped at" time a retried send carries (tag at-<seconds>). Only trusted if it's
// within 24h before ntfy received it, so a fake can't move updates into the future.
function tappedAt(tags, serverMs){
  const m = tags.map(x => typeof x === 'string' && /^at-(\d{9,10})$/.exec(x)).find(Boolean);
  if (!m) return null;
  const o = Number(m[1]) * 1000;
  return (o <= serverMs + 60*1000 && o >= serverMs - 24*3600*1000) ? o : null;
}
function ingest(events, maxAgeMs = 48*3600*1000){
  const seen = new Set(momLog.map(m => m.id)), dupes = new Set(momLog.map(m => m.k + '@' + m.at)), now = Date.now(); let added = 0;
  for (const e of events.slice(-200)){
    if (!e || e.event !== 'message' || typeof e.id !== 'string' || e.id.length > 64 || seen.has(e.id)) continue;
    if (!Array.isArray(e.tags) || !Number.isFinite(e.time)) continue;
    const server = e.time * 1000;
    if (server < now - maxAgeMs || server > now + 5*60*1000) continue;   // ignore impossible times
    const t = e.tags.find(x => typeof x === 'string' && Object.hasOwn(TAG_TO_KEY, x));
    if (!t) continue;   // skip tests and anything else
    const k = TAG_TO_KEY[t], orig = tappedAt(e.tags, server), at = orig ?? server;
    seen.add(e.id);
    if (orig && dupes.has(k + '@' + at)) continue;   // same tap delivered twice by a retry
    const m = typeof e.title === 'string' && e.title.match(NAME_RE);
    if (m && at >= sonNameAt){ sonName = m[1]; sonNameAt = at; save('hs-son', sonName); save('hs-sonat', at); }
    momLog.push({ id:e.id, k, at }); dupes.add(k + '@' + at); added++;
  }
  if (added){ momLog.sort((a,b) => b.at - a.at); momLog = momLog.slice(0,100); save('hs-momlog', momLog); }
  return added;
}

let primed = false;   // don't celebrate old messages on first load
function gotNew(n){
  renderMom();
  if (n && primed){
    const c = $('momCard'); c.classList.remove('fresh'); void c.offsetWidth; c.classList.add('fresh');
    toast(`New update from ${sonName || 'your son'} 💛`);
  }
  primed = true;
}

async function poll(manual){
  if (settings.role !== 'mom' || !validTopic(settings.topic)) return;
  if (!navigator.onLine){ setLive(); if (manual) toast('No internet right now. Showing the last update.'); return; }
  try{
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${NTFY}${encodeURIComponent(settings.topic)}/json?poll=1&since=${sinceParam(momLog[0]?.at)}`, { signal:ctrl.signal, cache:'no-store' });
    clearTimeout(timer);
    if (!res.ok) throw 0;
    const raw = await res.text(); if (raw.length > 2000000) throw 0;   // refuse giant floods
    const events = raw.trim().split('\n').filter(Boolean).map(l => { try{ return JSON.parse(l); }catch{ return null; } });
    gotNew(ingest(events));
    setLive();
    if (manual) toast('Up to date');
  }catch{ setLive(); if (manual) toast('Couldn’t check for updates. Try again in a bit.'); }
}

/* ---------- Network plan (lightest option first) ----------
   1. Notifications on: ntfy pushes to the phone through Apple. Zero checking needed;
      the app only checks once when opened (plus a safety check every 10 min).
   2. No notifications + Mom is actively using the app: live connection (instant, tiny pings).
   3. Idle 2+ min: live connection closes, check once a minute.
   4. Idle 10+ min: check every 5 minutes.
   Closed or in the background: iPhone pauses the app, so it uses no data at all. */
let es = null, lastActive = Date.now();
let pushOn = load('hs-push', false) === true;
const idleFor = () => Date.now() - lastActive;
function wantLive(){ return !pushOn && idleFor() < 2*60*1000; }
function connectLive(){
  if (!wantLive()){ if (es){ es.close(); es = null; } return; }
  if (settings.role !== 'mom' || !validTopic(settings.topic) || !navigator.onLine || typeof EventSource === 'undefined') return;
  if (es && es.readyState !== 2) return;
  try{
    es = new EventSource(`${NTFY}${encodeURIComponent(settings.topic)}/sse?since=${sinceParam(momLog[0]?.at)}`);
    es.onopen = () => setLive();
    es.addEventListener('keepalive', () => setLive());
    es.onmessage = ev => { if (typeof ev.data !== 'string' || ev.data.length > 20000) return; let e; try{ e = JSON.parse(ev.data); }catch{ return; } gotNew(ingest([e])); };
    es.onerror = () => { if (es && es.readyState === 2) es = null; setLive(); };
  }catch{ es = null; }
}
function pollDelay(){
  if (pushOn) return 10*60*1000;
  const idle = idleFor();
  if (idle >= 10*60*1000) return 5*60*1000;
  if (idle >= 2*60*1000) return 60*1000;
  if (es && es.readyState === 1) return 5*60*1000;
  const c = navigator.connection;   // only some phones share this (not iPhone)
  return (c && (c.type === 'cellular' || c.saveData || /2g|3g/.test(c.effectiveType || ''))) ? 60000 : 20000;
}
function setLive(){
  const p = $('livePill'), t = $('liveText');
  if (!navigator.onLine){ p.className = 'live off'; t.textContent = 'Offline · showing last update'; return; }
  if (pushOn){ p.className = 'live on'; t.textContent = 'Live'; return; }
  if (es && es.readyState === 1){ p.className = 'live on'; t.textContent = 'Live'; return; }
  const d = pollDelay();
  p.className = 'live ' + (idleFor() >= 2*60*1000 ? 'rest' : 'poll');
  t.textContent = idleFor() >= 2*60*1000 ? `Resting · checks every ${d >= 60000 ? d/60000 + ' min' : d/1000 + 's'}` : `Checking every ${d/1000}s`;
}
let pollTimer;
// Ask ntfy only for messages newer than the newest one we have (usually: nothing → tiny reply).
function sinceParam(lastMs){
  const floor = Math.floor(Date.now()/1000) - 12*3600;
  return lastMs ? Math.max(floor, Math.floor(lastMs/1000)) : '12h';
}

/* Inbox: sw.js saves every update the moment its notification arrives (even with the app closed).
   We pull those into the history here, so the log has no gaps. */
function openInbox(){
  return new Promise((ok, bad) => {
    const r = indexedDB.open('homesafe', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('inbox', { keyPath:'id' });
    r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
  });
}
async function drainInbox(){
  if (settings.role !== 'mom' || typeof indexedDB === 'undefined') return;
  try{
    const db = await openInbox();
    const items = await new Promise((ok, bad) => { const q = db.transaction('inbox').objectStore('inbox').getAll(); q.onsuccess = () => ok(q.result || []); q.onerror = () => bad(q.error); });
    if (items.length){
      gotNew(ingest(items.slice(-200), 30*24*3600*1000));   // inbox can hold older ones (up to 30 days)
      await new Promise(ok => { const t = db.transaction('inbox','readwrite'); t.objectStore('inbox').clear(); t.oncomplete = ok; t.onerror = ok; });
    }
    db.close();
  }catch{}
}

async function loop(){
  clearTimeout(pollTimer);
  if (settings.role === 'mom' && document.visibilityState === 'visible'){ await drainInbox(); await poll(); connectLive(); renderMom(); setLive(); }
  pollTimer = setTimeout(loop, pollDelay());
}
// Any touch wakes it back up to full speed.
['pointerdown','scroll','keydown'].forEach(ev => addEventListener(ev, () => {
  const wasIdle = idleFor() >= 2*60*1000; lastActive = Date.now();
  if (wasIdle && settings.role === 'mom'){ setLive(); loop(); }
}, { passive:true }));
// Updates handed over by notifications (from sw.js) land here instantly.
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', ev => {
  if (settings.role === 'me' && ev.data && ev.data.type === 'ntfy' && ev.data.msg){ takeAsk(ev.data.msg); return; }
  if (settings.role === 'mom' && ev.data && ev.data.type === 'saved'){ drainInbox(); return; }
  if (settings.role === 'mom' && ev.data && ev.data.type === 'ntfy' && ev.data.msg && typeof ev.data.msg === 'object') gotNew(ingest([ev.data.msg]));
});

/* ---------- Notifications (Web Push through ntfy, no extra app) ---------- */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
function b64ToBytes(s){ s = s.replace(/-/g,'+').replace(/_/g,'/'); s += '='.repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
// Each step reports where it failed, so a problem can be pinned down from a screenshot.
const step = (code, fn) => fn().catch(err => { throw Object.assign(new Error(code), { detail: err ? ((err.name && err.name !== 'Error' && err.name !== 'TypeError') ? err.name : String(err.message || err.name || '')).slice(0, 40) : '' }); });
/* ntfy's public notification key lives in https://ntfy.sh/config.js. ntfy doesn't allow other
   sites to read that file with fetch (that was the "key / Load failed" error), but a <script> tag
   is allowed to load it. So we load it once, only when you tap the button, read just the key,
   remove the script, and keep the key on the phone. The security rules only allow that one exact file. */
async function ntfyKey(fresh){
  const saved = load('hs-vapid', '');
  if (!fresh && typeof saved === 'string' && /^[A-Za-z0-9_-]{40,120}$/.test(saved)) return saved;
  return step('key', () => new Promise((ok, bad) => {
    const prev = window.config;
    const s = document.createElement('script');
    s.src = `${NTFY}config.js`;
    const done = () => { s.remove(); try{ window.config = prev; }catch{} };
    s.onload = () => {
      const k = window.config && window.config.web_push_public_key; done();
      if (typeof k === 'string' && /^[A-Za-z0-9_-]{40,120}$/.test(k)){ save('hs-vapid', k); ok(k); }
      else bad(new Error('no key in file'));
    };
    s.onerror = () => { done(); bad(new Error('script blocked')); };
    setTimeout(() => { done(); bad(new Error('timeout')); }, 12000);
    document.head.appendChild(s);
  }));
}
const pushTopic = () => settings.role === 'me' ? askTopic() : settings.topic;
async function registerPush(){
  const reg = await step('sw', () => navigator.serviceWorker.ready);
  let lastStatus = '';
  for (let attempt = 0; attempt < 2; attempt++){
    let sub = await step('sub-get', () => reg.pushManager.getSubscription());
    if (!sub){ const key = await ntfyKey(attempt > 0); sub = await step('apple', () => reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64ToBytes(key) })); }
    const k = sub.toJSON().keys || {};
    // Sent as plain text (no JSON content-type header) so the browser skips the extra CORS preflight round trip.
    const res = await step('ntfy-net', () => fetch(`${NTFY}v1/webpush`, { method:'POST',
      body: JSON.stringify({ endpoint:sub.endpoint, auth:k.auth, p256dh:k.p256dh, topics:[pushTopic()] }) }));
    if (res.ok) return true;
    lastStatus = String(res.status);
    await sub.unsubscribe().catch(()=>{});   // stale key? start fresh once
  }
  throw Object.assign(new Error('ntfy-' + lastStatus), { detail:'' });
}
function renderPushCard(){
  const me = settings.role === 'me', P = me ? 'mePush' : 'push';
  const card = $(P + 'Card'), text = $(P + 'Text'), btn = $(P + 'Btn');
  $(me ? 'pushCard' : 'mePushCard').style.display = 'none';
  const show = settings.role && validTopic(settings.topic) && !pushOn;
  card.style.display = show ? 'block' : 'none';
  if (!show) return;
  btn.style.display = '';
  const errCode = load('hs-pusherr', '');
  text.textContent = (me ? 'Get a ping when Mom asks where you’re at.' : 'Get a pop-up on this phone every time he sends an update.') + (typeof errCode === 'string' && errCode ? ` (Last try failed: ${errCode})` : '');
  if (!pushSupported()){
    text.textContent = 'To get pop-ups, open Home Safe from its home screen icon (needs iOS 16.4 or newer). Or use the ntfy app, steps in ⚙️.';
    btn.style.display = 'none';
  } else if (Notification.permission === 'denied'){
    text.textContent = 'Notifications are blocked. Turn them on in iPhone Settings → Notifications → Home Safe.';
    btn.style.display = 'none';
  }
}
async function turnOnPush(){
  try{
    const perm = await Notification.requestPermission();   // must be first, straight from the tap
    if (perm !== 'granted'){ renderPushCard(); return; }
    toast('Turning on notifications…', 9000);
    await registerPush();
    pushOn = true; save('hs-push', true); save('hs-pusherr', ''); toast('Notifications on 💛'); if (es){ es.close(); es = null; }
  }catch(err){
    const code = `${err && err.message || 'unknown'}${err && err.detail ? ' / ' + err.detail : ''}`.slice(0, 80);
    save('hs-pusherr', code);
    toast('Couldn’t turn on notifications. Screenshot the error code under the button.', 5000);
  }
  renderPushCard(); if (settings.role === 'mom') loop();
}
$('pushBtn').onclick = turnOnPush;
$('mePushBtn').onclick = turnOnPush;
// Fully drop this phone's notification subscription (used when the channel or role changes,
// so an old, possibly leaked channel can never reach this phone again).
async function resetPush(){
  pushOn = false; save('hs-push', false);
  try{
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    fetch(`${NTFY}v1/webpush`, { method:'DELETE', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ endpoint:sub.endpoint }) }).catch(()=>{});
    await sub.unsubscribe();
  }catch{}
  renderPushCard();
}
// Re-confirm with ntfy each time the app opens so the subscription never quietly expires.
async function refreshPush(){
  if (!pushOn || !pushSupported()) return;
  if (Notification.permission !== 'granted'){ pushOn = false; save('hs-push', false); renderPushCard(); return; }
  try{ await registerPush(); }catch{ /* keep trying next open; live/polling still covers it */ }
}

$('refreshBtn').onclick = () => poll(true);
const ASK_COOLDOWN = 2*60*1000;
function renderAskBtn(){
  const asked = Number(load('hs-asked', 0)) || 0, wait = asked + ASK_COOLDOWN - Date.now();
  $('askLabel').textContent = 'Where are you at?';
  $('askBtn').disabled = wait > 0;
  $('askedNote').textContent = asked && Date.now() - asked < 12*3600*1000
    ? `You asked at ${timeStr(asked)}${wait > 0 ? ' · can ask again in a minute or two' : ''}`
    : 'Sends him a quick notification';
}
$('askBtn').onclick = () => {
  $('askDlgText').textContent = `This will send ${sonName || 'him'} a notification asking where he’s at.`;
  $('askDlg').showModal();
};
$('askNo').onclick = () => $('askDlg').close();
$('askYes').onclick = async () => {
  $('askDlg').close();
  if ((Number(load('hs-asked', 0)) || 0) + ASK_COOLDOWN > Date.now()) return;
  toast('Sending…', 9000);
  const ok = navigator.onLine && await pushNtfy('Mom is asking where you’re at', 'Tap to send her an update 💛', 'question', askTopic());
  if (ok){ save('hs-asked', Date.now()); toast(`Sent! ${sonName || 'He'} will get a notification.`); }
  else toast('Couldn’t send right now. Check your internet and try again.', 4000);
  renderAskBtn();
};
// Re-check the clock every minute (no network) so "at work" switches on/off on time.
setInterval(() => { if (settings.role === 'mom' && document.visibilityState === 'visible') renderMom(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible'){ loop(); checkAsks(); } });
addEventListener('online', loop);
addEventListener('offline', () => setLive());

/* ---------- settings ---------- */
function openSettings(){
  const me = settings.role === 'me';
  $('sMe').style.display = me ? 'block' : 'none';
  $('sMom').style.display = me ? 'none' : 'block';
  $('name').value = settings.name;
  $('topic').value = settings.topic; $('momTopic').value = settings.topic; $('askTopicShow').textContent = askTopic();
  $('settings').showModal();
}
$('openSettings').onclick = openSettings; $('setupBtn').onclick = openSettings;
$('settings').addEventListener('close', () => {
  if (settings.role === 'me'){ settings.name = (($('name').value.trim().match(/^[A-Za-z][A-Za-z'-]{0,19}/) || [''])[0]); }
  if (settings.role === 'mom'){
    const t = $('momTopic').value.trim().toLowerCase();
    if (t && !validTopic(t)){ toast('That channel name doesn’t look right. Copy it again from the text.', 4000); }
    else if (t !== settings.topic){ settings.topic = t; momLog = []; save('hs-momlog', momLog); if (es){ es.close(); es = null; } primed = false; resetPush(); }
  }
  save('hs-settings', settings); show();
});
$('copyTopic').onclick = async () => { try{ await navigator.clipboard.writeText(settings.topic); toast('Channel name copied'); }catch{ $('topic').select(); toast('Press and hold to copy'); } };
$('shareBtn').onclick = async () => {
  const link = location.origin + location.pathname;
  const text = `Hi Mom! I made us an app so you know when I'm working late or headed home 💛\n\n1. Open this link in Safari: ${link}\n2. Tap the Share button, then "Add to Home Screen"\n3. Open Home Safe from your home screen, tap "I'm Mom," and paste this:\n\n${settings.topic}\n\nFor pop-up notifications, also get the free "ntfy" app, tap +, and paste the same thing.`;
  try{ if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('Setup steps copied. Paste them in a text to Mom.'); } }catch{}
};
$('testBtn').onclick = async () => {
  toast('Sending test…', 9000);
  const ok = navigator.onLine && await pushNtfy(`Test from ${$('name').value.trim() || 'your son'}`, 'If you can see this, it’s working! 💛', 'wave');
  toast(ok ? 'Test sent. Ask Mom if she got it.' : 'Couldn’t reach the internet. Try again with better signal.', 3500);
};
$('clearBtn').onclick = () => {
  if (!confirm('Clear the list of recent updates?')) return;
  if (settings.role === 'me'){ history = []; save('hs-history', history); } else { momLog = []; save('hs-momlog', momLog); }
  show();
};
$('newChan').onclick = () => {
  if (!confirm('Make a new private channel? Mom will need the new name, so send her the setup steps again after.')) return;
  settings.topic = newTopic(); save('hs-settings', settings); $('topic').value = settings.topic; $('askTopicShow').textContent = askTopic(); lastAsk = 0; save('hs-lastask', 0); resetPush(); toast('New channel made. Now tap “Send Mom the setup steps.”', 4000);
};
$('switchRole').onclick = () => { if (confirm('Switch who uses this phone?')){ settings.role = null; save('hs-settings', settings); resetPush(); $('settings').close(); show(); } };

show();
/* ---------- Version + updates ---------- */
const BUILD = 15;   // must match sw.js
$('buildTag').textContent = `Build ${BUILD}`;
if ('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js', { updateViaCache:'none' }).then(reg => reg.update()).catch(()=>{});
  // When a new build finishes installing, reload once so it shows up right away.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || queue.length || $('settings').open || $('askDlg').open) return;
    reloaded = true; location.reload();
  });
}
// Tap "Build N" to check for an update by hand.
$('buildTag').onclick = async () => {
  if (!('serviceWorker' in navigator) || !navigator.onLine){ toast('Can’t check for updates right now.'); return; }
  toast('Checking for updates…', 6000);
  try{
    const reg = await navigator.serviceWorker.getRegistration(); await reg?.update();
    const res = await fetch('./app.js', { cache:'no-cache' }); const m = (await res.text()).match(/const BUILD = (\d+)/);
    const latest = m ? Number(m[1]) : BUILD;
    if (latest > BUILD){ toast(`Build ${latest} found. Updating…`); setTimeout(() => location.reload(), 1200); }
    else toast(`You’re on the latest (Build ${BUILD}).`);
  }catch{ toast('Couldn’t check right now. Try again in a bit.'); }
};
