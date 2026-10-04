import json
import unittest
from unittest.mock import patch

import calendar_tools


class CalendarToolTests(unittest.TestCase):
    def setUp(self):
        calendar_tools.calendar_proposal.set(None)
        self.owner = calendar_tools.calendar_owner.set('+12025550100')

    def tearDown(self):
        calendar_tools.calendar_owner.reset(self.owner)
        calendar_tools.calendar_proposal.set(None)

    def test_availability_uses_bound_phone_and_returns_only_busy_intervals(self):
        expected = {'timeMin': '2026-10-04T09:00:00-04:00', 'timeMax': '2026-10-04T17:00:00-04:00', 'timeZone': 'America/New_York', 'busy': []}
        with patch.object(calendar_tools, '_post', return_value={'ok': True, 'availability': expected}) as post:
            result = json.loads(calendar_tools.check_calendar_availability({
                'time_min': expected['timeMin'], 'time_max': expected['timeMax'], 'time_zone': expected['timeZone'],
            }))
        self.assertEqual(result, expected)
        self.assertEqual(post.call_args.args[1]['phoneNumber'], '+12025550100')

    def test_event_proposal_waits_for_user_approval(self):
        args = {'summary': 'Recruiter call', 'start': '2026-10-04T14:30:00-04:00', 'end': '2026-10-04T15:00:00-04:00', 'time_zone': 'America/New_York'}
        result = json.loads(calendar_tools.propose_calendar_event(args))
        self.assertEqual(result['status'], 'awaiting_user_approval')
        self.assertEqual(calendar_tools.calendar_proposal.get()['summary'], 'Recruiter call')
        self.assertIn('No event created yet', result['message'])

    def test_tools_refuse_when_no_phone_identity_is_bound(self):
        calendar_tools.calendar_owner.set(None)
        result = json.loads(calendar_tools.propose_calendar_event({
            'summary': 'Call', 'start': '2026-10-04T14:30:00-04:00', 'end': '2026-10-04T15:00:00-04:00', 'time_zone': 'America/New_York',
        }))
        self.assertIn('No iMessage user', result['error'])


if __name__ == '__main__':
    unittest.main()
