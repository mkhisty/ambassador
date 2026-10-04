'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, CalendarDays, Check, LoaderCircle, Mail, Unplug } from 'lucide-react';

export default function GoogleConnection({demo=false}) {
  const [connection,setConnection]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[eventForm,setEventForm]=useState(false),[eventDraft,setEventDraft]=useState({summary:'',start:'',end:''}),[eventUrl,setEventUrl]=useState('');
  async function load() {
    if (demo) { setConnection({demo:true}); return; }
    try {
      const response=await fetch('/api/google/status',{cache:'no-store'}),body=await response.json();
      if (!response.ok) throw new Error(body.error||'Could not load Google connection.');
      setConnection(body);setError('');
    } catch (cause) { setConnection(null);setError(cause.message); }
  }
  useEffect(()=>{load();const result=new URLSearchParams(location.search).get('google');if(result){setNotice(result==='connected'?'Google account connected.':'Google connection could not be completed. Try again.');history.replaceState(null,'',location.pathname);}},[demo]);
  async function connect() {
    setBusy(true);setError('');
    try {const response=await fetch('/api/google/connect',{method:'POST'}),body=await response.json();if(!response.ok)throw new Error(body.error||'Could not start Google sign-in.');location.assign(body.url);}
    catch(cause){setError(cause.message);setBusy(false);}
  }
  async function disconnect() {
    setBusy(true);setError('');setNotice('');
    try {const response=await fetch('/api/google/connection',{method:'DELETE'}),body=await response.json();if(!response.ok)throw new Error(body.error||'Could not disconnect Google.');setConnection({connected:false});setNotice(body.revoked?'Google account disconnected.':'Disconnected here; Google could not confirm revocation.');}
    catch(cause){setError(cause.message);}
    finally{setBusy(false);}
  }
  async function createEvent(event) {
    event.preventDefault();setBusy(true);setError('');setEventUrl('');
    try {
      const response=await fetch('/api/google/calendar/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({summary:eventDraft.summary,start:new Date(eventDraft.start).toISOString(),end:new Date(eventDraft.end).toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||'Could not create Calendar event.');
      setEventUrl(body.event.url);setNotice('Event created on your primary Google Calendar.');setEventForm(false);
    } catch(cause){setError(cause.message);}
    finally{setBusy(false);}
  }
  return <section className="panel google-connection"><h2>Google Workspace</h2><p>Connect your email and calendar to prepare drafts and schedule approved events.</p>
    <div className="google-services"><span><Mail size={15}/>Gmail drafts</span><span><CalendarDays size={15}/>Calendar events</span></div>
    {demo?<p className="google-muted">Sign in to connect Google.</p>:connection?.connected?<><div className="google-linked"><span><Check size={15}/>Connected as <strong>{connection.email}</strong></span><button className="button secondary" disabled={busy} onClick={disconnect}><Unplug size={14}/>{busy?'Disconnecting…':'Disconnect'}</button></div><button className="button secondary" disabled={busy} onClick={connect}><ArrowUpRight size={15}/>{busy?'Opening Google…':'Reconnect Google permissions'}</button><button className="button secondary" disabled={busy} onClick={()=>setEventForm(value=>!value)}><CalendarDays size={14}/>{eventForm?'Cancel':'Create calendar event'}</button>{eventForm&&<form className="google-event-form" onSubmit={createEvent}><label>Event title<input required maxLength={300} value={eventDraft.summary} onChange={e=>setEventDraft({...eventDraft,summary:e.target.value})}/></label><div><label>Starts<input required type="datetime-local" value={eventDraft.start} onChange={e=>setEventDraft({...eventDraft,start:e.target.value})}/></label><label>Ends<input required type="datetime-local" value={eventDraft.end} onChange={e=>setEventDraft({...eventDraft,end:e.target.value})}/></label></div><button className="button primary" disabled={busy}>{busy?'Creating…':'Add to Calendar'}</button></form>}{eventUrl&&<a className="google-open-link" href={eventUrl} target="_blank" rel="noreferrer">Open event in Google Calendar<ArrowUpRight size={13}/></a>}</>:<button className="button secondary" disabled={busy} onClick={connect}><ArrowUpRight size={15}/>{busy?'Opening Google…':'Connect Google'}</button>}
    {connection===null&&!demo&&!error&&<span className="google-muted"><LoaderCircle size={14}/>Checking connection…</span>}
    {error&&<p className="google-error" role="alert">{error}</p>}{notice&&<p className="google-muted" role="status">{notice}</p>}
    <small>Requests access to create Gmail drafts, check availability, and manage events on calendars you own. Reconnect once to add newly requested permissions. Ambassador never sends email automatically.</small>
  </section>;
}
