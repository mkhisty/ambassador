const el = id => document.getElementById(id);
const original = el('response').textContent;
const editing = enabled => {
  el('editor').hidden = !enabled;
  el('edit-actions').hidden = !enabled;
  el('review-actions').hidden = enabled;
  el('response').hidden = enabled;
};
const finish = () => {
  editing(false);
  el('review-actions').hidden = true;
};
if (document.querySelector('main').dataset.finished === 'true') finish();
el('edit').onclick = () => {
  el('text').value = original;
  editing(true);
  el('text').focus();
};
el('cancel').onclick = () => editing(false);
async function submit(action) {
  if (action === 'edit_approve' && !el('text').value.trim()) {
    el('status').textContent = 'Enter a response before approving.';
    return;
  }
  document.querySelectorAll('button').forEach(button => button.disabled = true);
  el('status').textContent = 'Recording your response…';
  try {
    const response = await fetch(location.pathname, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, text: el('text').value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not record response');
    if (action === 'edit_approve') el('response').textContent = el('text').value;
    finish();
    const label = action === 'reject' ? 'Rejected' : 'Approved';
    document.querySelector('h1').textContent = label;
    document.title = label + ' · Ambassador';
    el('status').textContent = 'Your response was recorded. Close this view to return to iMessage.';
  } catch (error) {
    el('status').textContent = error.message + ' Reload to check its status.';
  } finally {
    document.querySelectorAll('button').forEach(button => button.disabled = false);
  }
}
el('approve').onclick = () => submit('approve');
el('reject').onclick = () => submit('reject');
el('edit-approve').onclick = () => submit('edit_approve');
