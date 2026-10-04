const el = id => document.getElementById(id);
const original = el('response').textContent;
const email = document.querySelector('main').dataset.kind === 'email';
const emailProposal = JSON.parse(el('email-details').dataset.proposal || '{}');
const batch = Boolean(emailProposal.recipients?.length);
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
    el('email-recipient').value = emailProposal.recipient || '';
    el('single-recipient').hidden = batch;
    el('email-subject').value = emailProposal.subject || '';
    el('email-cc').value = (emailProposal.cc || []).join(', ');
    el('email-bcc').value = (emailProposal.bcc || []).join(', ');
    el('email-body').value = emailProposal.body || '';
    el('recipient-editors').replaceChildren();
    for (const row of emailProposal.recipients || []) {
      const panel = document.createElement('section');
      panel.className = 'recipient-editor';
      const label = document.createElement('label');
      label.textContent = 'Recipient';
      const address = document.createElement('input');
      address.type = 'email'; address.value = row.email; address.className = 'recipient-address';
      label.append(address); panel.append(label);
      const fields = document.createElement('div'); fields.className = 'parameter-fields';
      panel.append(fields);
      for (const [name, value] of Object.entries(row.parameters || {})) addParameter(fields, name, value);
      const add = document.createElement('button'); add.type = 'button'; add.textContent = 'Add parameter';
      add.onclick = () => addParameter(fields, '', ''); panel.append(add);
      el('recipient-editors').append(panel);
    }
    previewTemplate();
  } else el('text').value = original;
  editing(true);
  (email ? batch ? el('email-subject') : el('email-recipient') : el('text')).focus();
};
function addParameter(panel, name, value) {
  const row = document.createElement('div'); row.className = 'parameter';
  const key = document.createElement('input'); key.value = name; key.placeholder = 'NAME'; key.setAttribute('aria-label', 'Parameter name');
  const input = document.createElement('input'); input.value = value; input.setAttribute('aria-label', 'Parameter value');
  row.append(key, input); panel.append(row);
}
function previewTemplate() {
  const preview = el('template-preview'); preview.replaceChildren();
  const text = el('email-body').value;
  let previous = 0;
  for (const match of text.matchAll(/\[[A-Za-z][A-Za-z0-9_]*\]/g)) {
    preview.append(document.createTextNode(text.slice(previous, match.index)));
    const mark = document.createElement('mark'); mark.className = 'template-field'; mark.textContent = match[0];
    preview.append(mark); previous = match.index + match[0].length;
  }
  preview.append(document.createTextNode(text.slice(previous)));
}
el('email-body').oninput = previewTemplate;
el('cancel').onclick = () => editing(false);
async function submit(action) {
  if (action === 'edit_approve' && !(email ? el('email-body').value : el('text').value).trim()) {
    el('status').textContent = 'Enter a response before approving.';
    return;
  }
  document.querySelectorAll('button').forEach(button => button.disabled = true);
  el('status').textContent = calendar && action === 'approve' ? 'Adding event to your calendar…' : email && action !== 'reject' ? 'Recording approval…' : action === 'reject' ? 'Recording rejection…' : 'Sending approved iMessage…';
  try {
    const body = { action, text: el('text').value };
    if (email && action === 'edit_approve') {
      body.email = {
        recipient: el('email-recipient').value.trim(), subject: el('email-subject').value,
        body: el('email-body').value, cc: el('email-cc').value.split(',').map(x => x.trim()).filter(Boolean),
        bcc: el('email-bcc').value.split(',').map(x => x.trim()).filter(Boolean),
      };
      if (batch) {
        body.email.recipients = [...el('recipient-editors').children].map(panel => {
          const parameters = Object.create(null);
          for (const row of panel.querySelectorAll('.parameter')) {
            const [key, value] = row.querySelectorAll('input');
            const name = key.value.trim();
            if (!name && !value.value) continue;
            if (Object.keys(parameters).some(existing => existing.toUpperCase() === name.toUpperCase())) throw new Error('Parameter names must be unique.');
            parameters[name] = value.value;
          }
          return { email: panel.querySelector('.recipient-address').value.trim(), parameters };
        });
        body.email.recipient = body.email.recipients[0].email;
      }
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
    if (email) {
      finish();
      el('email-details').hidden = true;
      const label = action === 'reject' ? 'Rejected' : 'Approved';
      document.querySelector('h1').textContent = label;
      document.title = label + ' · Ambassador';
      el('status').textContent = 'Done. You can close this window.';
      return;
    }
    finish();
    const label = calendar ? (action === 'reject' ? 'Calendar event not added' : 'Event added to Calendar') : email ? (action === 'reject' ? 'Email rejected' : 'Email sent') : (action === 'reject' ? 'Rejected' : 'Message sent');
    document.querySelector('h1').textContent = label;
    document.title = label + ' · Ambassador';
    el('status').textContent = calendar ? (action === 'reject' ? 'No event was created.' : 'Your event was created and blocks this time.') : email ? (action === 'reject' ? 'Email proposal rejected.' : 'Your email was sent.') : action === 'reject' ? 'Message rejected.' : 'iMessage provider accepted your message.';
  } catch (error) {
    el('status').textContent = error.message + ' Reload to check its status.';
  } finally {
    document.querySelectorAll('button').forEach(button => button.disabled = false);
  }
}
el('approve').onclick = () => submit('approve');
el('reject').onclick = () => submit('reject');
el('edit-approve').onclick = () => submit('edit_approve');
