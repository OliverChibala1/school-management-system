import { useEffect, useMemo, useState } from 'react';
import { Activity, Archive, ArrowUpRight, Banknote, Bell, BookOpen, CalendarDays, Check, CircleHelp, ClipboardCheck, FileText, GraduationCap, LayoutDashboard, LogOut, Menu, MoreHorizontal, Plus, Search, ShieldCheck, Users, X, Palette, MessageCircle, Send, Moon, Sun } from 'lucide-react';

type Role = 'admin' | 'headteacher' | 'registrar' | 'teacher' | 'parent' | 'student';
type User = { id: string; fullName: string; email: string; role: Role };
type Student = { id: string; admissionNumber: string; firstName: string; lastName: string; className?: string | null; status: string; admissionDate?: string };
type Summary = { students: number; staff: number; classes: number; guardians: number; attendance: { present: number; absent: number; recorded: number }; nextEvent: { id: string; title: string; startsAt: string } | null; feesOutstanding: number | null };
type SystemSettings = { schoolName: string; schoolShortName: string; theme: string; mode: 'light' | 'dark'; accentColor: string; logoUrl: string };
type Contact = { id: string; fullName: string; email: string; role: Role; lastMessage?: string | null; unreadCount?: number };
type DirectMessage = { id: string; senderId: string; recipientId: string; body: string; createdAt: string; readAt?: string | null };

