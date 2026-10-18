const MOM_TEXT = { ot:'Staying late for OT', leaving:'On the way home', home:'Made it home safe' };
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

const DEFAULTS = { role:null, name:'', phone:'', topic:'' };
let settings = load('hs-settings', null);
if (!settings || typeof settings !== 'object') settings = {};
settings = {
  role: ['me','mom'].includes(settings.role) ? settings.role : null,
  name: typeof settings.name === 'string' ? settings.name.slice(0,40) : '',
  phone: typeof settings.phone === 'string' ? settings.phone.slice(0,30) : '',
  topic: typeof settings.topic === 'string' && validTopic(settings.topic) ? settings.topic : ''
};
if (settings.role === 'me' && !settings.topic) settings.topic = newTopic();
let history = (Array.isArray(load('hs-history', [])) ? load('hs-history', []) : []).filter(h => h && Object.hasOwn(ACTIONS, h.k) && Number.isFinite(h.at));       // sender's own log
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
  const needs = r === 'me' ? !settings.phone : r === 'mom' ? !settings.topic : false;
  $('setupNote').style.display = needs ? 'block' : 'none';
  $('setupText').textContent = r === 'mom' ? 'Add the channel name your son sent you to start seeing updates.' : 'Add Mom’s number and send her the setup steps.';
  if (r === 'me') renderMe();
  if (r === 'mom'){ renderMom(); poll(); }
}
$('pickMe').onclick = () => { settings.role='me'; if(!settings.topic) settings.topic=newTopic(); save('hs-settings',settings); show(); openSettings(); };
$('pickMom').onclick = () => { settings.role='mom'; settings.topic=''; save('hs-settings',settings); show(); openSettings(); };

/* ---------- sender side ---------- */
function renderMe(){
  $('actions').innerHTML = Object.entries(ACTIONS).map(([k,a]) =>
    `<button class="act" data-k="${k}"><span class="em">${a.emoji}</span><span><strong>${a.label}</strong><small>${a.sub}</small></span></button>`).join('');
  document.querySelectorAll('#actions .act').forEach(b => b.onclick = () => send(b.dataset.k, b));
  const last = history[0];
  if (last){
    $('status').innerHTML = `Mom last heard: <b>${ACTIONS[last.k].label}</b>, ${dayStr(last.at).toLowerCase()} at ${timeStr(last.at)}`;
    setScene(last.k, last.at);
  } else { $('status').textContent = 'Tap a button to let Mom know.'; setScene(); }
  $('history').innerHTML = history.length
    ? history.slice(0,15).map(h => `<li><span>${ACTIONS[h.k].emoji} ${ACTIONS[h.k].label}</span><span>${dayStr(h.at)}, ${timeStr(h.at)} · ${h.via==='push'?'notification':'text'}</span></li>`).join('')
    : `<li class="empty">Nothing sent yet.</li>`;
}

async function pushNtfy(title, message, tags){
  if (!validTopic(settings.topic)) return false;
  const url = `${NTFY}${encodeURIComponent(settings.topic)}?title=${encodeURIComponent(title)}&tags=${tags}`;
  const ctrl = new AbortController(); const timer = setTimeout(()=>ctrl.abort(), 8000);
  try{ const res = await fetch(url, { method:'POST', body:message, signal:ctrl.signal }); return res.ok; }
  catch{ return false; } finally{ clearTimeout(timer); }
}

let sending = false;
async function send(k, btn){
  if (sending) return; sending = true;
  const a = ACTIONS[k], now = Date.now(), t = timeStr(now), name = settings.name || 'Your son';
  btn.classList.add('busy'); toast('Sending…', 9000);
  const ok = navigator.onLine && await pushNtfy(a.title(name), a.msg(t), a.tags);
  btn.classList.remove('busy');
  if (ok){ log(k, now, 'push'); btn.classList.add('done'); setTimeout(()=>btn.classList.remove('done'),1600); toast('Sent to Mom 💛'); }
  else if (settings.phone){
    log(k, now, 'text'); toast('No internet, so opening a text to Mom instead. Just tap send.', 3500);
    setTimeout(() => { location.href = `sms:${settings.phone.replace(/[^\d+]/g,'')}?&body=${encodeURIComponent(`${a.emoji} ${a.msg(t)}`)}`; }, 700);
  } else toast('Couldn’t send. Add Mom’s number in Settings so texting can be the backup.', 4500);
  sending = false;
}
function log(k, at, via){ history.unshift({k,at,via}); history = history.slice(0,50); save('hs-history',history); renderMe(); }

