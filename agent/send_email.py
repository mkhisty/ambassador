"""Prepare structured email proposals for trusted Photon review."""

from contextvars import ContextVar
import json
import re
from uuid import uuid4

email_owner = ContextVar('email_owner', default=None)
email_proposal = ContextVar('email_proposal', default=None)

SEND_EMAIL_SCHEMA = {
    'name': 'send_email',
    'description': (
        'Prepare one email proposal for the current user. This tool never sends email. '
        'The user must review and explicitly approve it in Photon. Use attachment_refs '
        'with document IDs from the user context, never local paths or credentials.'
    ),
    'parameters': {
        'type': 'object',
        'properties': {
            'to': {'type': 'string', 'description': 'Recipient email address.'},
            'subject': {'type': 'string', 'description': 'Email subject.'},
            'text': {'type': 'string', 'description': 'Plain text email body.'},
            'attachment_refs': {
                'type': 'array', 'items': {'type': 'string'},
                'description': 'Owned document IDs from context, not filesystem paths.',
            },
            'cc': {'type': 'array', 'items': {'type': 'string'}},
            'bcc': {'type': 'array', 'items': {'type': 'string'}},
            'reply_to': {'type': 'string', 'description': 'Optional reply-to email.'},
            'contact_id': {'type': 'string', 'description': 'Matching linked contact ID from context, if known.'},
        },
        'required': ['to', 'subject', 'text'],
        'additionalProperties': False,
    },
}

_EMAIL = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


def _valid_addresses(values):
    return (isinstance(values, list) and len(values) <= 20 and
            all(isinstance(value, str) and len(value) <= 500 and
                _EMAIL.fullmatch(value) and not any(c in value for c in '\r\n')
                for value in values))


def prepare_email(to, subject, text, attachment_refs=None, cc=None, bcc=None,
                  reply_to=None, contact_id=None, *, phone_number=None):
    """Store proposal in request context; worker transports it to review UI."""
    if not phone_number:
        raise ValueError('No user is bound to this email request.')
    if not isinstance(to, str) or not _EMAIL.fullmatch(to.strip()) or any(c in to for c in '\r\n') or len(to) > 500:
        raise ValueError('Recipient must be a valid email address.')
    if not isinstance(subject, str) or not subject.strip() or len(subject) > 500 or any(c in subject for c in '\r\n'):
        raise ValueError('Subject must be 1 to 500 characters without line breaks.')
    if not isinstance(text, str) or not text.strip() or len(text) > 20000:
        raise ValueError('Email body must be 1 to 20,000 characters.')
    attachment_refs = attachment_refs or []
    cc, bcc = cc or [], bcc or []
    if (not isinstance(attachment_refs, list) or len(attachment_refs) > 5 or
            any(not isinstance(ref, str) or len(ref) > 100 for ref in attachment_refs)):
        raise ValueError('attachment_refs must contain at most five document IDs.')
    if not _valid_addresses(cc) or not _valid_addresses(bcc):
        raise ValueError('CC and BCC must be lists of valid email addresses.')
    if reply_to is not None and (not isinstance(reply_to, str) or not _EMAIL.fullmatch(reply_to) or any(c in reply_to for c in '\r\n')):
        raise ValueError('reply_to must be a valid email address.')
    if contact_id is not None and (not isinstance(contact_id, str) or len(contact_id) > 100):
        raise ValueError('contact_id is invalid.')
    if email_proposal.get() is not None:
        raise ValueError('Only one email can be proposed per iMessage request.')
    proposal = {
        'reviewId': str(uuid4()),
        'recipient': to.strip(), 'subject': subject.strip(), 'body': text.strip(),
        'cc': cc, 'bcc': bcc, 'attachmentRefs': attachment_refs,
        'replyTo': reply_to or '', 'contactId': contact_id or '',
    }
    email_proposal.set(proposal)
    return {
        'status': 'awaiting_user_approval', 'sent': False,
        'message': 'Email proposal prepared for Photon review. Nothing has been sent.',
        'reviewId': proposal['reviewId'], 'proposal': proposal,
    }


def handle_send_email(args, **kwargs):
    """Hermes registry handler; identity comes only from request context."""
    allowed = SEND_EMAIL_SCHEMA['parameters']['properties']
    if not isinstance(args, dict) or any(key not in allowed for key in args):
        return {'error': 'Unsupported email fields.'}
    for field in ('to', 'subject', 'text'):
        if not isinstance(args.get(field), str) or not args[field].strip():
            return {'error': f'Email requires {field}.'}
    for field in ('attachment_refs', 'cc', 'bcc'):
        value = args.get(field, [])
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            return {'error': f'{field} must be a list of strings.'}
    if 'reply_to' in args and not isinstance(args['reply_to'], str):
        return {'error': 'reply_to must be a string.'}
    if 'contact_id' in args and not isinstance(args['contact_id'], str):
        return {'error': 'contact_id must be a string.'}
    phone_number = email_owner.get()
    try:
        return prepare_email(**args, phone_number=phone_number)
    except ValueError as error:
        return {'error': str(error)}


def email_tool(args, **kwargs):
    """Serialize result in the format expected by Hermes tool registry."""
    return json.dumps(handle_send_email(args, **kwargs), ensure_ascii=False)


def register_email_tool():
    """Register with Hermes before constructing an agent."""
    from tools.registry import registry
    registry.register(
        name='send_email', toolset='ambassador_email', schema=SEND_EMAIL_SCHEMA,
        handler=email_tool,
    )
