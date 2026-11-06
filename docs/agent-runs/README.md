# Agent runs

What the five `halcyon-*` agent definitions in `.claude/agents/` returned when each was run once, on 31 October 2026, with fictional or sample input. These were local runs of the definitions, without the live Azure AI Foundry agents, their knowledge files or a catalogue, and nothing was sent anywhere.

| Agent | Input | Result | File |
|---|---|---|---|
| `halcyon-email-verifier` | [`table-paste.json`](../../samples/unseen/email/table-paste.json) | Asked for more information: address read, region Midwest, W1 provisional. Product names stayed unmatched because no catalogue was available | [JSON](halcyon-email-verifier.json) |
| `halcyon-route-iq` | Three same-day orders | Assigned carriers but held all three for review, because capacity and pickup data are missing | [JSON](halcyon-route-iq.json) |
| `halcyon-reallocation-iq` | One product short at W5 | `REVIEW`, no transfer: reserved stock and transfer details are unknown | [JSON](halcyon-reallocation-iq.json) |
| `halcyon-communications-agent` | One out-of-stock order | A draft email, not sent | [Text](halcyon-communications-agent.txt) |
| `halcyon-stimulation-agent` | The week of 2 November 2026 | Blocked: its master-data file isn't in this repository, so it generated nothing rather than invent data | [JSON](halcyon-stimulation-agent.json) |

The [security re-check](security-verifier.md) is here too. It's a summary of the `security-verifier` report, without exploit steps.
