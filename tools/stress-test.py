#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later

"""Exercise the PowerManager web buttons while monitoring its SSE event log."""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


CHANNELS = ["MAIN", *(f"CH {number}" for number in range(1, 8))]
ERROR_MARKERS = (
    "VERIFY mismatch",
    "WRITE failed",
    "READ failed",
    "SETUP failed",
    "ON blocked",
    "[IO] ERROR",
)


class Monitor:
    def __init__(self, base_url: str, log_path: Path) -> None:
        self.base_url = base_url.rstrip("/")
        self.log_path = log_path
        self.states: dict[str, str] = {}
        self.io_status: str | None = None
        self.errors: list[str] = []
        self.connected = threading.Event()
        self.stopped = threading.Event()
        self.condition = threading.Condition()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self.thread.start()
        if not self.connected.wait(10):
            raise RuntimeError("No connection to the device event stream within 10 seconds")

    def stop(self) -> None:
        self.stopped.set()

    def _record(self, event: str, data: str) -> None:
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        line = f"{timestamp} [{event}] {data}"
        print(line, flush=True)
        with self.log_path.open("a", encoding="utf-8") as stream:
            stream.write(line + "\n")

        if event == "log" and any(marker in data for marker in ERROR_MARKERS):
            self.errors.append(data)
        if event != "state":
            return
        try:
            state = json.loads(data)
        except json.JSONDecodeError:
            self.errors.append(f"Invalid state event: {data}")
            return
        entity_id = state.get("id", "")
        value = state.get("state")
        with self.condition:
            if entity_id == "text_sensor/IO Status":
                self.io_status = value
                if isinstance(value, str) and value.startswith("ERROR"):
                    self.errors.append(value)
            elif entity_id.startswith("switch/") and value in ("ON", "OFF"):
                self.states[entity_id.removeprefix("switch/")] = value
            self.condition.notify_all()

    def _run(self) -> None:
        request = Request(f"{self.base_url}/events", headers={"Accept": "text/event-stream"})
        try:
            with urlopen(request, timeout=30) as response:
                self.connected.set()
                event = "message"
                data: list[str] = []
                while not self.stopped.is_set():
                    raw = response.readline()
                    if not raw:
                        raise RuntimeError("Device closed the event stream")
                    line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                    if not line:
                        if data:
                            self._record(event, "\n".join(data))
                        event, data = "message", []
                    elif line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:"):
                        data.append(line[5:].lstrip())
        except Exception as error:  # Report transport errors through the normal result path.
            if not self.stopped.is_set():
                self.errors.append(f"Event stream failed: {error}")
                self._record("driver", self.errors[-1])
                self.connected.set()

    def press(self, name: str, action: str) -> None:
        label = quote(f"{name} {action}", safe="")
        request = Request(f"{self.base_url}/button/{label}/press", data=b"", method="POST")
        try:
            with urlopen(request, timeout=5) as response:
                if response.status >= 300:
                    raise RuntimeError(f"HTTP {response.status}")
        except URLError as error:
            raise RuntimeError(f"Failed to press {name} {action}: {error}") from error

    def read_state(self, name: str) -> str:
        entity = quote(name, safe="")
        request = Request(f"{self.base_url}/switch/{entity}")
        try:
            with urlopen(request, timeout=5) as response:
                state = json.load(response).get("state")
        except (URLError, OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Failed to read {name} state: {error}") from error
        if state not in ("ON", "OFF"):
            raise RuntimeError(f"Invalid {name} state response: {state!r}")
        with self.condition:
            self.states[name] = state
        return state

    def wait_state(self, name: str, expected: str, timeout: float = 5.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self.condition:
                if self.states.get(name) == expected:
                    return
            # ESPHome does not reliably emit a state event after template switch
            # publication. Sequential GETs cannot race with another test command.
            if self.read_state(name) == expected:
                return
            time.sleep(0.1)
        actual = self.states.get(name, "unknown")
        raise RuntimeError(f"{name} did not reach {expected}; current state is {actual}")

    def require_healthy(self) -> None:
        if self.errors:
            raise RuntimeError(self.errors[-1])

    def wait_ready(self, timeout: float = 10.0) -> None:
        deadline = time.monotonic() + timeout
        with self.condition:
            while self.io_status != "OK - no driver error":
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError(f"I/O did not become ready; status is {self.io_status or 'unknown'}")
                self.condition.wait(remaining)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default="powermanager.site", help="device host or IP address")
    parser.add_argument("--cycles", type=int, default=10, help="number of complete switching cycles")
    parser.add_argument("--settle", type=float, default=0.6, help="seconds between confirmed actions")
    parser.add_argument("--log", type=Path, default=Path("powermanager-stress.log"))
    parser.add_argument(
        "--confirm-switching",
        action="store_true",
        help="required acknowledgement that the test energizes every output",
    )
    args = parser.parse_args()
    if args.cycles < 1 or args.settle < 0:
        parser.error("--cycles must be positive and --settle must not be negative")
    if not args.confirm_switching:
        parser.error("the test energizes every output; pass --confirm-switching to run it")
    return args


def main() -> int:
    args = parse_args()
    base_url = args.device if "://" in args.device else f"http://{args.device}"
    args.log.write_text("", encoding="utf-8")
    monitor = Monitor(base_url, args.log)
    switching_started = False
    try:
        monitor.start()
        monitor.wait_ready()
        monitor.require_healthy()

        for cycle in range(1, args.cycles + 1):
            print(f"--- cycle {cycle}/{args.cycles} ---", flush=True)
            switching_started = True
            monitor.press("MAIN", "ON")
            monitor.wait_state("MAIN", "ON")
            time.sleep(args.settle)

            for channel in CHANNELS[1:]:
                monitor.press(channel, "ON")
                monitor.wait_state(channel, "ON")
                time.sleep(args.settle)
                monitor.require_healthy()

            monitor.press("MAIN", "OFF")
            for channel in reversed(CHANNELS):
                monitor.wait_state(channel, "OFF", timeout=10)
            time.sleep(args.settle)
            monitor.require_healthy()

        print(f"PASS: {args.cycles} cycles completed without a detected I/O error")
        print(f"Log written to {args.log}")
        return 0
    except (RuntimeError, OSError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        print(f"Log written to {args.log}", file=sys.stderr)
        return 1
    finally:
        if switching_started:
            try:
                monitor.press("MAIN", "OFF")
            except RuntimeError as error:
                print(f"WARNING: final MAIN OFF failed: {error}", file=sys.stderr)
        monitor.stop()


if __name__ == "__main__":
    raise SystemExit(main())
