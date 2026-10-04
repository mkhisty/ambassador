import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import listen


class StartupTests(unittest.TestCase):
    def test_local_widget_import_after_isolated_relaunch(self):
        script = str(Path(listen.__file__).resolve())
        code = (
            "import runpy; "
            f"module = runpy.run_path({script!r}, run_name='import_check'); "
            "assert module['ReviewStore'].__module__ == 'widget'; "
            "assert module['get_response'].__name__ == 'get_response'"
        )
        result = subprocess.run(
            [sys.executable, "-I", "-B", "-c", code],
            cwd="/tmp", capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_hermes_bootstraps_before_servers_start(self):
        with patch.dict(os.environ, {"WIDGET_PUBLIC_URL": "https://example.test"}), \
                patch.object(listen.get_response, "load_hermes", side_effect=SystemExit("relaunch")) as bootstrap, \
                patch.object(listen, "start_widget_server") as widget, \
                patch.object(listen.subprocess, "Popen") as sidecar:
            with self.assertRaisesRegex(SystemExit, "relaunch"):
                listen.main()
        bootstrap.assert_called_once()
        widget.assert_not_called()
        sidecar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
