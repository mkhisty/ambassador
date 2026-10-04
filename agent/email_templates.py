"""Validate and expand reviewed email templates without involving the model."""
import json
import re
from uuid import uuid4

FIELDS = re.compile(r'\[([A-Za-z][A-Za-z0-9_]*)\]')
ADDRESS = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


def recipients(value, original=None):
    if not isinstance(value, list) or not 1 <= len(value) <= 20:
        raise ValueError('Provide between 1 and 20 recipients.')
    if len(json.dumps(value).encode()) > 40000:
        raise ValueError('Recipient parameters exceed the review size limit.')
    if original is not None and len(value) != len(original):
        raise ValueError('Recipient count cannot change during this review.')
    result, seen = [], set()
    for index, row in enumerate(value):
        if not isinstance(row, dict) or set(row) - {'email', 'parameters', 'reviewId'}:
            raise ValueError('Each recipient needs an email and a parameters object.')
        address = row.get('email')
        if not isinstance(address, str) or len(address) > 254 or not ADDRESS.fullmatch(address.strip()) or any(c in address for c in '\r\n'):
            raise ValueError('Each recipient must have a valid email address.')
        address = address.strip()
        if address.lower() in seen:
            raise ValueError('Duplicate recipient email addresses are not allowed.')
        seen.add(address.lower())
        params = row.get('parameters', {})
        if not isinstance(params, dict) or len(params) > 20:
            raise ValueError('Recipient parameters must be an object with at most 20 fields.')
        normalized = {}
        for key, item in params.items():
            if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,49}', key) or not isinstance(item, str) or len(item) > 1000:
                raise ValueError('Parameter names must be identifiers and values strings of at most 1,000 characters.')
            if key.upper() in normalized:
                raise ValueError('Parameter names are case-insensitive and must be unique.')
            normalized[key.upper()] = item
        result.append({'email': address, 'parameters': normalized,
                       'reviewId': original[index]['reviewId'] if original is not None else str(uuid4())})
    return result


def substitute(template, params):
    missing = sorted({match.group(1).upper() for match in FIELDS.finditer(template)} - params.keys())
    if missing:
        raise ValueError('Missing recipient parameters: ' + ', '.join(missing))
    # Replace once; values containing bracketed text are not treated as templates.
    return FIELDS.sub(lambda match: params[match.group(1).upper()], template)


def expanded_emails(proposal, review_id=None):
    if not proposal.get('recipients'):
        if FIELDS.search(proposal.get('subject', '')) or FIELDS.search(proposal.get('body', '')):
            raise ValueError('Templates require recipients with parameter values, even for one recipient.')
        result = [(review_id or proposal.get('reviewId'), proposal)]
    else:
        result = _expand(proposal)
    for child_id, message in result:
        envelope = {'phoneNumber': '+123456789012345', 'reviewId': child_id, 'proposal': message}
        if len(json.dumps(envelope).encode()) > 29500:
            raise ValueError('A personalized email exceeds the website request size limit.')
    return result


def _expand(proposal):
    result = []
    for row in proposal['recipients']:
        subject = substitute(proposal['subject'], row['parameters'])
        body = substitute(proposal['body'], row['parameters'])
        if not subject.strip() or len(subject) > 500 or any(c in subject for c in '\r\n'):
            raise ValueError('Every personalized subject must be 1 to 500 characters without line breaks.')
        if not body.strip() or len(body) > 20000:
            raise ValueError('Every personalized message must be 1 to 20,000 characters.')
        message = {key: value for key, value in proposal.items() if key not in ('recipients', 'reviewId')}
        message.update(recipient=row['email'], subject=subject, body=body, contactId='')
        result.append((row['reviewId'], message))
    return result
