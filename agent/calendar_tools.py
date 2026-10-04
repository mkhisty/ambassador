"""Hermes tools for checking availability and proposing Calendar holds."""

from contextvars import ContextVar
from datetime import datetime
import json
import urllib.error
import urllib.request

from fetch_context import context_settings, normalize_phone

calendar_owner = ContextVar('calendar_owner', default=None)
calendar_proposal = ContextVar('calendar_proposal', default=None)
calendar_review = ContextVar('calendar_review', default=None)

CHECK_CALENDAR_SCHEMA = {
    'name': 'check_calendar_availability',
    'description': 'Check whether the current user is busy during an ISO 8601 timezone-aware date-time range. Returns busy intervals only; never event names or details.',
    'parameters': {
        'type': 'object',
        'properties': {
            'time_min': {'type': 'string', 'description': 'RFC3339 start, including timezone offset.'},
            'time_max': {'type': 'string', 'description': 'RFC3339 end, including timezone offset.'},
            'time_zone': {'type': 'string', 'description': 'IANA timezone such as America/New_York.'},
        },
        'required': ['time_min', 'time_max', 'time_zone'],
        'additionalProperties': False,
    },
}

PROPOSE_CALENDAR_SCHEMA = {
    'name': 'propose_calendar_event',
    'description': 'Propose one event for the current user. This only prepares a review card; the event is created and blocks time only after the user taps Add to Calendar.',
    'parameters': {
        'type': 'object',
        'properties': {
            'summary': {'type': 'string'},
            'start': {'type': 'string', 'description': 'RFC3339 start, including timezone offset.'},
            'end': {'type': 'string', 'description': 'RFC3339 end, including timezone offset.'},
            'time_zone': {'type': 'string', 'description': 'IANA timezone such as America/New_York.'},
            'description': {'type': 'string'},
            'location': {'type': 'string'},
        },
        'required': ['summary', 'start', 'end', 'time_zone'],
        'additionalProperties': False,
    },
}


def _owner():
    phone = calendar_owner.get()
    if not phone:
        raise ValueError('No iMessage user is bound to this Calendar request.')
    return normalize_phone(phone)


def _post(path, payload):
    base, token = context_settings()
    request = urllib.request.Request(
        base + path,
        data=json.dumps(payload).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        error.close()
        raise RuntimeError(f'Calendar request failed (HTTP {error.code}). Reconnect Google if access was denied.') from None
    except (urllib.error.URLError, OSError):
        raise RuntimeError('Could not reach Ambassador Calendar service.') from None
    if not result.get('ok'):
        raise RuntimeError(result.get('error') or 'Calendar request failed.')
    return result


def create_approved_event(review_id, phone_number, event):
    result = _post('/api/agent/google/calendar/events', {
        'requestId': review_id, 'phoneNumber': normalize_phone(phone_number), 'event': event,
    })
    return result['event']


def _aware(value):
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.tzinfo is not None and parsed.utcoffset() is not None
    except ValueError:
        return False


def check_calendar_availability(args, **kwargs):
    if not isinstance(args, dict) or set(args) != {'time_min', 'time_max', 'time_zone'}:
        return json.dumps({'error': 'Provide time_min, time_max, and time_zone.'})
    start, end = args['time_min'], args['time_max']
    if not _aware(start) or not _aware(end):
        return json.dumps({'error': 'Use timezone-aware ISO 8601 start and end times.'})
    try:
        result = _post('/api/agent/google/calendar/freebusy', {
            'phoneNumber': _owner(), 'timeMin': start, 'timeMax': end, 'timeZone': args['time_zone'],
        })
        return json.dumps(result['availability'])
    except (ValueError, RuntimeError) as error:
        return json.dumps({'error': str(error)})


def propose_calendar_event(args, **kwargs):
    required = {'summary', 'start', 'end', 'time_zone'}
    optional = {'description', 'location'}
    if not isinstance(args, dict) or not required <= set(args) or set(args) - required - optional:
        return json.dumps({'error': 'Provide summary, start, end, and time_zone; description and location are optional.'})
    if not isinstance(args['summary'], str) or not args['summary'].strip() or len(args['summary']) > 300:
        return json.dumps({'error': 'Event summary must be 1 to 300 characters.'})
    if not _aware(args['start']) or not _aware(args['end']):
        return json.dumps({'error': 'Use timezone-aware ISO 8601 start and end times.'})
    try:
        _owner()
    except ValueError as error:
        return json.dumps({'error': str(error)})
    if calendar_proposal.get() is not None:
        return json.dumps({'error': 'Only one event can be proposed per iMessage request. Send a new request for another event.'})
    proposal = {
        'summary': args['summary'].strip(), 'start': args['start'], 'end': args['end'],
        'timeZone': args['time_zone'], 'description': args.get('description', ''), 'location': args.get('location', ''),
    }
    dispatch = calendar_review.get()
    if dispatch:
        try:
            dispatch(proposal)
        except ValueError as error:
            return json.dumps({'error': str(error)})
    calendar_proposal.set(proposal)
    return json.dumps({'status': 'awaiting_user_approval', 'message': 'No event created yet. The user must tap Add to Calendar on the review card.'})


def register_calendar_tools():
    from tools.registry import registry
    registry.register(name='check_calendar_availability', toolset='ambassador_calendar', schema=CHECK_CALENDAR_SCHEMA, handler=check_calendar_availability)
    registry.register(name='propose_calendar_event', toolset='ambassador_calendar', schema=PROPOSE_CALENDAR_SCHEMA, handler=propose_calendar_event)
