console.log('SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL);
console.log('HAS_ANON', !!import.meta.env.VITE_SUPABASE_ANON_KEY);

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { motion } from "framer-motion";
import { Plus, Save, Upload, Image as ImageIcon, FileJson, Trash2, Download, FileUp, Coins, ClipboardList, FolderOpen, Settings, Users, Home, Building2, Calendar, CheckCircle2, AlertCircle, MapPin, Phone, Mail, FileText, Camera, NotebookPen, ChevronDown, Printer, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * === Supabase Setup ===
 * Buckets: photos, docs (public)
 * Table: projects (+ RLS using project_members), project_members, profiles
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnon);

// --- Small utilities ---
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const money = (n) => (isFinite(n) ? n.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "$ 0.00");
const readFileAsDataUrl = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
const sleep = (ms)=> new Promise(r=> setTimeout(r, ms));

const DEFAULT_TAX = 0.0725; // 7.25% — change per locale
const STATUS_COLORS = { Lead: "bg-gray-200 text-gray-700", Estimating: "bg-amber-100 text-amber-700", Scheduled: "bg-blue-100 text-blue-700", InProgress: "bg-purple-100 text-purple-700", Complete: "bg-emerald-100 text-emerald-700", Invoiced: "bg-slate-200 text-slate-800" };

/** @typedef {{ id:string, name:string, address:string, city:string, state:string, zip:string, client:{name:string, phone:string, email:string}, status:string, startDate?:string, endDate?:string, notes: Note[], photos: Photo[], pricing: PricingLine[], taxRate:number, tasks: Task[], docs: Doc[] }} Project */
/** @typedef {{ id:string, text:string, createdAt:number }} Note */
/** @typedef {{ id:string, url:string, caption?:string, addedAt:number }} Photo */
/** @typedef {{ id:string, item:string, qty:number, unit:number, category?:string, taxable:boolean }} PricingLine */
/** @typedef {{ id:string, text:string, done:boolean }} Task */
/** @typedef {{ id:string, name:string, url:string }} Doc */

export default function ConstructionProjectManager() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setLoading(false);
    });
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => authSub.subscription.unsubscribe();
  }, []);

  if (loading) return (<div className="min-h-screen grid place-items-center text-slate-600">Loading…</div>);
  if (!session) return <AuthScreen />;
  return <AppShell session={session} />;
}

