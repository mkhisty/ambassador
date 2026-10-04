'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ExternalLink, Mail, MessageCircle, ShieldCheck } from 'lucide-react';

function draftFor(contact) {
  const name=(contact?.contact||'there').trim().split(/\s+/)[0];
  const campaign=contact?.company||'our campaign';
  return {
    to: contact?.address||'',
    subject:`Following up about ${campaign}`,
    body:`Hi ${name},\n\nI wanted to follow up about ${campaign}. ${contact?.fit||'I think there could be a useful opportunity to connect.'}\n\nWould you be open to a quick conversation?\n\nBest,\nAmbassador team`,
  };
}

export default function ReviewClient({contactId}) {
  const [contact,setContact]=useState(null);
  const [status,setStatus]=useState('Loading your private workspace…');
  const [draft,setDraft]=useState(null);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [saveError,setSaveError]=useState('');
  const [demoMode,setDemoMode]=useState(false);
  function editDraft(next){setDraft(next);setSaved(false);setSaveError('');}
  useEffect(()=>{
    if(!contactId){setStatus('Choose a contact from your workspace to preview its outreach.');return;}
    let active=true;
    async function load(){
      try{
        const sessionResponse=await fetch('/api/session',{cache:'no-store'}),session=await sessionResponse.json();
        if(session.mode==='demo'){
          const workspace=JSON.parse(localStorage.getItem('ambassador-workspace-v2')||'null');
          const found=workspace?.sponsors?.find(item=>String(item.id)===contactId);
          if(!found)throw new Error('This contact is unavailable in the browser demo.');
          const drafts=JSON.parse(localStorage.getItem('ambassador-drafts-v1')||'{}');
          const existing=drafts[contactId];
          if(active){setDemoMode(true);setContact(found);setDraft(existing||draftFor(found));setSaved(Boolean(existing));setStatus('');}
          return;
        }
        const response=await fetch('/api/workspace',{cache:'no-store'});
        if(response.status===401)throw new Error('Sign in to review this outreach. Open your workspace first.');
        if(!response.ok)throw new Error('Could not load this outreach. Try again from your workspace.');
        const data=await response.json(),found=data.sponsors?.find(item=>String(item.id)===contactId);
        if(!found)throw new Error('This contact is unavailable in your workspace.');
        let existing=null;
        try{const savedResponse=await fetch(`/api/drafts?contactId=${encodeURIComponent(contactId)}`,{cache:'no-store'});if(savedResponse.ok){const savedDrafts=await savedResponse.json();existing=savedDrafts.drafts?.[0]||null;}}catch{}
        if(active){setContact(found);setDraft(existing?{to:existing.recipient,subject:existing.subject,body:existing.body}:draftFor(found));setSaved(Boolean(existing));setStatus('');}
      }catch(error){if(active)setStatus(error.message||'Could not load this outreach.');}
    }
    load();
    return ()=>{active=false;};
  },[contactId]);
  const mailto=useMemo(()=>draft&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.to)?`mailto:${encodeURIComponent(draft.to)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`:'', [draft]);
  async function saveDraft(){
    setSaving(true);setSaveError('');
    try{
      if(demoMode){const drafts=JSON.parse(localStorage.getItem('ambassador-drafts-v1')||'{}');drafts[contactId]=draft;localStorage.setItem('ambassador-drafts-v1',JSON.stringify(drafts));}
      else{const response=await fetch('/api/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contactId,recipient:draft.to,subject:draft.subject,body:draft.body})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save draft.');}
      setSaved(true);
    }
    catch(error){setSaveError(error.message);}
    finally{setSaving(false);}
  }
  if(status)return <main className="review-page"><section className="review-card"><a href="/" className="review-back"><ArrowLeft size={16}/>Workspace</a><div className="review-brand">ambassador<span>.</span></div><p className="review-status">{status}</p><a href="/" className="review-cta">Open workspace</a></section></main>;
  if(!contact||!draft)return null;
  return <main className="review-page"><section className="review-card">
    <a href="/" className="review-back"><ArrowLeft size={16}/>Workspace</a>
    <div className="review-brand">ambassador<span>.</span></div>
    <div className="review-eyebrow"><MessageCircle size={15}/> OUTREACH REVIEW</div>
    <h1>Take a look before it goes out.</h1>
    <p className="review-lede">Ambassador prepared a follow-up for {contact.contact||contact.company}. Make any edits, then open it in your email app to review and send.</p>
    <div className="review-private"><ShieldCheck size={16}/>{demoMode?'Browser demo · saved on this device':'Private workspace · signed-in account only'}</div>
    <div className="review-fields"><label>To<input value={draft.to} onChange={e=>editDraft({...draft,to:e.target.value})} placeholder="Add recipient email" type="email"/></label><label>Subject<input value={draft.subject} onChange={e=>editDraft({...draft,subject:e.target.value})}/></label><label>Message<textarea rows={9} value={draft.body} onChange={e=>editDraft({...draft,body:e.target.value})}/></label></div>
    <div className="review-actions"><button className="review-cta review-save" disabled={saving} onClick={saveDraft}><Check size={16}/>{saving?'Saving…':saved?'Save changes':'Save draft'}</button><a className={`review-cta review-email ${!mailto?'disabled':''}`} href={mailto||undefined}><Mail size={16}/>Open email app<ExternalLink size={14}/></a><span>{saved?demoMode?'Saved in this browser.':'Saved to your private Neon workspace.':'Save edits here to keep them after closing.'}</span></div>
    {saveError&&<p className="review-error" role="alert">{saveError}</p>}
    <p className="review-note">{demoMode?'Browser demo drafts stay on this device. ': 'Saved drafts stay in Neon under your account. '}Opening the email app is a separate handoff; Gmail linking and direct Gmail draft creation are not connected.</p>
  </section></main>;
}
