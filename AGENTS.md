<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# PowerManager — AGENTS.md

## Project name

The manufacturer originally called the device "Conrad POWER Manager".
Internally, use `powermanager` where case is irrelevant or lowercase is useful,
such as hostnames, paths, and topics. Use `PowerManager` in user-facing names
and log messages.

## Project goal

[Target behavior and scope]

## Hardware architecture

[WT32-ETH01, PCF8574 devices, relay board, RS-15-5]

## Fixed pin assignments

[GPIO table]

## Fixed I/O mapping

[P0 = MAIN, P1 through P7 = CH 1 through CH 7]

## Electrical conventions

[PCF8574 at 3.3 V, active-low LEDs and relays, VCC/JD-VCC, and related details]

## Required behavior

[MAIN state machine]

## Software architecture

[ESPHome, Ethernet, and optional MQTT integration for local operation]

## Safety and startup requirements

[Power-up OFF, no relay chatter during OTA, and related requirements]

## Coding conventions

[IDs, naming, YAML structure, and related conventions]

## Implementation constraints

[No MQTT dependency for local control; timers use separate state]

## Open design decisions

[Only decisions that Codex must not make without user input]

## Test requirements

[Boot, reset, OTA, Ethernet loss, power cycle, and related tests]

## Open design decisions

The following points are intentionally undecided. Do not silently choose a
behavior. Ask before implementing it.

- Timer behavior when MAIN is switched OFF
- Whether manual operation cancels an active timer
- Timer persistence across reboot
- Long-press semantics and channel locking
- Absolute-time scheduling

## Behavioral invariants

These rules must not be changed without explicit instruction.

- P0 is always MAIN.
- P1 through P7 always correspond to channels 1 through 7.
- MAIN OFF forces all seven channels OFF.
- MAIN ON never restores previous channel states.
- After a full power cycle, all relays must be OFF.
- Local button operation must work without Ethernet or MQTT.
- MQTT must never be required for safety-relevant state transitions.

## General principles

- Keep configurations simple, readable, and maintainable.
- Prefer local and autonomous operation.
- Do not introduce cloud dependencies.
- Avoid unnecessary external components or libraries.
- Do not change unrelated projects while working on this device.

## Code and documentation

- Write identifiers, code comments, log messages, HMI text, and documentation
  in English.
- Keep comments focused on why something is done instead of explaining obvious
  syntax.
- Document non-obvious constraints and design decisions.
- Do not add excessive comments or generated documentation.
- Use uppercase variable names in Bash and lower camel case in C++.
- Use dashes (`-`) as filename separators instead of underscores (`_`).

## Changes

- Prefer small, focused changes.
- Do not refactor unrelated code while implementing a requested feature.
- Explain significant architectural changes before implementing them.

## Validation

Validate code changes at source-code level.
