"""Hermes email tool placeholder. No credentials, file reads, or email sending yet."""

from contextvars import ContextVar
import json

email_owner = ContextVar('email_owner', default=None)

SEND_EMAIL_SCHEMA = {
    'name': 'send_email',
    'description': (
        'Submit an email proposal for the current user. This is a stub: no email '
        'is sent. Supply recipient, subject, text, and optional attachment paths. '
        'Never supply passwords or tokens. Report that the email was not sent.'
    ),
    'parameters': {
        'type': 'object',
        'properties': {
            'to': {'type': 'string', 'description': 'Recipient email address.'},
            'subject': {'type': 'string', 'description': 'Email subject.'},
            'text': {'type': 'string', 'description': 'Plain text email body.'},
            'attachment_paths': {
                'type': 'array', 'items': {'type': 'string'},
                'description': 'Paths to proposed attachments. The stub does not read them.',
            },
            'cc': {'type': 'array', 'items': {'type': 'string'}},
            'bcc': {'type': 'array', 'items': {'type': 'string'}},
            'reply_to': {'type': 'string', 'description': 'Optional reply-to email address.'},
        },
        'required': ['to', 'subject', 'text'],
        'additionalProperties': False,
    },
}


def send_email(to, subject, text, attachment_paths=None, cc=None, bcc=None,
               reply_to=None, *, phone_number=None):
    """Eventually fetch this user's credentials, compose the email, and send it.

    For now return the proposed fields without contacting any provider or database.
    The caller binds phone_number; Hermes cannot choose another credential owner.
    """
    return {
        'status': 'not_sent',
        'sent': False,
        'message': 'Email tool is a placeholder. No email was sent.',
        'phone_number': phone_number,
        'email': {
            'to': to, 'subject': subject, 'text': text,
            'attachment_paths': attachment_paths or [],
            'cc': cc or [], 'bcc': bcc or [], 'reply_to': reply_to,
        },
    }


def handle_send_email(args, **kwargs):
    """Hermes registry handler; identity comes from the current request context."""
    allowed = SEND_EMAIL_SCHEMA['parameters']['properties']
    if not isinstance(args, dict) or any(key not in allowed for key in args):
        return {'error': 'Unsupported email fields.'}
    for field in ('to', 'subject', 'text'):
        if not isinstance(args.get(field), str) or not args[field].strip():
            return {'error': f'Email requires {field}.'}
    for field in ('attachment_paths', 'cc', 'bcc'):
        value = args.get(field, [])
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            return {'error': f'{field} must be a list of strings.'}
    if 'reply_to' in args and not isinstance(args['reply_to'], str):
        return {'error': 'reply_to must be a string.'}
    phone_number = email_owner.get()
    if not phone_number:
        return {'error': 'No user is bound to this email request. Nothing sent.'}
    return send_email(**args, phone_number=phone_number)


def email_tool(args, **kwargs):
    """Serialize results in the format expected by the Hermes tool registry."""
    return json.dumps(handle_send_email(args, **kwargs), ensure_ascii=False)


def register_email_tool():
    """Register with the installed Hermes registry before constructing an agent."""
    from tools.registry import registry
    registry.register(
        name='send_email', toolset='ambassador_email', schema=SEND_EMAIL_SCHEMA,
        handler=email_tool,
    )
