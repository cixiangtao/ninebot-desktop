"""Test only the confirmation function in fresh synthetic PTYs, never Keychain."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import signal
import sys
import time

module = (Path(__file__).resolve().parent / "auth-keychain.ts").as_uri()
code = (
    'import {confirmKeychainRead} from ' + json.dumps(module) + ';'
    'try {await confirmKeychainRead(); console.log("CONFIRMED");}'
    'catch {console.log("CANCELLED"); process.exitCode=1;}'
)
for label, answer, expected, status in [
    ("accept", b"READ ONCE\n", b"CONFIRMED", 0),
    ("decline", b"no\n", b"CANCELLED", 1),
    ("interrupt", b"\x03", b"CANCELLED", 1),
    ("eof", b"\x04", b"CANCELLED", 1),
]:
    pid, master = pty.fork()
    if pid == 0:
        os.execv(sys.argv[1], [sys.argv[1], "--input-type=module", "-e", code])
    result = bytearray()
    sent = False
    reaped = False
    try:
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], 0.1)
            if ready:
                try:
                    data = os.read(master, 8192)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    data = b""
                result.extend(data)
                if not sent and b"READ ONCE" in result:
                    os.write(master, answer)
                    sent = True
            ended, wait_status = os.waitpid(pid, os.WNOHANG)
            if ended:
                reaped = True
                assert os.waitstatus_to_exitcode(wait_status) == status, label
                assert expected in result, label
                break
        assert reaped, label + " did not exit"
    finally:
        if not reaped:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        os.close(master)
print("Synthetic terminal confirmation checks passed; no Keychain helper was invoked.")
