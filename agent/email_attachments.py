"""Resolve original context documents to owner-scoped email attachments."""
import hashlib
import json
from pathlib import Path

MAX_ATTACHMENTS = 20
MAX_ATTACHMENT_BYTES = 25_000_000


def resolve_attachments(refs, paths, directory, phone):
    if not isinstance(refs, list) or any(not isinstance(ref, str) or not ref or len(ref) > 100 for ref in refs):
        raise ValueError('attachment_refs must contain document IDs.')
    if not isinstance(paths, list) or any(not isinstance(path, str) or not path or len(path) > 4096 for path in paths):
        raise ValueError('attachment_paths must contain context file paths.')
    if len(refs) + len(paths) > MAX_ATTACHMENTS:
        raise ValueError('Choose at most 20 attachments.')
    if not refs and not paths:
        return [], []
    if directory is None:
        if paths:
            raise ValueError('Context files are unavailable for this email request.')
        return list(dict.fromkeys(refs)), []  # Server still checks ID ownership.
    root = Path(directory).resolve()
    try:
        manifest = json.loads((root / 'workspace.json').read_text())
    except (OSError, ValueError):
        raise ValueError('The context document index is unavailable.') from None
    if manifest.get('phoneNumber') != phone:
        raise ValueError('Context attachments do not belong to this user.')
    documents = {doc['id']: doc for doc in manifest.get('documents', [])
                 if isinstance(doc, dict) and doc.get('ownerPhoneNumber') == phone and isinstance(doc.get('id'), str)}
    local = {}
    for doc in documents.values():
        path = root / doc.get('localPath', '')
        resolved = path.resolve()
        if resolved.is_relative_to(root) and resolved != root:
            local[resolved] = doc
    selected = []
    for ref in refs:
        if ref not in documents:
            raise ValueError('An attachment is not in this user’s context documents.')
        selected.append(documents[ref])
    for supplied in paths:
        try:
            path = Path(supplied)
            path = (path if path.is_absolute() else root / path).resolve(strict=True)
        except (OSError, ValueError):
            raise ValueError('An attachment file was not found in the context directory.') from None
        doc = local.get(path)
        if not path.is_relative_to(root) or not path.is_file() or doc is None:
            raise ValueError('Only original documents listed in this user’s context can be attached.')
        if path.stat().st_size != doc.get('size') or hashlib.sha256(path.read_bytes()).hexdigest() != doc.get('sha256'):
            raise ValueError('The context attachment changed. Use the original uploaded document.')
        selected.append(doc)
    unique = {doc['id']: doc for doc in selected}
    total = sum(doc.get('size', 0) for doc in unique.values())
    if total > MAX_ATTACHMENT_BYTES:
        raise ValueError('Attachments exceed the 25 MB email limit.')
    return list(unique), [{'id': doc['id'], 'name': doc['name'], 'mime': doc['mime'], 'size': doc['size']}
                          for doc in unique.values()]