function AuthScreen(){
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("signin");
  const [err, setErr] = useState("");
  async function submit(){
    setErr("");
    try{
      if(mode==="signup"){
        const { error } = await supabase.auth.signUp({ email, password });
        if(error) throw error; alert("Check your inbox to confirm your email.");
      }else{
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if(error) throw error;
      }
    }catch(e){ setErr(e.message); }
  }
  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-b from-slate-50 to-white">
      <Card className="w-full max-w-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl flex items-center gap-2"><Home className="w-5 h-5"/>Construction Project Manager</CardTitle>
          <CardDescription>Sign {mode === 'signup' ? 'up' : 'in'} to sync projects securely.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Email"><Input type="email" value={email} onChange={(e)=> setEmail(e.target.value)} /></Field>
          <Field label="Password"><Input type="password" value={password} onChange={(e)=> setPassword(e.target.value)} /></Field>
          {err && <div className="text-sm text-red-600">{err}</div>}
          <Button onClick={submit} className="w-full"><LogIn className="w-4 h-4 mr-1"/>{mode==='signup'? 'Create account' : 'Sign in'}</Button>
          <button className="text-xs text-slate-500" onClick={()=> setMode(mode==='signup'?'signin':'signup')}>
            {mode==='signup'? 'Have an account? Sign in' : "New here? Create an account"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

function AppShell({ session }){
  const user = session.user;
  const [projects, setProjects] = useState([]);
  const [showShareDialog, setShowShareDialog] = React.useState(false);
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  // Ensure my profile exists (so we can find users by email when sharing)
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('profiles').upsert({ id: user.id, email: (user.email || '').toLowerCase() }).then(()=>{});
  }, [user?.id]);

  // Initial load & realtime
  useEffect(() => { loadProjects(); }, []);
  useEffect(() => {
    const channel = supabase.channel('projects-ch')
      .on('postgres_changes', { event:'*', schema:'public', table:'projects' }, () => {
        // With RLS, we only receive rows we're allowed to see
        loadProjects();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadProjects(){
    setBusy(true);
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending:false }); // RLS restricts to my member projects
    if(!error){
      const mapped = (data||[]).map(row => rowToProject(row));
      setProjects(mapped);
      if(mapped.length && !activeId) setActiveId(mapped[0].id);
    } else {
      console.error(error);
    }
    setBusy(false);
  }

  async function addProject(){
    const draft = {
      name:'New Project', address:'', city:'', state:'', zip:'',
      client:{ name:'', phone:'', email:'' },
      status:'Lead', startDate:'', endDate:'',
      notes:[], photos:[], pricing:[], tasks:[], docs:[], taxRate: DEFAULT_TAX,
    };

    // Build row; DB will generate UUID id
    const baseRow = projectToRow(draft, user.id);

    // Include created_by so policies allow insert; keep owner_id for legacy NOT NULL
    const insertRow = { ...baseRow, created_by: user.id, owner_id: user.id };

    const { data: proj, error: insErr } = await supabase
      .from('projects')
      .insert([insertRow])
      .select()
      .single();
    if (insErr) { alert('Create failed: ' + insErr.message); return; }

    // Add me as OWNER in membership table
    const { error: memErr } = await supabase
      .from('project_members')
      .insert([{ project_id: proj.id, user_id: user.id, role: 'owner' }]);
    if (memErr) { alert('Membership failed: ' + memErr.message); /* don’t bail; we still show it */ }

    const mapped = rowToProject(proj);
    setProjects(prev => [mapped, ...prev]);
    setActiveId(proj.id);
  }

  async function saveProject(p){
    const { error } = await supabase
      .from('projects')
      .update(projectToRow(p, user.id))
      .eq('id', p._row_id || p.id); // RLS ensures only editors/owners can update
    if(error) console.error(error);
  }

  async function deleteProject(p){
    if(!confirm('Delete this project?')) return;
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', p._row_id || p.id); // RLS ensures only owners can delete
    if(error) alert('Delete failed: ' + error.message);
  }

  // Debounced autosave on change
  const saveTimers = useRef({});
  function updateActive(mutator){
    setProjects(prev => prev.map(p => p.id===activeId ? mutator({ ...p }) : p));
    const proj = projects.find(p=> p.id===activeId);
    if(!proj) return;
    const updated = mutator({ ...proj });
    clearTimeout(saveTimers.current[activeId]);
    saveTimers.current[activeId] = setTimeout(()=> saveProject(updated), 600);
  }

  const filtered = useMemo(() => {
    if (!query) return projects;
    const q = query.toLowerCase();
    return projects.filter(p => [p.name, p.address, p.client?.name, p.client?.phone, p.client?.email, p.city].join(" ").toLowerCase().includes(q));
  }, [projects, query]);

  const active = useMemo(() => projects.find(p => p.id === activeId) || null, [projects, activeId]);

  // Export/Import (JSON backup)
  function exportAll(){
    const blob = new Blob([JSON.stringify(projects, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `construction-projects-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
  }
  async function importAll(file){
    try{
      const text = await file.text();
      const data = JSON.parse(text);
      if(!Array.isArray(data)) throw new Error('Invalid file');
      for(const p of data){
        const row = projectToRow(p, user.id); // guarded id
        await supabase.from('projects').upsert(row);
      }
      await sleep(200);
      loadProjects();
    }catch(e){ alert('Import failed: ' + e.message); }
  }

  async function signOut(){ await supabase.auth.signOut(); }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="sticky top-0 z-40 backdrop-blur bg-white/70 border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-2">
          <Home className="w-5 h-5" />
          <h1 className="text-xl font-semibold">Construction Project Manager</h1>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" onClick={addProject}><Plus className="w-4 h-4 mr-1"/>New Project</Button>
            <Button variant="outline" onClick={exportAll}><Download className="w-4 h-4 mr-1"/>Export</Button>
            <FileImport onImport={importAll} />
            <Button variant="outline" onClick={signOut}><LogOut className="w-4 h-4 mr-1"/>Sign out</Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 grid md:grid-cols-[360px,1fr] gap-4">
        <aside className="space-y-3">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Projects</CardTitle>
              <CardDescription>Search and select</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input placeholder="Search by name, address, client..." value={query} onChange={(e)=> setQuery(e.target.value)} />
              <div className="max-h-[60vh] overflow-auto divide-y">
                {filtered.map(p => (
                  <button key={p.id} onClick={()=> setActiveId(p.id)} className={`w-full text-left py-3 px-2 hover:bg-slate-50 flex items-center gap-2 ${activeId===p.id ? "bg-slate-100" : ""}`}>
                    <div className="flex-1">
                      <div className="font-medium line-clamp-1">{p.name || "Untitled"}</div>
                      <div className="text-xs text-slate-500 line-clamp-1">{p.address || "No address"}</div>
                    </div>
                    <Badge className={STATUS_COLORS[p.status] + " whitespace-nowrap"}>{p.status}</Badge>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="text-sm text-slate-500 p-3">No projects yet.</div>
                )}
              </div>
            </CardContent>
          </Card>

          <QuickTips backend />
        </aside>

        <section>
          {!active ? (
            <EmptyState onCreate={addProject} />
          ) : (
            <ProjectDetail
              project={active}
              onChange={updateActive}
              onDelete={()=> deleteProject(active)}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function FileImport({ onImport }){
  const ref = useRef(null);
  return (
    <>
      <input ref={ref} type="file" accept="application/json" className="hidden" onChange={(e)=> e.target.files?.[0] && onImport(e.target.files[0])} />
      <Button variant="outline" onClick={()=> ref.current?.click()}><FileUp className="w-4 h-4 mr-1"/>Import</Button>
    </>
  );
}

function EmptyState({ onCreate }) {
  return (
    <Card className="h-full flex items-center justify-center shadow-sm">
      <CardContent className="text-center py-16">
        <Building2 className="w-10 h-10 mx-auto mb-2"/>
        <h2 className="text-lg font-semibold">No project selected</h2>
        <p className="text-slate-600 mb-4">Create your first job to get moving.</p>
        <Button onClick={onCreate}><Plus className="w-4 h-4 mr-1"/>New Project</Button>
      </CardContent>
    </Card>
  );
}

function QuickTips({ backend }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2"><CardTitle className="text-base">Workflow shortcuts</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-2 text-slate-700">
        <div className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5"/><p>{backend? 'Sign in, then create a project. Everything syncs to Supabase.' : 'Create a project, add address & client, then build your estimate with line items.'}</p></div>
        <div className="flex items-start gap-2"><ImageIcon className="w-4 h-4 mt-0.5"/><p>Photos/docs upload to Supabase Storage. URLs are saved in the project.</p></div>
        <div className="flex items-start gap-2"><Coins className="w-4 h-4 mt-0.5"/><p>Use Pricing to auto-sum material & labor. Set tax rate per job.</p></div>
        <div className="flex items-start gap-2"><FileJson className="w-4 h-4 mt-0.5"/><p>Export/Import JSON to migrate or back up.</p></div>
      </CardContent>
    </Card>
  );
}

function ProjectDetail({ project, onChange, onDelete }) {
  const [tab, setTab] = useState("overview");

  const totals = useMemo(() => {
    const sub = project.pricing.reduce((s, r) => s + (Number(r.qty)||0) * (Number(r.unit)||0), 0);
    const taxable = project.pricing.filter(r => r.taxable).reduce((s, r) => s + (Number(r.qty)||0) * (Number(r.unit)||0), 0);
    const tax = taxable * (Number(project.taxRate) || 0);
    const grand = sub + tax;
    return { sub, tax, grand };
  }, [project]);

              <Button variant="outline" onClick={() => setShowShareDialog(true)}>Share</Button>
              <ShareDialog projectId={project.id} open={showShareDialog} onClose={() => setShowShareDialog(false)} />
  // Print packet
  function printPacket() {
    const w = window.open("", "_blank"); if (!w) return;
    const html = `<!doctype html><html><head><meta charset='utf-8'><title>${project.name} – Job Packet</title>
      <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px}h1{margin:0 0 8px}.muted{color:#475569}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e2e8f0;padding:6px 8px;font-size:12px}th{background:#f8fafc;text-align:left}.totals{margin-top:8px;text-align:right}.photos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:8px}.photos img{width:100%;height:120px;object-fit:cover;border:1px solid #e2e8f0}</style></head><body>
      <h1>${project.name}</h1>
      <div class="muted">${project.address || ""} ${project.city||""} ${project.state||""} ${project.zip||""}</div>
      <div class="muted">Client: ${project.client?.name||""} | ${project.client?.phone||""} | ${project.client?.email||""}</div>
      <h2>Pricing</h2>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th><th>Cat.</th><th>Tax</th></tr></thead><tbody>
        ${project.pricing.map(r=>`<tr><td>${escapeHtml(r.item)}</td><td>${r.qty}</td><td>${money(r.unit)}</td><td>${money((Number(r.qty)||0)*(Number(r.unit)||0))}</td><td>${escapeHtml(r.category||"")}</td><td>${r.taxable?"Yes":"No"}</td></tr>`).join("")}
      </tbody></table>
      <div class="totals">Subtotal ${money(totals.sub)} | Tax ${money(totals.tax)} | <strong>Total ${money(totals.grand)}</strong></div>
      <h2>Notes</h2>
      <ul>${project.notes.map(n=>`<li>${new Date(n.createdAt).toLocaleString()} – ${escapeHtml(n.text)}</li>`).join("")}</ul>
      <h2>Photos</h2>
      <div class="photos">${project.photos.map(p=>`<img src="${p.url}"/>`).join("")}</div>
      </body></html>`;
    w.document.write(html); w.document.close(); w.focus(); w.print();
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-xl flex items-center gap-2">
            <NotebookPen className="w-5 h-5"/>
            <InlineEdit value={project.name} onChange={(v)=> onChange(p=> ({...p, name:v}))} placeholder="Project name"/>
          </CardTitle>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={printPacket}><Printer className="w-4 h-4 mr-1"/>Print packet</Button>
            <DangerMenu onDelete={onDelete} />
          </div>
        </div>
        <CardDescription className="flex items-center gap-2 flex-wrap">
          <Badge className={STATUS_COLORS[project.status]}>{project.status}</Badge>
          <StatusPicker value={project.status} onChange={(s)=> onChange(p=> ({...p, status:s}))} />
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="overview"><FolderOpen className="w-4 h-4 mr-1"/>Overview</TabsTrigger>
            <TabsTrigger value="notes"><FileText className="w-4 h-4 mr-1"/>Notes</TabsTrigger>
            <TabsTrigger value="photos"><Camera className="w-4 h-4 mr-1"/>Photos</TabsTrigger>
            <TabsTrigger value="pricing"><Coins className="w-4 h-4 mr-1"/>Pricing</TabsTrigger>
            <TabsTrigger value="tasks"><ClipboardList className="w-4 h-4 mr-1"/>Tasks</TabsTrigger>
            <TabsTrigger value="docs"><Upload className="w-4 h-4 mr-1"/>Docs</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="shadow-none border">
                <CardHeader className="pb-2"><CardTitle className="text-base">Job Info</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Address"><Input value={project.address} onChange={(e)=> onChange(p=> ({...p, address:e.target.value}))} placeholder="123 Main St"/></Field>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="City"><Input value={project.city} onChange={(e)=> onChange(p=> ({...p, city:e.target.value}))}/></Field>
                    <Field label="State"><Input value={project.state} onChange={(e)=> onChange(p=> ({...p, state:e.target.value}))}/></Field>
                    <Field label="ZIP"><Input value={project.zip} onChange={(e)=> onChange(p=> ({...p, zip:e.target.value}))}/></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Start Date"><Input type="date" value={project.startDate||""} onChange={(e)=> onChange(p=> ({...p, startDate:e.target.value}))}/></Field>
                    <Field label="End Date"><Input type="date" value={project.endDate||""} onChange={(e)=> onChange(p=> ({...p, endDate:e.target.value}))}/></Field>
                  </div>
                </CardContent>
              </Card>
              <Card className="shadow-none border">
                <CardHeader className="pb-2"><CardTitle className="text-base">Client</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Name"><Input value={project.client?.name} onChange={(e)=> onChange(p=> ({...p, client:{...p.client, name:e.target.value}}))}/></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Phone"><Input value={project.client?.phone} onChange={(e)=> onChange(p=> ({...p, client:{...p.client, phone:e.target.value}}))}/></Field>
                    <Field label="Email"><Input type="email" value={project.client?.email} onChange={(e)=> onChange(p=> ({...p, client:{...p.client, email:e.target.value}}))}/></Field>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="notes">
            <NotesTab project={project} onChange={onChange} />
          </TabsContent>

          <TabsContent value="photos">
            <PhotosTab project={project} onChange={onChange} />
          </TabsContent>

          <TabsContent value="pricing">
            <PricingTab project={project} onChange={onChange} totals={totals} />
          </TabsContent>

          <TabsContent value="tasks">
            <TasksTab project={project} onChange={onChange} />
          </TabsContent>

          <TabsContent value="docs">
            <DocsTab project={project} onChange={onChange} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function NotesTab({ project, onChange }) {
  const [text, setText] = useState("");
  function addNote() {
    if (!text.trim()) return;
    onChange(p=> ({...p, notes:[{ id:uid(), text:text.trim(), createdAt:Date.now() }, ...p.notes]}));
    setText("");
  }
  return (
    <div className="grid md:grid-cols-[1fr] gap-4">
      <Card className="shadow-none border">
        <CardHeader className="pb-2"><CardTitle className="text-base">Add Note</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Textarea rows={3} value={text} onChange={(e)=> setText(e.target.value)} placeholder="Site conditions, homeowner preferences, change orders, etc."/>
          <div className="flex justify-end"><Button onClick={addNote}><Plus className="w-4 h-4 mr-1"/>Add</Button></div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {project.notes.length === 0 && <div className="text-sm text-slate-500">No notes yet.</div>}
        {project.notes.map(n => (
          <Card key={n.id} className="shadow-none border">
            <CardHeader className="pb-1"><CardDescription>{new Date(n.createdAt).toLocaleString()}</CardDescription></CardHeader>
            <CardContent className="whitespace-pre-wrap">{n.text}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PhotosTab({ project, onChange }) {
  const inputRef = useRef(null);
  async function handleFiles(files) {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    // Upload to Supabase Storage (bucket: photos)
    const uploaded = [];
    for (const f of arr){
      const path = `${project.id}/${Date.now()}-${f.name}`;
      const { error } = await supabase.storage.from('photos').upload(path, f, { upsert:false });
      if(error){ alert('Upload failed: ' + error.message); continue; }
      const { data } = supabase.storage.from('photos').getPublicUrl(path);
      uploaded.push({ id:uid(), url:data.publicUrl, caption:f.name, addedAt: Date.now() });
    }
    if(uploaded.length){ onChange(p=> ({...p, photos:[...uploaded, ...p.photos]})); }
  }
  function remove(photo){
    onChange(p=> ({...p, photos:p.photos.filter(ph=> ph.id!==photo.id)}));
    // Optional: remove from storage too (best-effort)
    try{
      const key = photo.url.split('/').slice(-2).join('/'); // fragile; keep URLs simple
      supabase.storage.from('photos').remove([key]);
    }catch{}
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e)=> handleFiles(e.target.files)} />
        <Button onClick={()=> inputRef.current?.click()}><ImageIcon className="w-4 h-4 mr-1"/>Add Photos</Button>
        <p className="text-sm text-slate-500">Stored in Supabase Storage.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {project.photos.map(ph => (
          <div key={ph.id} className="group relative border rounded-xl overflow-hidden">
            <img src={ph.url} alt={ph.caption||"photo"} className="w-full h-32 object-cover"/>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-xs text-white">{ph.caption}</div>
            <button onClick={()=> remove(ph)} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition bg-white/90 hover:bg-white text-red-600 p-1 rounded-md"><Trash2 className="w-4 h-4"/></button>
          </div>
        ))}
        {project.photos.length===0 && <div className="text-sm text-slate-500">No photos yet.</div>}
      </div>
    </div>
  );
}

function PricingTab({ project, onChange, totals }) {
  const [row, setRow] = useState({ item:"", qty:1, unit:0, category:"", taxable:true });
  function addRow() {
    if (!row.item.trim()) return;
    onChange(p=> ({...p, pricing:[{ id:uid(), ...row, qty:Number(row.qty)||0, unit:Number(row.unit)||0 }, ...p.pricing]}));
    setRow({ item:"", qty:1, unit:0, category:"", taxable:true });
  }
  function remove(id){ onChange(p=> ({...p, pricing:p.pricing.filter(r=> r.id!==id)})); }
  function updateRate(v){ onChange(p=> ({...p, taxRate:Number(v)})); }

  return (
    <div className="space-y-4">
      <Card className="shadow-none border">
        <CardHeader className="pb-2"><CardTitle className="text-base">Add Line Item</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-6 gap-2 items-end">
          <Field label="Item" className="md:col-span-2"><Input value={row.item} onChange={(e)=> setRow(s=> ({...s, item:e.target.value}))} placeholder="Tear-off & haul, shingles, drip edge..."/></Field>
          <Field label="Qty"><Input type="number" value={row.qty} onChange={(e)=> setRow(s=> ({...s, qty:e.target.value}))}/></Field>
          <Field label="Unit $"><Input type="number" value={row.unit} onChange={(e)=> setRow(s=> ({...s, unit:e.target.value}))}/></Field>
          <Field label="Category"><Input value={row.category} onChange={(e)=> setRow(s=> ({...s, category:e.target.value}))} placeholder="Labor, Material, Dump, Permit..."/></Field>
          <div className="flex items-center gap-2">
            <Checkbox id="taxable" checked={row.taxable} onCheckedChange={(v)=> setRow(s=> ({...s, taxable: !!v}))}/>
            <Label htmlFor="taxable">Taxable</Label>
          </div>
          <div className="md:col-span-6 flex justify-end"><Button onClick={addRow}><Plus className="w-4 h-4 mr-1"/>Add</Button></div>
        </CardContent>
      </Card>

      <Card className="shadow-none border">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Estimate</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="taxrate" className="text-sm text-slate-600">Tax rate</Label>
            <Input id="taxrate" type="number" step="0.0001" value={project.taxRate} onChange={(e)=> updateRate(e.target.value)} className="w-28" />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Taxable</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {project.pricing.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.item}</TableCell>
                  <TableCell>{r.qty}</TableCell>
                  <TableCell>{money(r.unit)}</TableCell>
                  <TableCell>{money((Number(r.qty)||0) * (Number(r.unit)||0))}</TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell>{r.taxable ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="icon" onClick={()=> remove(r.id)}><Trash2 className="w-4 h-4"/></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {project.pricing.length===0 && <div className="text-sm text-slate-500">No line items yet.</div>}
          <div className="mt-3 border-t pt-3 text-right text-sm space-y-1">
            <div>Subtotal: <strong>{money(totals.sub)}</strong></div>
            <div>Tax: <strong>{money(totals.tax)}</strong></div>
            <div className="text-base">Grand Total: <strong>{money(totals.grand)}</strong></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TasksTab({ project, onChange }) {
  const [text, setText] = useState("");
  function addTask(){ if(!text.trim()) return; onChange(p=> ({...p, tasks:[...p.tasks, { id:uid(), text:text.trim(), done:false }]})); setText(""); }
  function toggle(id, val){ onChange(p=> ({...p, tasks:p.tasks.map(t=> t.id===id? {...t, done:val}:t)})); }
  function remove(id){ onChange(p=> ({...p, tasks:p.tasks.filter(t=> t.id!==id)})); }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={text} onChange={(e)=> setText(e.target.value)} placeholder="Order dumpster, call utility locate, schedule crew, pull permit..."/>
        <Button onClick={addTask}><Plus className="w-4 h-4 mr-1"/>Add</Button>
      </div>
      <div className="space-y-2">
        {project.tasks.map(t => (
          <div key={t.id} className="flex items-center gap-3 p-2 border rounded-xl">
            <Checkbox id={t.id} checked={t.done} onCheckedChange={(v)=> toggle(t.id, !!v)} />
            <label htmlFor={t.id} className={`flex-1 ${t.done?"line-through text-slate-400":""}`}>{t.text}</label>
            <Button size="icon" variant="ghost" onClick={()=> remove(t.id)}><Trash2 className="w-4 h-4"/></Button>
          </div>
        ))}
        {project.tasks.length===0 && <div className="text-sm text-slate-500">No tasks yet.</div>}
      </div>
    </div>
  );
}

function DocsTab({ project, onChange }) {
  const inputRef = useRef(null);
  async function handleFiles(files){
    const arr = Array.from(files||[]);
    if(!arr.length) return;
    const uploaded = [];
    for (const f of arr){
      const path = `${project.id}/${Date.now()}-${f.name}`;
      const { error } = await supabase.storage.from('docs').upload(path, f, { upsert:false });
      if(error){ alert('Upload failed: ' + error.message); continue; }
      const { data } = supabase.storage.from('docs').getPublicUrl(path);
      uploaded.push({ id:uid(), name:f.name, url:data.publicUrl });
    }
    if(uploaded.length){ onChange(p=> ({...p, docs:[...uploaded, ...p.docs]})); }
  }
  function remove(doc){
    onChange(p=> ({...p, docs:p.docs.filter(d=> d.id!==doc.id)}));
    try{
      const key = doc.url.split('/').slice(-2).join('/');
      supabase.storage.from('docs').remove([key]);
    }catch{}
  }
  function download(doc){ const a=document.createElement("a"); a.href=doc.url; a.download=doc.name; a.click(); }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input ref={inputRef} type="file" className="hidden" onChange={(e)=> handleFiles(e.target.files)} />
        <Button onClick={()=> inputRef.current?.click()}><Upload className="w-4 h-4 mr-1"/>Upload Docs (PDF, etc.)</Button>
        <p className="text-sm text-slate-500">Stored in Supabase Storage.</p>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {project.docs.map(d => (
          <Card key={d.id} className="shadow-none border">
            <CardHeader className="pb-1"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4"/>{d.name}</CardTitle></CardHeader>
            <CardFooter className="justify-end gap-2">
              <Button size="sm" variant="outline" onClick={()=> download(d)}><Download className="w-4 h-4 mr-1"/>Download</Button>
              <Button size="icon" variant="ghost" onClick={()=> remove(d)}><Trash2 className="w-4 h-4"/></Button>
            </CardFooter>
          </Card>
        ))}
        {project.docs.length===0 && <div className="text-sm text-slate-500">No documents yet.</div>}
      </div>
    </div>
  );
}

function Field({ label, children, className }){
  return (
    <div className={className}>
      <div className="text-xs text-slate-600 mb-1">{label}</div>
      {children}
    </div>
  );
}

function InlineEdit({ value, onChange, placeholder }){
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  useEffect(()=> setVal(value||""), [value]);
  return (
    <div className="inline-flex items-center">
      {!editing ? (
        <button className="px-1 -mx-1 rounded hover:bg-slate-100" onClick={()=> setEditing(true)}>
          {value ? <span>{value}</span> : <span className="text-slate-400">{placeholder}</span>}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <Input autoFocus value={val} onChange={(e)=> setVal(e.target.value)} onKeyDown={(e)=> { if(e.key==='Enter'){ onChange(val); setEditing(false);} }} />
          <Button size="sm" onClick={()=> { onChange(val); setEditing(false); }}><Save className="w-4 h-4 mr-1"/>Save</Button>
        </div>
      )}
    </div>
  );
}

function StatusPicker({ value, onChange }){
  const statuses = Object.keys(STATUS_COLORS);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline"><Settings className="w-4 h-4 mr-1"/>Set Status<ChevronDown className="w-4 h-4 ml-1"/></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Project Status</DropdownMenuLabel>
        <DropdownMenuSeparator/>
        {statuses.map(s => (
          <DropdownMenuItem key={s} onClick={()=> onChange(s)}>
            <span className={`mr-2 inline-block w-2 h-2 rounded-full ${STATUS_COLORS[s].split(' ')[0]}`}></span>{s}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DangerMenu({ onDelete }){
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive"><Trash2 className="w-4 h-4 mr-1"/>Delete</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this project?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">This removes it from your account. Export first if you want a backup.</p>
        <DialogFooter>
          <Button variant="secondary">Cancel</Button>
          <Button variant="destructive" onClick={onDelete}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function escapeHtml(s=''){
  return s.replace(/[&<>"']/g, (c)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

// === Row <-> UI mapping helpers ===
function rowToProject(row){
  return {
    _row_id: row.id,
    id: row.id,
    name: row.name,
    address: row.address||'', city: row.city||'', state: row.state||'', zip: row.zip||'',
    status: row.status,
    startDate: row.start_date || '', endDate: row.end_date || '',
    client: row.client || {name:'', phone:'', email:''},
    pricing: row.pricing || [],
    notes: row.notes || [],
    tasks: row.tasks || [],
    photos: row.photos || [],
    docs: row.docs || [],
    taxRate: Number(row.tax_rate ?? DEFAULT_TAX),
  };
}

const isUUID = (s) => typeof s === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

function projectToRow(p, ownerId){
  const row = {
    owner_id: ownerId, // keep for legacy NOT NULL; policies rely on project_members
    name: p.name,
    address: p.address, city: p.city, state: p.state, zip: p.zip,
    status: p.status,
    start_date: p.startDate || null, end_date: p.endDate || null,
    client: p.client,
    pricing: p.pricing,
    notes: p.notes,
    tasks: p.tasks,
    photos: p.photos,
    docs: p.docs,
    tax_rate: p.taxRate,
    updated_at: new Date().toISOString(),
  };
  // Only pass id when it’s a real UUID (updates/upserts). Never send a fake id.
  const maybeId = p._row_id || p.id;
  if (isUUID(maybeId)) row.id = maybeId;
  return row;
}

function ShareDialog({ projectId }) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("viewer");

  async function shareProject() {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .single();

    if (!profile) {
      alert("User not found");
      return;
    }

    const { error } = await supabase.from("project_members").insert({
      project_id: projectId,
      user_id: profile.id,
      role,
    });

    if (error) {
      alert("Error: " + error.message);
    } else {
      alert("User added");
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Share</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Project</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="User email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="owner">Owner</option>
        </select>
        <Button onClick={shareProject}>Share</Button>
      </DialogContent>
    </Dialog>
  );
}