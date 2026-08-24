import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

type Tab = 'home' | 'calendar' | 'tasks' | 'notes' | 'profile';
type Theme = 'dark' | 'light' | 'system';
type EventItem = { id: string; title: string; date: string; time: string; location: string; reminder: boolean };
type TaskItem = { id: string; title: string; due: string; priority: 'Low' | 'Medium' | 'High'; done: boolean };
type NoteItem = { id: string; title: string; body: string; updatedAt: string };
type DraftKind = 'event' | 'task' | 'note' | null;
type Stored = { events: EventItem[]; tasks: TaskItem[]; notes: NoteItem[]; theme: Theme };

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  start(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };

const KEY = 'nova-planner-v4';
const pad = (n: number) => String(n).padStart(2, '0');
const keyFor = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 12); };
const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const pretty = (value: string) => value ? new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short' }).format(fromKey(value)) : 'Fără dată';
const readStore = (): Stored => {
  try { return JSON.parse(localStorage.getItem(KEY) || '') as Stored; }
  catch { return { events: [], tasks: [], notes: [], theme: 'dark' }; }
};
const notificationId = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash % 2147483000) + 1;
};

async function ensureNotifications() {
  if (!Capacitor.isNativePlatform()) return false;
  const current = await LocalNotifications.checkPermissions();
  if (current.display === 'granted') return true;
  return (await LocalNotifications.requestPermissions()).display === 'granted';
}
async function syncReminder(item: EventItem) {
  if (!Capacitor.isNativePlatform()) return;
  const id = notificationId(item.id);
  try { await LocalNotifications.cancel({ notifications: [{ id }] }); } catch { /* no old reminder */ }
  if (!item.reminder || !item.time) return;
  const at = new Date(`${item.date}T${item.time}:00`);
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return;
  if (!(await ensureNotifications())) return;
  await LocalNotifications.schedule({ notifications: [{ id, title: item.title, body: item.location ? `Acum · ${item.location}` : 'Programarea ta începe acum.', schedule: { at }, extra: { eventId: item.id } }] });
}

const emptyEvent = (): EventItem => ({ id: '', title: '', date: keyFor(), time: '09:00', location: '', reminder: true });
const emptyTask = (): TaskItem => ({ id: '', title: '', due: keyFor(), priority: 'Medium', done: false });
const emptyNote = (): NoteItem => ({ id: '', title: '', body: '', updatedAt: new Date().toISOString() });

