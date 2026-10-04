const el = id => document.getElementById(id);
const original = el('response').textContent;
const email = document.querySelector('main').dataset.kind === 'email';
const calendar = document.querySelector('main').dataset.kind === 'calendar';
const editing = enabled => {
  el('editor').hidden = !enabled || email;
  el('email-editor').hidden = !enabled || !email;
  el('edit-actions').hidden = !enabled;
  el('review-actions').hidden = enabled;
  el('response').hidden = enabled || email;
  if (email) el('email-details').hidden = enabled;
};
const finish = () => {
  editing(false);
  el('review-actions').hidden = true;
};
if (document.querySelector('main').dataset.finished === 'true') finish();
el('edit').onclick = () => {
  if (email) {
    const panel = el('email-details');
    const fields = {};
    const nodes = [...panel.querySelectorAll('dt,dd')];
    for (let i = 0; i + 1 < nodes.length; i += 2) fields[nodes[i].textContent] = nodes[i + 1].textContent;
    el('email-recipient').value = fields.To || '';
    el('email-subject').value = fields.Subject || '';
    el('email-cc').value = fields.CC || '';
    el('email-bcc').value = fields.BCC || '';
    const body = panel.querySelector('dd pre');
    el('email-body').value = body?.textContent || '';
  } else el('text').value = original;
  editing(true);
  (email ? el('email-recipient') : el('text')).focus();
};
el('cancel').onclick = () => editing(false);
async function submit(action) {
  if (action === 'edit_approve' && !(email ? el('email-body').value : el('text').value).trim()) {
    el('status').textContent = 'Enter a response before approving.';
    return;
  }
  document.querySelectorAll('button').forEach(button => button.disabled = true);
  el('status').textContent = calendar && action === 'approve' ? 'Adding event to your calendar…' : email && action !== 'reject' ? 'Sending approved email…' : action === 'reject' ? 'Recording rejection…' : 'Sending approved iMessage…';
  try {
    const body = { action, text: el('text').value };
    if (email && action === 'edit_approve') {
      body.email = {
        recipient: el('email-recipient').value.trim(), subject: el('email-subject').value,
        body: el('email-body').value, cc: el('email-cc').value.split(',').map(x => x.trim()).filter(Boolean),
        bcc: el('email-bcc').value.split(',').map(x => x.trim()).filter(Boolean),
      };
    }
    const response = await fetch(location.pathname, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not record response');
    if (result.event && result.event.url) {
      el('calendar-link').href = result.event.url;
      el('calendar-link').hidden = false;
    }
    if (action === 'edit_approve' && !email) el('response').textContent = el('text').value;
    finish();
    const label = calendar ? (action === 'reject' ? 'Calendar event not added' : 'Event added to Calendar') : email ? (action === 'reject' ? 'Email rejected' : 'Email accepted') : (action === 'reject' ? 'Rejected' : 'Message sent');
    document.querySelector('h1').textContent = label;
    document.title = label + ' · Ambassador';
    el('status').textContent = calendar ? (action === 'reject' ? 'No event was created.' : 'Your event was created and blocks this time.') : email ? (action === 'reject' ? 'Email proposal rejected.' : 'Gmail accepted email send; acceptance does not confirm delivery.') : action === 'reject' ? 'Message rejected.' : 'iMessage provider accepted your message.';
  } catch (error) {
    el('status').textContent = error.message + ' Reload to check its status.';
  } finally {
    document.querySelectorAll('button').forEach(button => button.disabled = false);
  }
}
el('approve').onclick = () => submit('approve');
el('reject').onclick = () => submit('reject');
el('edit-approve').onclick = () => submit('edit_approve');