const DEFAULT_SETTINGS: SystemSettings = {
  schoolName: 'School Management System',
  schoolShortName: 'SMS',
  theme: 'forest',
  mode: 'light',
  accentColor: '#21644f',
  logoUrl: ''
};
const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function Login({ onLogin, schoolName }: { onLogin: (token: string, user: User) => void; schoolName: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [portal, setPortal] = useState<'staff' | 'parent'>('staff');
  const [createAccount, setCreateAccount] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('Parent');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const endpoint = portal === 'parent' && createAccount ? '/auth/parent/register' : '/auth/login';
      const payload = portal === 'parent' && createAccount
        ? { fullName, email, password, phone, relationship }
        : { email, password };

      const r = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not sign in');
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to the server.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-shell"><section className="login-brand"><div className="brand-mark large"><GraduationCap size={30}/></div><p className="eyebrow">{schoolName.toUpperCase()}</p><h1>Better school<br/>management starts here.</h1><p className="brand-copy">One secure workspace for learner records, attendance, academics, fees and parent communication.</p><div className="login-bottom">{schoolName} <span>•</span> SECURE SCHOOL PORTAL</div></section><section className="login-panel"><form className="login-card" onSubmit={submit}><div className="mobile-logo"><div className="brand-mark"><GraduationCap/></div><strong>{schoolName}</strong></div><div className="portal-switch"><button type="button" className={portal === 'staff' ? 'portal-option active' : 'portal-option'} onClick={() => { setPortal('staff'); setCreateAccount(false); }}>Staff portal</button><button type="button" className={portal === 'parent' ? 'portal-option active' : 'portal-option'} onClick={() => setPortal('parent')}>Parent portal</button></div><span className="pill">{portal === 'staff' ? 'STAFF PORTAL' : 'PARENT PORTAL'}</span><h2>{portal === 'staff' ? 'Welcome back' : createAccount ? 'Create parent account' : 'Parent sign in'}</h2><p className="muted">{portal === 'staff' ? 'Sign in with your authorised school account.' : createAccount ? 'Open secure access for your child or children.' : 'Use your parent email and password to view school updates.'}</p>{portal === 'parent' && createAccount && <><label>Full name<input type="text" value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Parent full name" required /></label><label>Phone number<input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+260 97..." required /></label><label>Relationship<select value={relationship} onChange={e=>setRelationship(e.target.value)}><option>Parent</option><option>Mother</option><option>Father</option><option>Guardian</option></select></label></>}{portal === 'parent' && !createAccount && <p className="portal-note">Need an account? <button type="button" className="inline-link" onClick={() => setCreateAccount(true)}>Create one here</button></p>}<label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder={portal === 'staff' ? 'you@school.edu.zm' : 'parent@email.com'} required autoComplete="username"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={portal === 'staff' ? 'Enter your password' : 'Create or enter your password'} required autoComplete="current-password"/></label>{error && <div className="error-box">{error}</div>}<button className="primary-btn full" disabled={busy}>{busy ? 'Please wait…' : portal === 'parent' && createAccount ? 'Create parent account' : 'Sign in securely'} <ArrowUpRight size={17}/></button>{portal === 'parent' && createAccount && <button type="button" className="secondary-btn full secondary-login" onClick={() => setCreateAccount(false)}>Back to sign in</button>}{portal === 'staff' ? <p className="login-hint"><ShieldCheck size={15}/> Access is restricted to authorised staff.</p> : <p className="login-hint"><ShieldCheck size={15}/> Parents can only see their own linked learners.</p>}</form></section></main>
}

function App() {
  const [settings, setSettings] = useState<SystemSettings>(() => ({ ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('twashuka_settings') || '{}'), mode: localStorage.getItem('twashuka_mode') === 'dark' ? 'dark' : localStorage.getItem('twashuka_mode') === 'light' ? 'light' : DEFAULT_SETTINGS.mode }));
  const [token, setToken] = useState(() => sessionStorage.getItem('twashuka_token') || '');
  const [user, setUser] = useState<User | null>(null); const [page, setPage] = useState('Dashboard'); const [summary, setSummary] = useState<Summary | null>(null); const [students, setStudents] = useState<Student[]>([]); const [schoolClasses, setSchoolClasses] = useState<any[]>([]); const [query, setQuery] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [showAdd, setShowAdd] = useState(false); const [mobileNav, setMobileNav] = useState(false); const [notice, setNotice] = useState(''); const [selectedContactId, setSelectedContactId] = useState('');
  const [form, setForm] = useState({ admissionNumber: '', firstName: '', lastName: '', guardianName: '', guardianPhone: '', classId: '' });

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.mode = settings.mode;
    localStorage.setItem('twashuka_theme', settings.theme);
    localStorage.setItem('twashuka_settings', JSON.stringify(settings));
    localStorage.setItem('twashuka_mode', settings.mode);
    document.documentElement.style.setProperty('--app-accent', settings.accentColor);
  }, [settings]);

  function onLogin(t: string, u: User) { sessionStorage.setItem('twashuka_token', t); setToken(t); setUser(u); setPage(u.role === 'parent' ? 'Parent Portal' : 'Dashboard'); }
  function logout() { sessionStorage.removeItem('twashuka_token'); setToken(''); setUser(null); setSummary(null); setStudents([]); }
  function openMessages(contactId = '') { setSelectedContactId(contactId); setPage('Messages'); setMobileNav(false); }
  useEffect(() => { if (!token) return; request('/auth/me', token).then(d => { setUser(d.user); if (d.user.role === 'parent') setPage('Parent Portal'); }).catch(logout); }, [token]);
  useEffect(() => { if (!token) return; request('/settings', token).then((data) => { const savedMode = localStorage.getItem('twashuka_mode'); const merged = { ...DEFAULT_SETTINGS, ...data, mode: savedMode === 'dark' || savedMode === 'light' ? savedMode : data.mode }; setSettings(merged); localStorage.setItem('twashuka_settings', JSON.stringify(merged)); }).catch(() => undefined); }, [token]);
  useEffect(() => { if (!token || !user || user.role === 'parent') return; setLoading(true); setError(''); Promise.all([request('/dashboard/summary', token), request('/students?status=active&limit=100', token), request('/classes',token)]).then(([s, st, c]) => { setSummary(s); setStudents(st.students); setSchoolClasses(c.classes); }).catch(e => setError(e.message)).finally(() => setLoading(false)); }, [token, user]);

  async function saveSettings(next: SystemSettings) {
    if (!token) {
      setSettings(next);
      localStorage.setItem('twashuka_settings', JSON.stringify(next));
      return;
    }
    const data = await request('/settings', token, { method: 'PUT', body: JSON.stringify(next) });
    const merged = { ...DEFAULT_SETTINGS, ...data };
    setSettings(merged);
    localStorage.setItem('twashuka_settings', JSON.stringify(merged));
  }

  const filtered = useMemo(() => students.filter(s => `${s.firstName} ${s.lastName} ${s.admissionNumber} ${s.className || ''}`.toLowerCase().includes(query.toLowerCase())), [students, query]);
  async function addStudent(e: React.FormEvent) { e.preventDefault(); setError(''); try { await request('/students', token, { method: 'POST', body: JSON.stringify({...form,classId:form.classId||null}) }); setShowAdd(false); setForm({ admissionNumber: '', firstName: '', lastName: '', guardianName: '', guardianPhone: '',classId:'' }); const [s, st] = await Promise.all([request('/dashboard/summary', token), request('/students?status=active&limit=100', token)]); setSummary(s); setStudents(st.students); setNotice('Learner added successfully.'); setTimeout(() => setNotice(''), 3500); } catch (e) { setError(e instanceof Error ? e.message : 'Could not add learner'); } }

  if (!token || !user) return <Login onLogin={onLogin} schoolName={settings.schoolName}/>;

  const nav = user.role === 'parent'
    ? [{ label: 'Parent Portal', icon: LayoutDashboard }, { label: 'Messages', icon: MessageCircle }, { label: 'Announcements', icon: Bell }, { label: 'Calendar', icon: CalendarDays }]
    : [{ label: 'Dashboard', icon: LayoutDashboard }, { label: 'Students', icon: GraduationCap }, { label: 'Parents', icon: Users }, { label: 'Staff', icon: Users }, { label: 'Classes', icon: BookOpen }, { label: 'Subjects', icon: BookOpen }, { label: 'Attendance', icon: ClipboardCheck }, { label: 'Academic results', icon: Activity }, { label: 'Fees', icon: Banknote }, { label: 'Announcements', icon: Bell }, { label: 'Messages', icon: MessageCircle }, { label: 'Reports', icon: FileText }, { label: 'Calendar', icon: CalendarDays }, { label: 'Settings', icon: Palette }];

  const statCards = [ { label: 'Active learners', value: summary?.students ?? '—', delta: 'Enrolled student records', icon: GraduationCap, tone: 'blue' }, { label: 'Staff accounts', value: summary?.staff ?? '—', delta: 'Active school staff', icon: Users, tone: 'purple' }, { label: 'Classes', value: summary?.classes ?? '—', delta: 'Configured classes', icon: BookOpen, tone: 'green' }, { label: 'Guardians', value: summary?.guardians ?? '—', delta: 'Linked guardian records', icon: Users, tone: 'orange' }, { label: 'Attendance today', value: summary?.attendance?.recorded ? `${Math.round(summary.attendance.present / summary.attendance.recorded * 100)}%` : '—', delta: summary?.attendance?.recorded ? `${summary.attendance.present} present · ${summary.attendance.absent} absent` : 'No register recorded yet', icon: ClipboardCheck, tone: 'blue' }, ...(['admin', 'headteacher', 'registrar'].includes(user.role) && summary?.feesOutstanding !== null && summary?.feesOutstanding !== undefined ? [{ label: 'Outstanding fees', value: new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', maximumFractionDigits: 0 }).format(summary.feesOutstanding), delta: 'Current recorded balance', icon: Banknote, tone: 'orange' }] : []) ];

  return <div className="app-shell"><aside className={`sidebar ${mobileNav ? 'nav-open' : ''}`}><div className="sidebar-brand"><div className="brand-mark"><GraduationCap size={22}/></div><div><strong>{settings.schoolShortName || 'School'}</strong><span>{settings.schoolName}</span></div><button className="icon-btn mobile-close" onClick={()=>setMobileNav(false)}><X size={18}/></button></div><div className="school-label">SCHOOL WORKSPACE</div><nav>{nav.map(item => <button key={item.label} className={`nav-item ${page===item.label?'active':''}`} onClick={()=>{setPage(item.label);setMobileNav(false)}}><item.icon size={18}/><span>{item.label}</span>{item.label==='Students' && <span className="nav-count">{summary?.students ?? 0}</span>}</button>)}</nav><div className="sidebar-bottom"><button className="nav-item" onClick={()=>setNotice('Contact your system administrator for support.')}><CircleHelp size={18}/><span>Help & support</span></button><div className="sidebar-user"><div className="avatar">{user.fullName.split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase()}</div><div className="user-meta"><strong>{user.fullName}</strong><span>{user.role}</span></div><button className="icon-btn" aria-label="Sign out" onClick={logout}><LogOut size={17}/></button></div></div></aside>
  {mobileNav && <button className="scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}<main className="main-area"><header className="topbar"><div className="top-left"><button className="icon-btn mobile-menu" onClick={()=>setMobileNav(true)}><Menu size={21}/></button><div><p className="crumb">School workspace <span>/</span> {page}</p><h1>{page==='Dashboard'?`Welcome, ${user.fullName.split(' ')[0]}`:page}</h1></div></div><div className="top-actions"><div className="date-chip"><CalendarDays size={16}/>{new Date().toLocaleDateString('en-ZM',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</div><button type="button" className="icon-btn appearance-toggle" aria-label={`Switch to ${settings.mode === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${settings.mode === 'dark' ? 'light' : 'dark'} mode`} onClick={()=>setSettings(current=>({...current,mode:current.mode==='dark'?'light':'dark'}))}>{settings.mode==='dark'?<Sun size={19}/>:<Moon size={19}/>}</button><button className="icon-btn notification" aria-label="Notifications" onClick={()=>setNotice('You are all caught up.')}><Bell size={19}/><i/></button><div className="top-avatar">{user.fullName.split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase()}</div></div></header>
  <div className="content">{error && <div className="error-banner"><span>{error}</span><button onClick={()=>setError('')}><X size={16}/></button></div>}{notice && <div className="success-banner"><Check size={16}/>{notice}<button onClick={()=>setNotice('')}><X size={16}/></button></div>}
  {page==='Dashboard' && <><section className="welcome-banner"><div><span className="banner-tag"><span/> YOUR SCHOOL AT A GLANCE</span><h2>The school day, in clear view.</h2><p>{settings.schoolName} brings together learner records, attendance, academics, fees and communication in one trusted workspace.</p><button className="banner-btn" onClick={()=>setPage('Students')}>Explore learner records <ArrowUpRight size={16}/></button></div><div className="banner-art"><div className="art-circle"><GraduationCap size={72}/></div><span className="art-dot dot-one"/><span className="art-dot dot-two"/><span className="art-dot dot-three"/></div></section>
  <div className="section-heading"><div><h3>School at a glance</h3><p>Live totals from your school records</p></div><span className="live-label"><span/> Live data</span></div><section className="stat-grid">{statCards.map(card=><article className="stat-card" key={card.label}><div className={`stat-icon ${card.tone}`}><card.icon size={20}/></div><div className="stat-label">{card.label}</div><div className="stat-value">{loading?'…':card.value}</div><div className="stat-foot"><span>{card.delta}</span></div></article>)}</section>
  <section className="dashboard-info-grid">
    <article className="panel dashboard-record-panel">
      <div className="panel-head"><div><h3>Today’s attendance</h3><p>Live register totals from recorded student attendance</p></div><button className="text-btn" onClick={()=>setPage('Attendance')}>Open register <ArrowUpRight size={15}/></button></div>
      {summary?.attendance?.recorded ? <div className="attendance-totals"><div><strong>{summary.attendance.present}</strong><span>Present</span></div><div><strong>{summary.attendance.absent}</strong><span>Absent</span></div><div><strong>{summary.attendance.recorded}</strong><span>Records</span></div></div> : <div className="dashboard-empty"><ClipboardCheck size={21}/><span>No attendance has been recorded today.</span><button className="text-btn" onClick={()=>setPage('Attendance')}>Take attendance <ArrowUpRight size={15}/></button></div>}
    </article>
    <article className="panel dashboard-record-panel">
      <div className="panel-head"><div><h3>Next school event</h3><p>From the school calendar</p></div><button className="text-btn" onClick={()=>setPage('Calendar')}>Open calendar <ArrowUpRight size={15}/></button></div>
      {summary?.nextEvent ? <div className="next-event"><span className="event-date"><strong>{new Date(summary.nextEvent.startsAt).toLocaleDateString('en-ZM',{day:'2-digit'})}</strong><small>{new Date(summary.nextEvent.startsAt).toLocaleDateString('en-ZM',{month:'short'})}</small></span><span><strong>{summary.nextEvent.title}</strong><small>{new Date(summary.nextEvent.startsAt).toLocaleString('en-ZM',{weekday:'long',hour:'numeric',minute:'2-digit'})}</small></span></div> : <div className="dashboard-empty"><CalendarDays size={21}/><span>No upcoming events are scheduled.</span><button className="text-btn" onClick={()=>setPage('Calendar')}>Add school event <ArrowUpRight size={15}/></button></div>}
    </article>
  </section>
  <section className="lower-grid"><article className="panel recent-panel"><div className="panel-head"><div><h3>Recently added learners</h3><p>Latest learner records</p></div><button className="text-btn" onClick={()=>setPage('Students')}>View all <ArrowUpRight size={15}/></button></div><StudentTable students={students.slice(0,5)} compact/></article><article className="panel quick-panel"><div className="panel-head"><div><h3>Quick actions</h3><p>Common school tasks</p></div><MoreHorizontal size={20} className="muted-icon"/></div><button className="quick-action" onClick={()=>{setPage('Students');setShowAdd(true)}}><span className="quick-icon blue"><Plus size={18}/></span><span><strong>Register a learner</strong><small>Add a new student record</small></span><ArrowUpRight size={16}/></button><button className="quick-action" onClick={()=>setPage('Parents')}><span className="quick-icon orange"><Users size={18}/></span><span><strong>Save a guardian</strong><small>Link a guardian to their learner(s)</small></span><ArrowUpRight size={16}/></button><button className="quick-action" onClick={()=>setPage('Attendance')}><span className="quick-icon green"><ClipboardCheck size={18}/></span><span><strong>Take attendance</strong><small>Open the daily register</small></span><ArrowUpRight size={16}/></button><button className="quick-action" onClick={()=>setPage('Academic results')}><span className="quick-icon purple"><BookOpen size={18}/></span><span><strong>Manage results</strong><small>Enter marks and view reports</small></span><ArrowUpRight size={16}/></button><div className="security-note"><ShieldCheck size={17}/><span><strong>Protected workspace</strong><small>Sign out when using a shared device.</small></span></div></article></section></>}
  {page==='Students' && <section className="panel students-panel"><div className="panel-head students-head"><div><h3>Student records</h3><p>Search and manage enrolled learners</p></div>{['admin','registrar'].includes(user.role)&&<button className="primary-btn" onClick={()=>setShowAdd(true)}><Plus size={17}/> Add learner</button>}</div><div className="table-tools"><label className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name, admission no. or class…"/></label><span className="record-count">{filtered.length} records shown</span></div><StudentTable students={filtered} onArchive={['admin','registrar'].includes(user.role)?async id=>{if(!window.confirm('Archive this learner record?'))return;try{await request(`/students/${id}`,token,{method:'DELETE'});setStudents(students.filter(s=>s.id!==id));const s=await request('/dashboard/summary',token);setSummary(s);setNotice('Learner record archived.')}catch(e){setError(e instanceof Error?e.message:'Could not archive learner.')}}:undefined}/></section>}
  {page === 'Parent Portal' && <ParentPortal token={token} />}
  {page === 'Messages' && <MessagesPage token={token} user={user} initialContactId={selectedContactId} />}
  {page === 'Settings' && <SettingsPage settings={settings} token={token} onSave={saveSettings} />}
  {!['Dashboard','Students','Settings','Parent Portal','Messages'].includes(page) && <ModulePage page={page} token={token} user={user} onMessage={openMessages} onSaved={async()=>{const s=await request('/dashboard/summary',token);setSummary(s);setNotice('Changes saved successfully.');setTimeout(()=>setNotice(''),3000)}}/>}
  <footer className="footer"><span>© {new Date().getFullYear()} {settings.schoolName}</span><span>Made for clear, reliable school administration <span className="footer-heart">♥</span></span><span className="footer-secure"><ShieldCheck size={14}/> Secure portal</span></footer></div></main>
  {showAdd && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowAdd(false)}}><form className="modal" onSubmit={addStudent}><div className="modal-head"><div><span className="pill">STUDENT RECORDS</span><h2>Register a learner</h2><p>Enter the basic learner details below.</p></div><button type="button" className="icon-btn" onClick={()=>setShowAdd(false)}><X/></button></div><div className="form-grid"><label>Admission number *<input required maxLength={40} value={form.admissionNumber} onChange={e=>setForm({...form,admissionNumber:e.target.value})} placeholder="e.g. TSS-2026-001"/></label><label>First name *<input required value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})} placeholder="First name"/></label><label>Last name *<input required value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})} placeholder="Last name"/></label><label>Class<select value={form.classId} onChange={e=>setForm({...form,classId:e.target.value})}><option value="">Unassigned</option>{schoolClasses.map(c=><option key={c.id} value={c.id}>{c.name} · {c.academicYear}</option>)}</select></label><label>Guardian name<input value={form.guardianName} onChange={e=>setForm({...form,guardianName:e.target.value})} placeholder="Parent or guardian"/></label><label className="span-two">Guardian phone<input value={form.guardianPhone} onChange={e=>setForm({...form,guardianPhone:e.target.value})} placeholder="e.g. +260 97…"/></label></div><div className="modal-actions"><button type="button" className="secondary-btn" onClick={()=>setShowAdd(false)}>Cancel</button><button className="primary-btn"><Plus size={16}/> Save learner</button></div></form></div>}
  </div>;
}