export default function App() {
  const initial = readStore();
  const [events, setEvents] = useState(initial.events || []);
  const [tasks, setTasks] = useState(initial.tasks || []);
  const [notes, setNotes] = useState(initial.notes || []);
  const [theme, setTheme] = useState<Theme>(initial.theme || 'dark');
  const [tab, setTab] = useState<Tab>('home');
  const [selected, setSelected] = useState(keyFor());
  const [draftKind, setDraftKind] = useState<DraftKind>(null);
  const [eventDraft, setEventDraft] = useState<EventItem>(emptyEvent());
  const [taskDraft, setTaskDraft] = useState<TaskItem>(emptyTask());
  const [noteDraft, setNoteDraft] = useState<NoteItem>(emptyNote());
  const [toast, setToast] = useState('');
  const [novaOpen, setNovaOpen] = useState(false);
  const [novaText, setNovaText] = useState('');
  const [novaReply, setNovaReply] = useState('Salut! Sunt Nova. Îți pot rezuma ziua și pot crea rapid taskuri, note și programări.');

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify({ events, tasks, notes, theme })); }, [events, tasks, notes, theme]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(''), 2800); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    if (Capacitor.isNativePlatform() || !('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  const systemLight = window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
  const resolved = theme === 'system' ? (systemLight ? 'light' : 'dark') : theme;
  const today = keyFor();
  const todayEvents = events.filter((e) => e.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const openTasks = tasks.filter((t) => !t.done);
  const nextEvent = [...events].filter((e) => e.date >= today).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))[0];
  const month = useMemo(() => {
    const base = fromKey(selected); const y = base.getFullYear(); const m = base.getMonth();
    const days = new Date(y, m + 1, 0).getDate(); const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    return { y, m, days, offset };
  }, [selected]);

  const openNew = (kind: Exclude<DraftKind, null>) => {
    if (kind === 'event') setEventDraft(emptyEvent());
    if (kind === 'task') setTaskDraft(emptyTask());
    if (kind === 'note') setNoteDraft(emptyNote());
    setDraftKind(kind);
  };
  const editEvent = (item: EventItem) => { setEventDraft(item); setDraftKind('event'); };
  const editTask = (item: TaskItem) => { setTaskDraft(item); setDraftKind('task'); };
  const editNote = (item: NoteItem) => { setNoteDraft(item); setDraftKind('note'); };

  const saveEvent = async (e: FormEvent) => {
    e.preventDefault();
    const item = { ...eventDraft, id: eventDraft.id || uid(), title: eventDraft.title.trim() };
    if (!item.title) return;
    setEvents((all) => [...all.filter((x) => x.id !== item.id), item]);
    setDraftKind(null); setSelected(item.date); setToast('Programarea a fost salvată.');
    try { await syncReminder(item); } catch { setToast('Salvat. Notificarea nu a putut fi programată.'); }
  };
  const saveTask = (e: FormEvent) => {
    e.preventDefault(); const item = { ...taskDraft, id: taskDraft.id || uid(), title: taskDraft.title.trim() }; if (!item.title) return;
    setTasks((all) => [...all.filter((x) => x.id !== item.id), item]); setDraftKind(null); setToast('Task salvat.');
  };
  const saveNote = (e: FormEvent) => {
    e.preventDefault(); const item = { ...noteDraft, id: noteDraft.id || uid(), title: noteDraft.title.trim(), updatedAt: new Date().toISOString() }; if (!item.title) return;
    setNotes((all) => [item, ...all.filter((x) => x.id !== item.id)]); setDraftKind(null); setToast('Nota a fost salvată.');
  };
  const removeEvent = (id: string) => { setEvents((all) => all.filter((x) => x.id !== id)); if (Capacitor.isNativePlatform()) void LocalNotifications.cancel({ notifications: [{ id: notificationId(id) }] }); };

  const askNova = (value = novaText) => {
    const raw = value.trim(); if (!raw) return;
    const q = raw.toLocaleLowerCase('ro');
    const taskMatch = raw.match(/(?:task|sarcin[ăa])\s*[:\-]?\s*(.+)/i);
    const noteMatch = raw.match(/(?:not[ăa])\s*[:\-]?\s*(.+)/i);
    if (taskMatch) {
      const item = { ...emptyTask(), id: uid(), title: taskMatch[1].trim() }; setTasks((all) => [...all, item]); setNovaReply(`Am creat taskul „${item.title}”.`);
    } else if (noteMatch) {
      const item = { ...emptyNote(), id: uid(), title: noteMatch[1].trim(), body: noteMatch[1].trim() }; setNotes((all) => [item, ...all]); setNovaReply(`Am salvat nota „${item.title}”.`);
    } else if (q.includes('azi') || q.includes('program')) {
      setNovaReply(todayEvents.length ? `Azi ai ${todayEvents.length} programări: ${todayEvents.map((x) => `${x.time} ${x.title}`).join(', ')}.` : 'Azi nu ai programări.');
    } else if (q.includes('task')) {
      setNovaReply(openTasks.length ? `Ai ${openTasks.length} taskuri deschise. Prioritar: ${openTasks.find((x) => x.priority === 'High')?.title || openTasks[0].title}.` : 'Nu ai taskuri deschise.');
    } else setNovaReply('Poți spune „program azi”, „task: cumpărături” sau „notă: idee nouă”.');
    setNovaText('');
  };
  const startVoice = () => {
    const Ctor = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
    if (!Ctor) { setToast('Comanda vocală nu este disponibilă pe acest dispozitiv.'); return; }
    const rec = new Ctor(); rec.lang = 'ro-RO'; rec.interimResults = false;
    rec.onresult = (ev) => { const text = ev.results[0]?.[0]?.transcript || ''; setNovaText(text); askNova(text); };
    rec.onerror = () => setToast('Nu am putut asculta comanda.'); rec.start();
  };
  const testNotification = async () => {
    if (!Capacitor.isNativePlatform()) { setToast('Testul real de notificare rulează în APK.'); return; }
    if (!(await ensureNotifications())) { setToast('Permisiunea pentru notificări este oprită.'); return; }
    await LocalNotifications.schedule({ notifications: [{ id: 987654321, title: 'NOVA Planner', body: 'Notificările funcționează.', schedule: { at: new Date(Date.now() + 3000) } }] });
    setToast('Notificarea de test vine în ~3 secunde.');
  };

  const selectedEvents = events.filter((e) => e.date === selected).sort((a, b) => a.time.localeCompare(b.time));
  const monthName = new Intl.DateTimeFormat('ro-RO', { month: 'long', year: 'numeric' }).format(new Date(month.y, month.m, 1));
  const shiftMonth = (delta: number) => { const d = fromKey(selected); d.setDate(1); d.setMonth(d.getMonth() + delta); setSelected(keyFor(d)); };

  return <div className={`app ${resolved}`}>
    <style>{css}</style>
    <header><div className="brand"><img src="/assets/nova-icon.svg"/><div><b>NOVA</b><span>Planner</span></div></div><button className="avatar" onClick={() => setTab('profile')}>S</button></header>

    <main>
      {tab === 'home' && <>
        <section className="hero"><span className="eyebrow">Bun venit</span><h1>Organizează-ți ziua<br/><em>fără zgomot.</em></h1><p>{openTasks.length} taskuri deschise · {todayEvents.length} programări azi</p><div className="quick"><button onClick={() => openNew('event')}>＋ Programare</button><button onClick={() => openNew('task')}>✓ Task</button><button onClick={() => openNew('note')}>✎ Notă</button></div></section>
        <section className="grid2"><article className="card stat"><span>Următoarea</span><b>{nextEvent ? nextEvent.title : 'Nimic programat'}</b><small>{nextEvent ? `${pretty(nextEvent.date)} · ${nextEvent.time}` : 'Adaugă o programare'}</small></article><article className="card stat"><span>Taskuri</span><b>{openTasks.length}</b><small>{tasks.filter((x) => x.done).length} finalizate</small></article></section>
        <div className="title"><h2>Astăzi</h2><button onClick={() => setTab('calendar')}>Vezi calendarul</button></div>
        <section className="list">{todayEvents.length ? todayEvents.map((e) => <button className="card row" key={e.id} onClick={() => editEvent(e)}><time>{e.time}</time><div><b>{e.title}</b><small>{e.location || 'Fără locație'}</small></div><span>›</span></button>) : <div className="card empty">Zi liberă. Adaugă o programare când ai nevoie.</div>}</section>
      </>}

      {tab === 'calendar' && <>
        <div className="title"><div><span className="eyebrow">Calendar</span><h2>{monthName}</h2></div><button className="add" onClick={() => openNew('event')}>＋</button></div>
        <section className="card calendar"><div className="monthHead"><button onClick={() => shiftMonth(-1)}>‹</button><button onClick={() => setSelected(today)}>Azi</button><button onClick={() => shiftMonth(1)}>›</button></div><div className="weekLabels">{['L','M','M','J','V','S','D'].map((d,i)=><span key={i}>{d}</span>)}</div><div className="monthGrid">{Array.from({ length: month.offset }, (_, i) => <i key={`b${i}`}/>) }{Array.from({ length: month.days }, (_, i) => { const d = `${month.y}-${pad(month.m+1)}-${pad(i+1)}`; const has = events.some((e) => e.date === d); return <button key={d} className={selected === d ? 'sel' : ''} onClick={() => setSelected(d)}>{i+1}{has && <span/>}</button>; })}</div></section>
        <div className="title"><h2>{pretty(selected)}</h2><span>{selectedEvents.length} programări</span></div><section className="list">{selectedEvents.map((e) => <article className="card item" key={e.id}><button onClick={() => editEvent(e)}><time>{e.time}</time><div><b>{e.title}</b><small>{e.location || 'Fără locație'} {e.reminder ? '· 🔔' : ''}</small></div></button><button className="trash" onClick={() => removeEvent(e.id)}>×</button></article>)}{!selectedEvents.length && <div className="card empty">Nicio programare în ziua selectată.</div>}</section>
      </>}

      {tab === 'tasks' && <><div className="title"><div><span className="eyebrow">Focus</span><h2>Taskuri</h2></div><button className="add" onClick={() => openNew('task')}>＋</button></div><section className="list">{tasks.sort((a,b)=>Number(a.done)-Number(b.done)).map((t) => <article className={`card task ${t.done?'done':''}`} key={t.id}><button className="check" onClick={() => setTasks((all)=>all.map((x)=>x.id===t.id?{...x,done:!x.done}:x))}>{t.done?'✓':''}</button><button className="taskBody" onClick={() => editTask(t)}><b>{t.title}</b><small>{pretty(t.due)} · <strong className={t.priority}>{t.priority}</strong></small></button><button className="trash" onClick={() => setTasks((all)=>all.filter((x)=>x.id!==t.id))}>×</button></article>)}{!tasks.length && <div className="card empty">Niciun task. Bun început.</div>}</section></>}

      {tab === 'notes' && <><div className="title"><div><span className="eyebrow">Idei</span><h2>Note</h2></div><button className="add" onClick={() => openNew('note')}>＋</button></div><section className="notes">{notes.map((n)=><button className="card note" key={n.id} onClick={()=>editNote(n)}><b>{n.title}</b><p>{n.body || 'Notă fără text'}</p><small>{new Date(n.updatedAt).toLocaleDateString('ro-RO')}</small></button>)}{!notes.length && <div className="card empty">Nu ai încă note.</div>}</section></>}

      {tab === 'profile' && <><div className="title"><div><span className="eyebrow">Setări</span><h2>NOVA Planner</h2></div></div><section className="card settings"><h3>Aspect</h3><label>Temă<select value={theme} onChange={(e)=>setTheme(e.target.value as Theme)}><option value="dark">Întunecat</option><option value="light">Luminos</option><option value="system">Sistem</option></select></label></section><section className="card settings"><h3>Notificări Android</h3><p>Reminderele programate folosesc notificările locale ale telefonului, fără server.</p><button className="primary" onClick={()=>void testNotification()}>Testează notificarea</button></section><section className="card settings"><h3>Date</h3><p>{events.length} programări · {tasks.length} taskuri · {notes.length} note. Datele sunt păstrate local pe dispozitiv.</p><button className="danger" onClick={()=>{if(confirm('Ștergi toate datele NOVA?')){setEvents([]);setTasks([]);setNotes([]);localStorage.removeItem(KEY);}}}>Șterge toate datele</button></section></>}
    </main>

    <button className="novaFab" onClick={()=>setNovaOpen((v)=>!v)}>N</button>
    {novaOpen && <aside className="nova card"><div className="novaHead"><div><b>Nova</b><small>asistent local</small></div><button onClick={()=>setNovaOpen(false)}>×</button></div><p>{novaReply}</p><div className="novaInput"><input value={novaText} onChange={(e)=>setNovaText(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')askNova();}} placeholder="Întreabă sau creează..."/><button onClick={startVoice}>🎙</button><button onClick={()=>askNova()}>↑</button></div></aside>}

    <nav>{([['home','⌂','Acasă'],['calendar','□','Calendar'],['tasks','✓','Taskuri'],['notes','✎','Note'],['profile','⚙','Setări']] as [Tab,string,string][]).map(([id,icon,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><span>{icon}</span>{label}</button>)}</nav>

    {draftKind && <div className="backdrop"><section className="sheet card"><div className="sheetHead"><h2>{draftKind==='event'?'Programare':draftKind==='task'?'Task':'Notă'}</h2><button onClick={()=>setDraftKind(null)}>×</button></div>{draftKind==='event' && <form onSubmit={(e)=>void saveEvent(e)}><label>Titlu<input autoFocus value={eventDraft.title} onChange={(e)=>setEventDraft({...eventDraft,title:e.target.value})}/></label><div className="cols"><label>Data<input type="date" value={eventDraft.date} onChange={(e)=>setEventDraft({...eventDraft,date:e.target.value})}/></label><label>Ora<input type="time" value={eventDraft.time} onChange={(e)=>setEventDraft({...eventDraft,time:e.target.value})}/></label></div><label>Locație<input value={eventDraft.location} onChange={(e)=>setEventDraft({...eventDraft,location:e.target.value})}/></label><label className="toggle"><span>Reminder local</span><input type="checkbox" checked={eventDraft.reminder} onChange={(e)=>setEventDraft({...eventDraft,reminder:e.target.checked})}/></label><button className="primary" type="submit">Salvează</button></form>}{draftKind==='task' && <form onSubmit={saveTask}><label>Titlu<input autoFocus value={taskDraft.title} onChange={(e)=>setTaskDraft({...taskDraft,title:e.target.value})}/></label><div className="cols"><label>Termen<input type="date" value={taskDraft.due} onChange={(e)=>setTaskDraft({...taskDraft,due:e.target.value})}/></label><label>Prioritate<select value={taskDraft.priority} onChange={(e)=>setTaskDraft({...taskDraft,priority:e.target.value as TaskItem['priority']})}><option>Low</option><option>Medium</option><option>High</option></select></label></div><button className="primary" type="submit">Salvează</button></form>}{draftKind==='note' && <form onSubmit={saveNote}><label>Titlu<input autoFocus value={noteDraft.title} onChange={(e)=>setNoteDraft({...noteDraft,title:e.target.value})}/></label><label>Text<textarea rows={8} value={noteDraft.body} onChange={(e)=>setNoteDraft({...noteDraft,body:e.target.value})}/></label><button className="primary" type="submit">Salvează</button></form>}</section></div>}
    {toast && <div className="toast">{toast}</div>}
  </div>;
}

const css = `
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}button,input,select,textarea{font:inherit}button{border:0;background:none;color:inherit;cursor:pointer}.app{min-height:100vh;padding:calc(18px + env(safe-area-inset-top)) 18px calc(105px + env(safe-area-inset-bottom));transition:.2s;background:#070b17;color:#f4f7ff}.app.light{background:#eef3fa;color:#14213a}.app:before,.app:after{content:'';position:fixed;z-index:0;width:45vw;height:45vw;border-radius:50%;filter:blur(80px);opacity:.16;pointer-events:none}.app:before{background:#45e6ef;left:-20vw;top:-15vw}.app:after{background:#7857e6;right:-23vw;top:27vh}header,main,nav,.novaFab,.nova{position:relative;z-index:2}header{height:54px;max-width:620px;margin:auto;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:10px}.brand img{width:38px;height:38px;border-radius:12px}.brand div{display:grid;line-height:1}.brand b{letter-spacing:2px}.brand span{font-size:10px;color:#8996b2;margin-top:4px}.avatar{width:37px;height:37px;border-radius:13px;background:linear-gradient(135deg,#67e8ef,#765de2);color:#07101d;font-weight:900}main{max-width:620px;margin:18px auto 0}.hero{position:relative;overflow:hidden;border-radius:30px;padding:28px 24px;margin-bottom:14px;background:linear-gradient(145deg,rgba(25,39,73,.96),rgba(10,15,34,.92));border:1px solid rgba(126,227,243,.14);box-shadow:0 25px 65px rgba(0,0,0,.23)}.light .hero{background:linear-gradient(145deg,#fff,#e7eef9)}.hero:after{content:'N';position:absolute;right:-8px;top:-43px;font-size:210px;font-weight:900;color:#69e8ef;opacity:.045}.eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#6fe7ef;font-weight:800}.hero h1{font-size:34px;line-height:1.05;margin:10px 0 12px;letter-spacing:-1.5px}.hero h1 em{font-style:normal;color:#7cebf0}.hero p{margin:0;color:#91a0bb;font-size:12px}.quick{display:flex;gap:8px;margin-top:22px;flex-wrap:wrap}.quick button,.primary{padding:11px 13px;border-radius:13px;background:linear-gradient(135deg,#71e9ef,#7160db);color:#06101d;font-weight:850;font-size:12px}.card{background:rgba(255,255,255,.055);border:1px solid rgba(180,223,255,.11);border-radius:20px;box-shadow:0 12px 35px rgba(0,0,0,.12)}.light .card{background:rgba(255,255,255,.82);border-color:rgba(29,54,92,.09)}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stat{padding:16px;display:grid;gap:5px}.stat span,.stat small,.item small,.task small,.note small,.nova small{font-size:10px;color:#8f9db7}.stat b{font-size:15px}.title{display:flex;align-items:end;justify-content:space-between;margin:23px 2px 11px}.title h2{font-size:21px;margin:2px 0 0;text-transform:capitalize}.title>button,.title>span{color:#73e7ee;font-size:11px}.add{width:42px;height:42px;border-radius:14px;background:rgba(111,231,239,.12);font-size:24px!important}.list{display:grid;gap:8px}.row{width:100%;display:grid;grid-template-columns:48px 1fr 20px;align-items:center;text-align:left;padding:14px}.row time,.item time{font-size:11px;color:#73e7ee}.row div,.item div,.taskBody{display:grid;gap:4px}.row small{color:#8f9db7;font-size:10px}.empty{padding:28px;text-align:center;color:#8e9ab2;font-size:12px}.calendar{padding:13px}.monthHead{display:flex;justify-content:space-between;align-items:center;padding:4px 3px 12px}.monthHead button{padding:6px 12px;border-radius:10px;background:rgba(255,255,255,.06);font-size:12px}.weekLabels,.monthGrid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}.weekLabels span{text-align:center;color:#7f8ca4;font-size:9px;padding:5px}.monthGrid i,.monthGrid button{aspect-ratio:1;display:grid;place-items:center;border-radius:12px;font-size:12px;position:relative}.monthGrid button:hover{background:rgba(255,255,255,.06)}.monthGrid button.sel{background:linear-gradient(135deg,#73e9ef,#6e61dd);color:#07101d;font-weight:900}.monthGrid button span{position:absolute;width:4px;height:4px;border-radius:50%;background:#71e8ee;bottom:5px}.monthGrid button.sel span{background:#07101d}.item{display:grid;grid-template-columns:1fr 36px;align-items:center;padding:10px}.item>button:first-child{display:grid;grid-template-columns:48px 1fr;text-align:left;align-items:center}.trash{font-size:20px;color:#e9899c}.task{display:grid;grid-template-columns:30px 1fr 30px;align-items:center;padding:12px}.check{width:23px;height:23px;border:1px solid #687891;border-radius:8px;color:#07101d}.task.done .check{background:#6fe6ca}.task.done .taskBody b{text-decoration:line-through;color:#738097}.taskBody{text-align:left}.taskBody strong{font-size:9px}.High{color:#ff8aa1}.Medium{color:#f2c66c}.Low{color:#65dfb9}.notes{display:grid;grid-template-columns:1fr 1fr;gap:9px}.note{text-align:left;padding:15px;min-height:132px;display:flex;flex-direction:column;gap:8px}.note p{font-size:11px;color:#8f9db7;line-height:1.45;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.note small{margin-top:auto}.settings{padding:18px;margin-bottom:10px}.settings h3{margin:0 0 10px;font-size:15px}.settings p{color:#8f9db7;font-size:11px;line-height:1.5}.settings label,form label{display:grid;gap:7px;font-size:11px;color:#8f9db7;margin-bottom:13px}input,select,textarea{width:100%;border:1px solid rgba(181,220,255,.15);border-radius:12px;background:rgba(255,255,255,.06);color:inherit;padding:11px;outline:none}.light input,.light select,.light textarea{background:#fff;border-color:#dbe3ef;color:#14213a}.danger{padding:10px 12px;border-radius:12px;border:1px solid rgba(240,128,151,.4);color:#f298aa;font-size:11px}.novaFab{position:fixed;right:20px;bottom:calc(92px + env(safe-area-inset-bottom));width:56px;height:56px;border-radius:50%;background:radial-gradient(circle at 30% 20%,#9bf4f6,#62e8ef 20%,#6556d9 65%,#161a36);color:#fff;font-size:22px;font-weight:900;box-shadow:0 10px 35px rgba(67,214,229,.42)}.nova{position:fixed;right:18px;bottom:calc(157px + env(safe-area-inset-bottom));width:min(360px,calc(100vw - 36px));padding:15px;background:rgba(8,13,29,.96)}.light .nova{background:rgba(255,255,255,.96)}.novaHead{display:flex;justify-content:space-between;align-items:center}.novaHead div{display:grid}.novaHead button{font-size:22px}.nova>p{font-size:12px;line-height:1.45;color:#a6b4cb}.novaInput{display:grid;grid-template-columns:1fr 37px 37px;gap:6px}.novaInput input{margin:0}.novaInput button{border-radius:11px;background:rgba(111,231,239,.13)}nav{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(13px + env(safe-area-inset-bottom));width:min(600px,calc(100% - 24px));padding:7px;display:flex;justify-content:space-around;border:1px solid rgba(188,225,255,.13);border-radius:22px;background:rgba(9,14,30,.88);backdrop-filter:blur(20px)}.light nav{background:rgba(255,255,255,.88)}nav button{display:grid;place-items:center;gap:2px;min-width:54px;padding:5px;border-radius:12px;color:#7f8ca5;font-size:8px}nav button span{font-size:17px}nav button.active{color:#72e8ef;background:rgba(111,231,239,.1)}.backdrop{position:fixed;z-index:30;inset:0;background:rgba(2,5,12,.62);backdrop-filter:blur(8px);display:flex;align-items:flex-end;padding:12px}.sheet{width:min(620px,100%);max-height:90vh;overflow:auto;margin:auto;padding:19px;border-radius:26px;background:#11182b}.light .sheet{background:#fff}.sheetHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.sheetHead h2{margin:0}.sheetHead button{font-size:26px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:9px}.toggle{display:flex!important;align-items:center;justify-content:space-between}.toggle input{width:22px}.sheet .primary{width:100%;padding:13px}.toast{position:fixed;z-index:50;left:50%;transform:translateX(-50%);bottom:calc(100px + env(safe-area-inset-bottom));padding:11px 14px;border-radius:13px;background:#0e172a;color:#f3f8ff;border:1px solid rgba(111,231,239,.3);font-size:11px;box-shadow:0 12px 35px rgba(0,0,0,.35)}@media(max-width:400px){.hero h1{font-size:30px}.notes{grid-template-columns:1fr}.cols{grid-template-columns:1fr}}
`;
