const localDay=value=>{const date=new Date(value);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};

export function buildDailyBriefing({campaign,contacts,activities,date,chartUrl}) {
  const today=date||localDay(new Date());
  const followups=contacts.filter(contact=>contact.nextAction&& !['Committed','Declined'].includes(contact.stage));
  const due=followups.filter(contact=>contact.nextDate===today);
  const overdue=followups.filter(contact=>contact.nextDate&&contact.nextDate<today);
  const todayActivities=activities.filter(activity=>activity.at&&localDay(activity.at)===today);
  const responses=todayActivities.filter(activity=>activity.kind==='trigger'&&activity.triggerType==='response_recorded');
  const completed=todayActivities.filter(activity=>activity.kind==='trigger'&&activity.triggerType==='outcome_completed');
  const lines=[`${campaign} · Daily outreach brief`,
    `${responses.length} new ${responses.length===1?'response':'responses'} recorded today.`,
    `${completed.length} ${completed.length===1?'outcome':'outcomes'} marked complete today.`,
    `${due.length} follow-ups due today · ${overdue.length} overdue.`];
  const updates=todayActivities.filter(activity=>activity.kind==='trigger').slice(0,4).map(activity=>activity.text||`${activity.company||'Contact'} updated`);
  if(updates.length)lines.push('', 'Today’s updates', ...updates);
  if(due.length)lines.push('',`Due today: ${due.slice(0,4).map(contact=>contact.contact||contact.company).join(', ')}${due.length>4?'…':''}`);
  if(overdue.length)lines.push(`Overdue: ${overdue.slice(0,4).map(contact=>contact.contact||contact.company).join(', ')}${overdue.length>4?'…':''}`);
  lines.push('',`Pipeline chart: ${chartUrl}`);
  return {date:today,responses:responses.length,completed:completed.length,due:due.length,overdue:overdue.length,text:lines.join('\n')};
}
