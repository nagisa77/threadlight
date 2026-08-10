# Security policy

## Supported versions

Security fixes are applied to the latest stable release only.

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| 0.1.x | No |
| Earlier versions | No |

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository when available. If it is unavailable, contact the repository owner privately through the contact information on their GitHub profile.

Include the affected version, impact, reproduction steps, and any suggested mitigation. Do not include real API keys, tokens, personal data, or other secrets.

## Security model

Built-in tools run with the current user's permissions. Threadlight is not an operating-system sandbox and should only be used with trusted workspaces. For strong isolation, run it inside a container, virtual machine, or operating-system sandbox.
