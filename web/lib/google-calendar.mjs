import { createHash } from 'node:crypto';
import { isZonedDateTime } from './datetime.mjs';
import { googleAccessToken } from './google.mjs';

const EVENT_SCOPE='https://www.googleapis.com/auth/calendar.events.owned';
const FREEBUSY_SCOPE='https://www.googleapis.com/auth/calendar.events.freebusy';
const validTimeZone=value=>{try{new Intl.DateTimeFormat('en-US',{timeZone:value});return true;}catch{return false;}};

export function validateCalendarEvent(input) {
  const event={
    summary:String(input?.summary||'').trim(),start:input?.start,end:input?.end,
    timeZone:String(input?.timeZone||'UTC'),description:String(input?.description||'').slice(0,4000),
    location:String(input?.location||'').slice(0,500),
  };
  if(!event.summary||event.summary.length>300||!isZonedDateTime(event.start)||!isZonedDateTime(event.end)||Date.parse(event.end)<=Date.parse(event.start)||event.timeZone.length>100||/[\r\n]/.test(event.timeZone)||!validTimeZone(event.timeZone)) throw Object.assign(new Error('Provide a title and valid start/end times with timezone offsets.'),{status:400});
  return event;
}

export async function createCalendarEvent(sql,phone,input,{requestId}={}) {
  const event=validateCalendarEvent(input),{accessToken}=await googleAccessToken(sql,phone,EVENT_SCOPE);
  const id=requestId?createHash('sha256').update(requestId).digest('hex'):undefined;
  const resource={...(id?{id}:{}),summary:event.summary,description:event.description,location:event.location,transparency:'opaque',start:{dateTime:event.start,timeZone:event.timeZone},end:{dateTime:event.end,timeZone:event.timeZone}};
  const collection='https://www.googleapis.com/calendar/v3/calendars/primary/events',url=id?`${collection}/${id}`:collection;
  let response=await fetch(collection,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify(resource),signal:AbortSignal.timeout(15000)});
  if(response.status===409&&id) response=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15000)});
  const result=await response.json();
  if(!response.ok||!result.id)throw Object.assign(new Error('Google Calendar could not create the event.'),{status:502});
  return {id:result.id,summary:result.summary,start:result.start,end:result.end,url:result.htmlLink};
}

export async function queryCalendarFreeBusy(sql,phone,input) {
  const {timeMin,timeMax,timeZone='UTC'}=input||{};
  if(!isZonedDateTime(timeMin)||!isZonedDateTime(timeMax)||Date.parse(timeMax)<=Date.parse(timeMin)||Date.parse(timeMax)-Date.parse(timeMin)>14*86400000||typeof timeZone!=='string'||timeZone.length>100||!validTimeZone(timeZone)) throw Object.assign(new Error('Provide a valid timezone-aware time range of 14 days or less.'),{status:400});
  const {accessToken}=await googleAccessToken(sql,phone,FREEBUSY_SCOPE);
  const response=await fetch('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({timeMin,timeMax,timeZone,items:[{id:'primary'}]}),signal:AbortSignal.timeout(15000)});
  const result=await response.json(),calendar=result.calendars?.primary;
  if(!response.ok||!calendar||calendar.errors?.length)throw Object.assign(new Error('Google Calendar availability could not be checked.'),{status:502});
  return {timeMin:result.timeMin,timeMax:result.timeMax,timeZone,busy:calendar.busy||[]};
}