function StudentTable({ students, compact = false, onArchive }: { students: Student[]; compact?: boolean; onArchive?: (id: string) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>LEARNER</th>
            <th>ADMISSION NO.</th>
            <th>CLASS</th>
            <th>STATUS</th>
            {!compact && <th>ADMITTED</th>}
            {onArchive && <th>ACTIONS</th>}
          </tr>
        </thead>
        <tbody>
          {students.length === 0 ? (
            <tr>
              <td colSpan={(compact ? 4 : 5) + (onArchive ? 1 : 0)} className="empty-cell">
                <div className="empty-icon"><GraduationCap size={22}/></div>
                <strong>No learner records yet</strong>
                <span>When authorised staff add learners, their records will appear here.</span>
              </td>
            </tr>
          ) : (
            students.map((s, i) => (
              <tr key={s.id}>
                <td>
                  <div className="student-name">
                    <div className={`student-avatar av-${i % 4}`}>{s.firstName?.[0]}{s.lastName?.[0]}</div>
                    <span><strong>{s.firstName} {s.lastName}</strong><small>Student</small></span>
                  </div>
                </td>
                <td><span className="admission-code">{s.admissionNumber}</span></td>
                <td>{s.className || <span className="muted-text">Not assigned</span>}</td>
                <td><span className="status-badge"><i/> {s.status}</span></td>
                {!compact && <td>{s.admissionDate ? new Date(s.admissionDate).toLocaleDateString('en-GB') : '—'}</td>}
                {onArchive && (
                  <td>
                    <button className="archive-btn" aria-label={`Archive ${s.firstName} ${s.lastName}`} title="Archive learner" onClick={() => onArchive(s.id)}>
                      <Archive size={15}/>
                    </button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
export default App;

function ParentPortal({ token }: { token: string }) {
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request('/portal/summary', token)
      .then((data) => setSummary(data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the parent portal.'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <section className="panel students-panel"><div className="panel-head"><div><h3>Parent portal</h3><p>Please wait while we load your linked learners.</p></div></div></section>;

  return <section className="panel students-panel portal-page">
    <div className="panel-head"><div><h3>Parent portal</h3><p>Secure access for your child or children.</p></div></div>
    {error && <div className="error-banner">{error}</div>}
    {!summary || !summary.children?.length ? <div className="empty-state"><strong>No linked learners found</strong><span>Your parent account is not connected to any student records yet.</span></div> : <div className="portal-grid">{summary.children.map((child: any) => (
      <article className="portal-card" key={child.id}>
        <div className="portal-head"><div><span className="pill">Student</span><h4>{child.firstName} {child.lastName}</h4></div><span className="status-badge">{child.status}</span></div>
        <div className="portal-meta"><span>{child.admissionNumber}</span><span>{child.className || 'Not assigned'}</span></div>
        <div className="portal-stats">
          <div><span>Attendance</span><strong>{child.presentDays ?? 0} present</strong></div>
          <div><span>Average</span><strong>{Number(child.averageScore ?? 0).toFixed(1)}%</strong></div>
          <div><span>Balance</span><strong>{new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', maximumFractionDigits: 2 }).format(Number(child.feeBalance ?? 0))}</strong></div>
        </div>
      </article>
    ))}</div>}

    <div className="portal-sections">
      <div className="portal-column">
        <h4>School announcements</h4>
        {summary?.announcements?.length ? summary.announcements.map((item: any) => (
          <div className="portal-list-item" key={item.id}><strong>{item.title}</strong><p>{item.body}</p></div>
        )) : <div className="empty-small">No published announcements yet.</div>}
      </div>
      <div className="portal-column">
        <h4>Upcoming events</h4>
        {summary?.upcomingEvents?.length ? summary.upcomingEvents.map((item: any) => (
          <div className="portal-list-item" key={item.id}><strong>{item.title}</strong><p>{new Date(item.startsAt).toLocaleString()}</p></div>
        )) : <div className="empty-small">No upcoming school events.</div>}
      </div>
    </div>
  </section>;
}

function SettingsPage({ settings, token, onSave }: { settings: SystemSettings; token: string; onSave: (next: SystemSettings) => Promise<void> | void }) {
  const [form, setForm] = useState<SystemSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => () => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.mode = settings.mode;
    document.documentElement.style.setProperty('--app-accent', settings.accentColor);
  }, [settings]);

  function preview(next: SystemSettings) {
    setForm(next);
    document.documentElement.dataset.theme = next.theme;
    document.documentElement.dataset.mode = next.mode;
    document.documentElement.style.setProperty('--app-accent', next.accentColor);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      await onSave(form);
      setNotice('School settings saved successfully.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel students-panel appearance-page">
    <div className="panel-head"><div><h3>Settings</h3><p>Configure branding, theme, and the school workspace.</p></div></div>
    {notice && <div className={notice.startsWith('School settings') ? 'success-banner' : 'error-banner'}>{notice}</div>}
    <form className="form-grid module-form" onSubmit={submit}>
      <label>School name<input value={form.schoolName} onChange={e => setForm({ ...form, schoolName: e.target.value })} /></label>
      <label>Short name<input value={form.schoolShortName} onChange={e => setForm({ ...form, schoolShortName: e.target.value })} /></label>
      <label>Theme<select value={form.theme} onChange={e => preview({ ...form, theme: e.target.value })}><option value="forest">Forest</option><option value="ocean">Ocean</option><option value="royal">Royal</option><option value="terracotta">Terracotta</option><option value="lagoon">Lagoon</option><option value="midnight">Midnight</option></select></label>
      <label>Mode<select value={form.mode} onChange={e => preview({ ...form, mode: e.target.value as 'light' | 'dark' })}><option value="light">Light mode</option><option value="dark">Dark mode</option></select></label>
      <label>Accent colour<input type="color" value={form.accentColor} onChange={e => preview({ ...form, accentColor: e.target.value })} /></label>
      <label className="span-two">Logo URL<input value={form.logoUrl} onChange={e => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://example.com/logo.png" /></label>
      <button className="primary-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
    </form>
  </section>;
}

function MessagesPage({token,user,initialContactId}:{token:string;user:User;initialContactId:string}) {
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [selectedId,setSelectedId]=useState(initialContactId);
  const [messages,setMessages]=useState<DirectMessage[]>([]);
  const [draft,setDraft]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    let active=true;
    request('/messages/contacts',token)
      .then(data=>{
        if(!active)return;
        const nextContacts:Contact[]=data.contacts||[];
        setContacts(nextContacts);
        setSelectedId(current=>nextContacts.some(contact=>contact.id===current)?current:nextContacts[0]?.id||'');
      })
      .catch(err=>{if(active)setError(err instanceof Error?err.message:'Could not load contacts.')});
    return ()=>{active=false};
  },[token,initialContactId]);

  useEffect(()=>{
    if(!selectedId)return;
    let active=true;
    const loadConversation=()=>request(`/messages/${selectedId}`,token)
      .then(data=>{if(active)setMessages(data.messages||[])})
      .catch(err=>{if(active)setError(err instanceof Error?err.message:'Could not load this conversation.')});
    loadConversation();
    const timer=window.setInterval(loadConversation,8000);
    return ()=>{active=false;window.clearInterval(timer)};
  },[selectedId,token]);

  async function sendMessage(event:React.FormEvent){
    event.preventDefault();
    const body=draft.trim();
    if(!selectedId||!body)return;
    setBusy(true);
    setError('');
    try{
      await request('/messages',token,{method:'POST',body:JSON.stringify({recipientId:selectedId,body})});
      setDraft('');
      const data=await request(`/messages/${selectedId}`,token);
      setMessages(data.messages||[]);
      const refreshed=await request('/messages/contacts',token);
      setContacts(refreshed.contacts||[]);
    }catch(err){setError(err instanceof Error?err.message:'Could not send this message.')}
    finally{setBusy(false)}
  }

  const selectedContact=contacts.find(contact=>contact.id===selectedId);

  return <section className="panel students-panel messages-panel">
    <div className="panel-head"><div><h3>Messages</h3><p>Private conversations with school staff and linked parent accounts.</p></div></div>
    {error&&<div className="error-banner">{error}<button onClick={()=>setError('')} aria-label="Dismiss message error"><X size={15}/></button></div>}
    <div className="message-layout">
      <aside className="message-contacts" aria-label="Contacts">
        <div className="message-contacts-title"><strong>Conversations</strong><span>{contacts.length}</span></div>
        {contacts.map(contact=><button type="button" className={`message-contact ${contact.id===selectedId?'selected':''}`} key={contact.id} onClick={()=>{setSelectedId(contact.id);setError('')}}>
          <span className="contact-avatar">{contact.fullName.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase()}</span>
          <span className="contact-copy"><strong>{contact.fullName}</strong><small>{contact.lastMessage||contact.role}</small></span>
          {Number(contact.unreadCount)>0&&<span className="unread-count">{contact.unreadCount}</span>}
        </button>)}
        {!contacts.length&&!error&&<div className="empty-small">No contacts are available yet.</div>}
      </aside>
      <div className="message-conversation">
        {selectedContact?<>
          <header className="conversation-header"><span className="contact-avatar">{selectedContact.fullName.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase()}</span><div><strong>{selectedContact.fullName}</strong><small>{selectedContact.role}</small></div></header>
          <div className="conversation-messages" aria-live="polite">
            {messages.map(message=><div key={message.id} className={`message-bubble ${message.senderId===user.id?'sent':'received'}`}><p>{message.body}</p><time>{new Date(message.createdAt).toLocaleString()}</time></div>)}
            {!messages.length&&<div className="empty-small">Start a conversation with {selectedContact.fullName}.</div>}
          </div>
          <form className="message-composer" onSubmit={sendMessage}><textarea aria-label="Write a message" rows={2} maxLength={4000} value={draft} onChange={event=>setDraft(event.target.value)} placeholder="Write a message…"/><button className="primary-btn" type="submit" disabled={busy||!draft.trim()} aria-label="Send message">{busy?'Sending…':<>Send <Send size={15}/></>}</button></form>
        </>:<div className="message-empty"><MessageCircle size={28}/><strong>Select a contact</strong><span>Choose someone from the list to view or start a conversation.</span></div>}
      </div>
    </div>
  </section>;
}

function ModulePage({page,token,user,onSaved,onMessage}:{page:string;token:string;user:User;onSaved:()=>void;onMessage:(contactId:string)=>void}) {
  const [rows,setRows]=useState<any[]>([]),[students,setStudents]=useState<any[]>([]),[subjects,setSubjects]=useState<any[]>([]),[classes,setClasses]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[report,setReport]=useState<any|null>(null);
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [date,setDate]=useState(new Date().toISOString().slice(0,10)),[classId,setClassId]=useState('');
  const money=(amount:string|number)=>new Intl.NumberFormat('en-ZM',{style:'currency',currency:'ZMW',maximumFractionDigits:2}).format(Number(amount||0));
  async function load(){try{const path=page==='Staff'?'/staff':page==='Parents'?'/parents':page==='Subjects'?'/subjects':page==='Classes'?'/classes':page==='Attendance'?`/attendance?date=${date}&classId=${classId}`:page==='Academic results'?'/marks':page==='Fees'?'/fees':page==='Announcements'?'/announcements':page==='Reports'?'/students?status=active&limit=200':'/events';const d=await request(path,token);setRows(d.staff||d.parents||d.subjects||d.classes||d.records||d.marks||d.invoices||d.announcements||d.students||d.events||[]);if(['Attendance','Academic results','Subjects','Classes'].includes(page)){const c=await request('/subjects',token);setSubjects(c.subjects)}if(['Attendance','Academic results','Fees','Reports','Parents'].includes(page)){const s=await request('/students?status=active&limit=200',token);setStudents(s.students)}if(page==='Attendance'){const c=await request('/classes',token);setClasses(c.classes)}}catch(e){setError(e instanceof Error?e.message:'Could not load this section.')}}
  useEffect(()=>{load()},[page,date,classId]);
  useEffect(()=>{if(page==='Parents')request('/messages/contacts',token).then(d=>setContacts(d.contacts)).catch(()=>setContacts([]))},[page,token]);
  async function submit(e:React.FormEvent<HTMLFormElement>,path:string,after?:()=>void){e.preventDefault();const form=e.currentTarget;setBusy(true);setError('');try{const fd=new FormData(form);const body:Record<string,any>=Object.fromEntries(fd.entries());for(const field of Array.from(form.querySelectorAll<HTMLSelectElement>('select[multiple]')))body[field.name]=Array.from(field.selectedOptions).map(option=>option.value);for(const key of ['academicYear','score','maximumScore','amount'])if(body[key])body[key]=Number(body[key]);if(body.startsAt)body.startsAt=new Date(body.startsAt).toISOString();if(body.endsAt)body.endsAt=new Date(body.endsAt).toISOString();else delete body.endsAt;if(body.dueDate==='')delete body.dueDate;if(body.stream==='')delete body.stream;await request(path,token,{method:'POST',body:JSON.stringify(body)});form.reset();after?.();await load();onSaved()}catch(err){setError(err instanceof Error?err.message:'Could not save changes.')}finally{setBusy(false)}}
  const input=(name:string,label:string,type='text',required=true)=><label>{label}<input name={name} type={type} required={required}/></label>;
  const select=(name:string,label:string,options:{value:string,label:string}[])=> <label>{label}<select name={name} required defaultValue=""><option value="" disabled>Select…</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
  return <section className="panel students-panel"><div className="panel-head"><div><h3>{page}</h3><p>Manage school records and day to day workflows</p></div></div>{error&&<div className="error-banner">{error}</div>}
  {page==='Staff'&&<><h4>Staff accounts</h4>{rows.map(r=><div className="quick-action" key={r.id}><span>{r.id===user.id?<strong>{r.fullName}</strong>:<button type="button" className="contact-name" onClick={()=>onMessage(r.id)}>{r.fullName}<MessageCircle size={14}/></button>}<small>{r.email} · {r.role} · {r.isActive?'Active':'Inactive'}</small></span>{user.role==='admin'&&<button className="secondary-btn" onClick={async()=>{await request(`/staff/${r.id}`,token,{method:'PATCH',body:JSON.stringify({isActive:!r.isActive})});load()}}>{r.isActive?'Deactivate':'Reactivate'}</button>}</div>)}{user.role==='admin'&&<form className="form-grid module-form" onSubmit={e=>submit(e,'/staff')}>{input('fullName','Full name')}{input('email','Email','email')}{select('role','Role',['admin','headteacher','registrar','teacher'].map(x=>({value:x,label:x})))}{input('password','Temporary password (10+ characters)','password')}<button className="primary-btn" disabled={busy}>Create staff account</button></form>}</>}
  {page==='Parents'&&<><form className="form-grid module-form" onSubmit={e=>submit(e,'/parents')}>{input('fullName','Parent or guardian full name')}{input('phone','Phone number','tel')}{input('email','Email address','email',false)}{input('relationship','Relationship (e.g. Mother, Father, Guardian)')}<label className="span-two">Link learner(s)<select name="studentIds" multiple required size={Math.min(Math.max(students.length,2),6)}>{students.map(s=><option key={s.id} value={s.id}>{s.firstName} {s.lastName} · {s.admissionNumber}</option>)}</select><small>Hold Ctrl (Windows) or Command (Mac) to select more than one.</small></label><button className="primary-btn" disabled={busy}>Save parent</button></form><div className="table-wrap"><table><thead><tr><th>PARENT / GUARDIAN</th><th>RELATIONSHIP</th><th>PHONE</th><th>EMAIL</th><th>LINKED LEARNERS</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.fullName}</strong></td><td>{r.relationship}</td><td>{r.phone}</td><td>{r.email||'—'}</td><td>{(r.children||[]).map((c:any)=>c.name).join(', ')||'—'}</td></tr>)}{!rows.length&&<tr><td colSpan={5} className="empty-cell">No parent records yet. Save a parent above to get started.</td></tr>}</tbody></table></div></>}
  {page==='Subjects'&&<><form className="form-grid module-form" onSubmit={e=>submit(e,'/subjects')}>{input('code','Subject code')}{input('name','Subject name')}<button className="primary-btn" disabled={busy}>Save subject</button></form><div className="table-wrap"><table><thead><tr><th>SUBJECT NAME</th><th>CODE</th><th>STATUS</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.code}</td><td><span className="status-badge">{r.isActive?'Active':'Inactive'}</span></td></tr>)}{!rows.length&&<tr><td colSpan={3} className="empty-cell">No subjects yet. Add a subject above.</td></tr>}</tbody></table></div></>}
  {page==='Classes'&&<><h4>Class register</h4>{rows.map(r=><div className="quick-action" key={r.id}><span><strong>{r.name} · {r.academicYear}</strong><small>{r.gradeLevel} / {r.stream} · {r.studentCount} learners</small></span></div>)}<form className="form-grid module-form" onSubmit={e=>submit(e,'/classes')}>{input('name','Class name')}{input('gradeLevel','Grade / level')}{input('stream','Stream', 'text',false)}{input('academicYear','Academic year','number')}<button className="primary-btn" disabled={busy}>Save class</button></form></>}

  {page==='Attendance'&&<><div className="table-tools"><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Class<select value={classId} onChange={e=>setClassId(e.target.value)}><option value="">All classes</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name} · {c.academicYear}</option>)}</select></label></div><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{const records=rows.map((r,i)=>({studentId:r.studentId,status:(new FormData(e.currentTarget).get(`status-${i}`)||'present'),note:''}));await request('/attendance',token,{method:'POST',body:JSON.stringify({date,records})});onSaved();load()}catch(err){setError(err instanceof Error?err.message:'Could not save attendance.')}finally{setBusy(false)}}}><div className="table-wrap"><table><thead><tr><th>LEARNER</th><th>CLASS</th><th>STATUS</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.studentId}><td>{r.firstName} {r.lastName} · {r.admissionNumber}</td><td>{r.className||'Unassigned'}</td><td><select name={`status-${i}`} defaultValue={r.status||'present'}>{['present','absent','late','excused'].map(s=><option key={s}>{s}</option>)}</select></td></tr>)}</tbody></table></div><button className="primary-btn" disabled={busy||!rows.length}>Save daily register</button></form></>}
  {page==='Academic results'&&<><form className="form-grid module-form" onSubmit={e=>submit(e,'/marks')}>{select('studentId','Learner',students.map(s=>({value:s.id,label:`${s.firstName} ${s.lastName} (${s.admissionNumber})`})))}{select('subjectId','Subject',subjects.map(s=>({value:s.id,label:s.name})))}{input('assessmentName','Assessment')}{input('term','Term (e.g. Term 1)')}{input('academicYear','Academic year','number')}{input('score','Score','number')}{input('maximumScore','Maximum score','number')}<button className="primary-btn" disabled={busy}>Save result</button></form><div className="table-wrap"><table><thead><tr><th>LEARNER</th><th>SUBJECT</th><th>ASSESSMENT</th><th>TERM / YEAR</th><th>SCORE</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.firstName} {r.lastName}</td><td>{r.subjectName}</td><td>{r.assessmentName}</td><td>{r.term} / {r.academicYear}</td><td>{r.score}/{r.maximumScore} ({r.percentage}%)</td></tr>)}</tbody></table></div></>}
  {page==='Fees'&&<><div className="module-summary"><strong>Track invoices, balances, and payments in one place.</strong><span>Amounts shown in Zambian Kwacha (ZMW).</span></div><form className="form-grid module-form" onSubmit={e=>submit(e,'/fees')}>{select('studentId','Learner',students.map(s=>({value:s.id,label:`${s.firstName} ${s.lastName} (${s.admissionNumber})`})))}{input('description','Fee description')}{input('term','Term')}{input('academicYear','Academic year','number')}{input('amount','Invoice amount (ZMW)','number')}{input('dueDate','Due date','date',false)}<button className="primary-btn" disabled={busy}>Create invoice</button></form><div className="table-wrap"><table><thead><tr><th>LEARNER</th><th>ITEM</th><th>TERM</th><th>INVOICED</th><th>PAID</th><th>BALANCE</th><th>RECORD PAYMENT</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.firstName} {r.lastName}<small className="table-sub">{r.admissionNumber}</small></td><td>{r.description}</td><td>{r.term} {r.academicYear}</td><td>{money(r.amount)}</td><td>{money(r.amountPaid)}</td><td><strong>{money(r.balance)}</strong><small className="table-sub">{r.status}</small></td><td>{Number(r.balance)>0&&<form className="payment-form" onSubmit={async e=>{e.preventDefault();const f=e.currentTarget;const fd=new FormData(f);try{await request(`/fees/${r.id}/payments`,token,{method:'POST',body:JSON.stringify({amount:Number(fd.get('amount')),method:fd.get('method')})});await load();onSaved()}catch(err){setError(err instanceof Error?err.message:'Could not save payment.')}}}><input aria-label="Payment amount" name="amount" type="number" min="0.01" max={r.balance} step="0.01" placeholder="Amount" required/><select name="method"><option>cash</option><option>bank transfer</option><option>mobile money</option><option>card</option></select><button className="secondary-btn">Record</button></form>}</td></tr>)}</tbody></table></div></>}
  {page==='Announcements'&&<><form className="form-grid module-form" onSubmit={e=>submit(e,'/announcements')}>{input('title','Announcement title')}<label className="span-two">Message<textarea name="body" rows={4} required maxLength={10000}/></label><button className="primary-btn" disabled={busy}>Save as draft</button></form><div className="announcement-list">{rows.map(r=><article className="announcement-card" key={r.id}><div className="announcement-meta"><span className={`status-pill ${r.published?'paid':'unpaid'}`}>{r.published?'Published':'Draft'}</span><span>{new Date(r.createdAt).toLocaleDateString()}</span></div><h4>{r.title}</h4><p>{r.body}</p><button className="secondary-btn" onClick={async()=>{try{await request(`/announcements/${r.id}`,token,{method:'PATCH',body:JSON.stringify({published:!r.published})});await load();onSaved()}catch(e){setError(e instanceof Error?e.message:'Could not update announcement.')}}}>{r.published?'Unpublish':'Publish announcement'}</button></article>)}</div></>}
  {page==='Reports'&&<><form className="form-grid module-form" onSubmit={async e=>{e.preventDefault();const f=e.currentTarget;const fd=new FormData(f);try{const sid=String(fd.get('studentId'));const term=encodeURIComponent(String(fd.get('term')||''));const year=String(fd.get('academicYear'));setReport(await request(`/reports/students/${sid}?term=${term}&year=${year}`,token))}catch(err){setError(err instanceof Error?err.message:'Could not create report.')}}}>{select('studentId','Learner',students.map(s=>({value:s.id,label:`${s.firstName} ${s.lastName} (${s.admissionNumber})`})))}{input('term','Term (leave blank for full year)','text',false)}{input('academicYear','Academic year','number')}<button className="primary-btn">Generate report</button></form>{report&&<article className="report-sheet"><header><div><span className="eyebrow">SCHOOL MANAGEMENT SYSTEM</span><h2>Student Report</h2></div><button className="secondary-btn no-print" onClick={()=>window.print()}>Print report</button></header><p><strong>{report.student.firstName} {report.student.lastName}</strong> · {report.student.admissionNumber} · {report.student.className||'No class assigned'}</p><p>{report.term||'Full year'} · {report.academicYear}</p><div className="stat-grid report-stats"><div className="stat-card"><span>Attendance</span><strong>{report.attendance.recorded?Math.round(report.attendance.present/report.attendance.recorded*100):0}%</strong></div><div className="stat-card"><span>Days recorded</span><strong>{report.attendance.recorded}</strong></div><div className="stat-card"><span>Late arrivals</span><strong>{report.attendance.late}</strong></div></div><div className="table-wrap"><table><thead><tr><th>SUBJECT</th><th>ASSESSMENT</th><th>SCORE</th><th>PERCENT</th></tr></thead><tbody>{report.marks.map((m:any,i:number)=><tr key={i}><td>{m.subjectName}</td><td>{m.assessmentName}</td><td>{m.score} / {m.maximumScore}</td><td>{m.percentage}%</td></tr>)}</tbody></table></div></article>}</>}
  {page==='Calendar'&&<><form className="form-grid module-form" onSubmit={e=>submit(e,'/events')}>{input('title','Event title')}{input('startsAt','Starts','datetime-local')}{input('endsAt','Ends','datetime-local',false)}<label className="span-two">Description<textarea name="description" rows={3}/></label><button className="primary-btn" disabled={busy}>Add calendar event</button></form>{rows.map(r=><div className="quick-action" key={r.id}><CalendarDays/><span><strong>{r.title}</strong><small>{new Date(r.startsAt).toLocaleString()} {r.description&&`· ${r.description}`}</small></span></div>)}</>}
  </section>
}


