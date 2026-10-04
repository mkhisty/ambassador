"""Prepare structured email proposals for trusted Photon review."""

from contextvars import ContextVar
import json
import re
from uuid import uuid4
from email_templates import recipients as normalize_recipients, expanded_emails
from email_attachments import resolve_attachments
from diagnostics import verbose_log, fingerprint, error_info

email_owner = ContextVar('email_owner', default=None)
email_proposal = ContextVar('email_proposal', default=None)
email_review = ContextVar('email_review', default=None)
email_context = ContextVar('email_context', default=None)

SEND_EMAIL_SCHEMA = {
    'name': 'send_email',
    'description': (
        'Prepare one email or a personalized batch for the current user. This tool never sends email. '
        'Any valid recipient supplied by the user is allowed; saving or linking '
        'a contact first is not required. '
        'The user must review and explicitly approve it in Photon. Use attachment_refs '
        'with document IDs, or attachment_paths with original files listed in the '
        'context workspace.json. Files become real email attachments, not links. '
        'Never attach arbitrary filesystem files or credentials.'
    ),
    'parameters': {
        'type': 'object',
        'properties': {
            'to': {'type': 'string', 'description': 'Single recipient email. Omit when using recipients.'},
            'recipients': {'type': 'array', 'minItems': 1, 'maxItems': 20,
                'description': 'Separate personalized emails using the shared subject/text template. Supply every [FIELD] value for each recipient; names are case-insensitive.',
                'items': {'type': 'object', 'properties': {
                    'email': {'type': 'string'},
                    'parameters': {'type': 'object', 'additionalProperties': {'type': 'string'}},
                }, 'required': ['email', 'parameters'], 'additionalProperties': False}},
            'subject': {'type': 'string', 'description': 'Email subject.'},
            'text': {'type': 'string', 'description': 'Plain text email body.'},
            'attachment_refs': {
                'type': 'array', 'maxItems': 20, 'items': {'type': 'string'},
                'description': 'Owned document IDs from context, not filesystem paths.',
            },
            'attachment_paths': {'type': 'array', 'maxItems': 20, 'items': {'type': 'string'},
                'description': 'Original document localPath values from workspace.json, relative to the context directory; absolute paths inside that directory also work.'},
            'cc': {'type': 'array', 'items': {'type': 'string'}},
            'bcc': {'type': 'array', 'items': {'type': 'string'}},
            'reply_to': {'type': 'string', 'description': 'Optional reply-to email.'},
            'contact_id': {'type': 'string', 'description': 'Optional matching linked contact ID from context. Omit for a new recipient; never invent an ID.'},
        },
        'required': ['subject', 'text'],
        'additionalProperties': False,
    },
}

_EMAIL = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


def _valid_addresses(values):
    return (isinstance(values, list) and len(values) <= 20 and
            all(isinstance(value, str) and len(value) <= 500 and
                _EMAIL.fullmatch(value) and not any(c in value for c in '\r\n')
                for value in values))


def prepare_email(subject, text, to=None, attachment_refs=None, cc=None, bcc=None,
                  reply_to=None, contact_id=None, recipients=None, attachment_paths=None, *, phone_number=None):
    """Store proposal in request context; worker transports it to review UI."""
    if not phone_number:
        raise ValueError('No user is bound to this email request.')
    if recipients is not None and to is not None:
        raise ValueError('Use either to or recipients, not both.')
    rows = normalize_recipients(recipients) if recipients is not None else None
    if rows:
        to = rows[0]['email']
    if not isinstance(to, str) or not _EMAIL.fullmatch(to.strip()) or any(c in to for c in '\r\n') or len(to) > 500:
        raise ValueError('Recipient must be a valid email address.')
    if not isinstance(subject, str) or not subject.strip() or len(subject) > 500 or any(c in subject for c in '\r\n'):
        raise ValueError('Subject must be 1 to 500 characters without line breaks.')
    if not isinstance(text, str) or not text.strip() or len(text) > 20000:
        raise ValueError('Email body must be 1 to 20,000 characters.')
    attachment_refs, attachments = resolve_attachments(
        attachment_refs or [], attachment_paths or [], email_context.get(), phone_number)
    cc, bcc = cc or [], bcc or []
    if not _valid_addresses(cc) or not _valid_addresses(bcc):
        raise ValueError('CC and BCC must be lists of valid email addresses.')
    if reply_to is not None and (not isinstance(reply_to, str) or not _EMAIL.fullmatch(reply_to) or any(c in reply_to for c in '\r\n')):
        raise ValueError('reply_to must be a valid email address.')
    if contact_id is not None and (not isinstance(contact_id, str) or len(contact_id) > 100):
        raise ValueError('contact_id is invalid.')
    if email_proposal.get() is not None:
        raise ValueError('Only one email proposal or batch can be prepared per iMessage request.')
    proposal = {
        'reviewId': str(uuid4()),
        'recipient': to.strip(), 'subject': subject.strip(), 'body': text.strip(),
        'cc': cc, 'bcc': bcc, 'attachmentRefs': attachment_refs,
        'replyTo': reply_to or '', 'contactId': contact_id or '',
    }
    if rows:
        proposal['recipients'] = rows
    if attachments:
        proposal['attachments'] = attachments
    expanded_emails(proposal)  # Validate every substitution before dispatch.
    # The trusted communication callback saves the draft and sends its widget.
    # It is supplied by Python, never by model arguments.
    dispatch = email_review.get()
    verbose_log('email.proposal', review=fingerprint(proposal['reviewId']), recipient=proposal['recipient'],
                subject_chars=len(proposal['subject']), body_chars=len(proposal['body']),
                attachment_count=len(attachment_refs))
    if dispatch:
        dispatch(proposal)
    email_proposal.set(proposal)
    return {
        'status': 'awaiting_user_approval', 'sent': False,
        'message': 'Email proposal prepared for Photon review. Nothing has been sent. '
                   'The approval or rejection and provider outcome will arrive in a later conversation turn.',
        'reviewId': proposal['reviewId'], 'proposal': proposal,
    }


def handle_send_email(args, **kwargs):
    """Hermes registry handler; identity comes only from request context."""
    allowed = SEND_EMAIL_SCHEMA['parameters']['properties']
    if not isinstance(args, dict) or any(key not in allowed for key in args):
        return {'error': 'Unsupported email fields.'}
    for field in ('subject', 'text'):
        if not isinstance(args.get(field), str) or not args[field].strip():
            return {'error': f'Email requires {field}.'}
    for field in ('attachment_refs', 'attachment_paths', 'cc', 'bcc'):
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
        verbose_log('email.proposal_failed', error=error_info(error))
        return {'error': str(error)}
    except Exception as error:
        verbose_log('email.review_failed', error=error_info(error))
        return {'error': 'Could not deliver the email approval request. No email was sent.'}


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