/* ---------- Mom side ---------- */
function renderMom(){
  const last = momLog[0];
  if (last){
    const a = ACTIONS[last.k];
    $('momBig').textContent = `${a.emoji} ${MOM_TEXT[last.k]}`;
    $('momSub').textContent = '';
    $('momAgo').textContent = `${dayStr(last.at)} at ${timeStr(last.at)} · ${agoStr(last.at)}`;
    setScene(last.k, last.at);
  } else {
    $('momBig').textContent = 'No updates yet';
    $('momSub').textContent = settings.topic ? 'His next update will show up here.' : 'Tap ⚙️ and add the channel name to get started.';
    $('momAgo').textContent = ''; setScene();
  }
  $('momHistory').innerHTML = momLog.length
    ? momLog.slice(0,15).map(h => `<li><span>${ACTIONS[h.k].emoji} ${ACTIONS[h.k].label}</span><span>${dayStr(h.at)}, ${timeStr(h.at)}</span></li>`).join('')
    : `<li class="empty">Nothing yet.</li>`;
}

async function poll(manual){
  if (settings.role !== 'mom' || !validTopic(settings.topic)) return;
  if (!navigator.onLine){ if (manual) toast('No internet right now. Showing the last update.'); return; }
  try{
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${NTFY}${encodeURIComponent(settings.topic)}/json?poll=1&since=12h`, { signal:ctrl.signal, cache:'no-store' });
    clearTimeout(timer);
    if (!res.ok) throw 0;
    const raw = await res.text(); if (raw.length > 2000000) throw 0;   // refuse giant floods
    const lines = raw.trim().split('\n').filter(Boolean);
    const seen = new Set(momLog.map(m => m.id));
    const now = Date.now();
    for (const line of lines.slice(-200)){
      let e; try{ e = JSON.parse(line); }catch{ continue; }
      if (!e || e.event !== 'message' || typeof e.id !== 'string' || seen.has(e.id)) continue;
      if (!Array.isArray(e.tags) || !Number.isFinite(e.time)) continue;
      const at = e.time * 1000;
      if (at < now - 48*3600*1000 || at > now + 5*60*1000) continue;   // ignore impossible times
      const t = e.tags.find(x => typeof x === 'string' && Object.hasOwn(TAG_TO_KEY, x));
      if (!t) continue;   // skip tests and anything else
      momLog.push({ id:e.id, k:TAG_TO_KEY[t], at }); seen.add(e.id);
    }
    momLog.sort((a,b) => b.at - a.at); momLog = momLog.slice(0,50); save('hs-momlog', momLog);
    renderMom(); if (manual) toast('Up to date');
  }catch{ if (manual) toast('Couldn’t check for updates. Try again in a bit.'); }
}
$('refreshBtn').onclick = () => poll(true);
setInterval(() => { if (document.visibilityState === 'visible') { poll(); if (settings.role==='mom') renderMom(); } }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });

/* ---------- settings ---------- */
function openSettings(){
  const me = settings.role === 'me';
  $('sMe').style.display = me ? 'block' : 'none';
  $('sMom').style.display = me ? 'none' : 'block';
  $('name').value = settings.name; $('phone').value = settings.phone;
  $('topic').value = settings.topic; $('momTopic').value = settings.topic;
  $('settings').showModal();
}
$('openSettings').onclick = openSettings; $('setupBtn').onclick = openSettings;
$('settings').addEventListener('close', () => {
  if (settings.role === 'me'){ settings.name = $('name').value.trim().slice(0,40); settings.phone = $('phone').value.trim().slice(0,30); }
  if (settings.role === 'mom'){
    const t = $('momTopic').value.trim().toLowerCase();
    if (t && !validTopic(t)){ toast('That channel name doesn’t look right. Copy it again from the text.', 4000); }
    else if (t !== settings.topic){ settings.topic = t; momLog = []; save('hs-momlog', momLog); }
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
  settings.topic = newTopic(); save('hs-settings', settings); $('topic').value = settings.topic; toast('New channel made. Now tap “Send Mom the setup steps.”', 4000);
};
$('switchRole').onclick = () => { if (confirm('Switch who uses this phone?')){ settings.role = null; save('hs-settings', settings); $('settings').close(); show(); } };

show();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