const colorThemes = [
  { id: 'forest', name: 'Forest', category: 'Calm · Natural', description: 'A grounded green palette for a focused school workspace.', colors: ['#173d36','#21644f','#d4eadf','#f3f6f3'] },
  { id: 'ocean', name: 'Ocean', category: 'Clear · Confident', description: 'Crisp blues and cool neutrals with a professional feel.', colors: ['#18385f','#2867b9','#dceaff','#f3f6fb'] },
  { id: 'royal', name: 'Royal', category: 'Bold · Academic', description: 'Deep indigo, vivid violet, and soft lavender accents.', colors: ['#29264f','#6255b5','#e8e5ff','#f5f4fb'] },
  { id: 'terracotta', name: 'Terracotta', category: 'Warm · Welcoming', description: 'Rich clay tones balanced with warm cream surfaces.', colors: ['#57372f','#a8563d','#f4ded2','#faf6f1'] },
  { id: 'lagoon', name: 'Lagoon', category: 'Fresh · Modern', description: 'A lively teal palette with airy mint highlights.', colors: ['#164b50','#168078','#d8f0eb','#f1f7f6'] },
  { id: 'midnight', name: 'Midnight', category: 'Dark · Focused', description: 'A darker interface with bright, readable accents.', colors: ['#111827','#4f8cff','#283548','#182131'] },
];

function AppearancePage({theme,onTheme}:{theme:string;onTheme:(id:string)=>void}) {
  const [query,setQuery]=useState('');
  const matching=colorThemes.filter(t=>`${t.name} ${t.category} ${t.description}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="appearance-page">
    <div className="appearance-intro"><div><span className="pill"><Palette size={13}/> WORKSPACE PERSONALISATION</span><h2>Find your school’s look.</h2><p>Search the palette library and preview a theme before applying it. Your choice is saved on this device.</p></div><div className="appearance-badge"><Palette size={19}/><span><strong>{colorThemes.length} palettes</strong><small>Curated for school admin</small></span></div></div>
    <label className="theme-search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search palettes by name or mood…"/><span>{matching.length} themes</span></label>
    {matching.length ? <div className="theme-grid">{matching.map(t=><article className={`theme-card ${theme===t.id?'selected':''}`} key={t.id}>
      <div className={`theme-preview preview-${t.id}`}><div className="preview-sidebar"><i/><i/><i/></div><div className="preview-main"><div className="preview-top"/><div className="preview-hero"/><div className="preview-stats"><i/><i/><i/></div></div><span className="preview-label">LIVE PREVIEW</span></div>
      <div className="theme-card-body"><div className="theme-card-title"><div><h3>{t.name}</h3><span>{t.category}</span></div>{theme===t.id&&<span className="applied-label"><Check size={13}/> Applied</span>}</div><p>{t.description}</p><div className="swatches" aria-label={`${t.name} palette`}>{t.colors.map(color=><i key={color} style={{backgroundColor:color}}/>)}</div><button className={theme===t.id?'theme-applied':'theme-apply'} onClick={()=>onTheme(t.id)}>{theme===t.id?'Currently applied':'Preview and apply'}{theme!==t.id&&<ArrowUpRight size={15}/>}</button></div>
    </article>)}</div> : <div className="theme-empty"><Search size={22}/><strong>No palettes found</strong><span>Try a color or mood such as “blue”, “warm”, or “calm”.</span></div>}
  </section>;
}
