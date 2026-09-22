# dsh-offpeak

Holds DeepSeek model calls during peak pricing hours so they are sent at off-peak
rates. While a window is open, a request is simply not sent: the agent waits, and
resumes on its own when the window ends.

This is a standalone plugin. It reads and writes only its own files and does not
depend on any other plugin.

## Requirements

- DeepSeek Harness with the web profile.
- `DEEPSEEK_API_KEY` stored through the Models page, only if you want the balance
  and the spend chart. Pausing works without it.

## Install

```sh
# from GitHub
dsh plugin --profile web add github:TetraSsky/dsh-offpeak

# or from a local checkout
dsh plugin --profile web add <path-to-this-package>
```

Then add `dsh-offpeak` to `dsh.profile.bundles` in `$DSH_HOME/profiles/web/package.json`
and restart. The package's `cordis.patch.yml` inserts its own row.

For local development, a directory junction into the profile's `node_modules` plus an
`insert` row in `$DSH_HOME/profiles/web/cordis.patch.yml` also works and reloads live —
see [Development](#development).

## How the hold works

Three separate mechanisms, which together are what "paused" means here:

| Mechanism | Effect |
|---|---|
| **Request gate** | `llm/stream` is the waterfall every model call passes through. Inside a window the call is parked before it reaches the adapter, so nothing is sent and nothing is billed. |
| **Goal freeze** | Any goal in the `active` phase is paused, so it stops making progress and reads as paused rather than busy. Goals you paused yourself are never touched. |
| **Status tool** | `offpeak_status` lets the model report why it is waiting. Read-only: it cannot change the schedule. |

There is no per-request override and no per-window skip. The schedule is the single
statement of when calls are held; to end a pause early, edit the schedule or turn the
plugin off.

A held request is released when its window ends, when the request is aborted, when the
schedule changes so it is no longer held, or when the plugin unloads. A restart resumes
exactly the goals this plugin paused, using a record it keeps for that purpose.

## Schedule and time zones

Peak pricing is defined in Beijing time, so the plugin keeps two zones apart:

- **Schedule time zone** — the zone the windows are written in. Part of the schedule's
  identity.
- **Show times in** — a viewing preference only. Changing it re-labels the times; it
  can never change a window.

Because the state machine is evaluated in the schedule zone, the browser and the host
always agree about the state, whatever zone the browser is in.

**Apply DeepSeek peak hours** converts Beijing 09:00-12:00 and 14:00-18:00 (weekdays,
two-minute margin) into whichever schedule zone you have selected, and appends them.
It never changes your zone and never discards windows you added.

If your zone observes daylight saving, the converted windows drift relative to Beijing
peak twice a year, because Beijing does not move. The settings page says so and offers
to express the schedule in Beijing time instead, which cannot drift.

## Balance and spend chart

With **Show API balance** on, the host reads the DeepSeek account balance with your
stored key and the header shows the figure. Hovering it breaks the spend down; clicking
it opens eight hours of ten-minute bars.

- The key never leaves the host. The browser asks for the derived figure over an
  authenticated route.
- Spend is the sum of balance **drops**, so a top-up cannot cancel out real spend.
- Samples are taken every five minutes whenever the plugin is **enabled**, not only
  while the balance is displayed, and are kept in `$DSH_HOME/offpeak-history.json`
  (288 samples, about 24 hours).
- Spend is a derived quantity, so history begins when the plugin does. Nothing can
  reconstruct usage from before it was installed.

## Settings

| Setting | Meaning |
|---|---|
| Enable off-peak pause | Master switch. |
| Schedule time zone | Zone the windows are written in. The picker lists 58 zones covering every whole-hour offset from -11 to +14 plus the half- and quarter-hour ones, each labelled with its offset and sorted by it. |
| Show times in | Viewing zone for the second, greyed time. |
| Pause windows | `pauseAt`-`resumeAt` wall-clock ranges, each with its own weekdays. |
| Days that pause | Weekdays the schedule applies to. Weekends are off-peak, so excluded. |
| Warn before pause | How long before a window the notice appears. |
| Applies to | All calls, or DeepSeek official routes only. Default is official routes, because peak pricing exists only there. |
| Show API balance | Balance figure and spend chart. |
| Show the status in the header | Hide the header entry entirely. |

## Language

Strings follow the harness's own language selection; there is no separate setting, so
switching the harness between English and Chinese switches this plugin with it.

The harness ships exactly two locales (`zh` and `en`), and the plugin ships a dictionary
for each — no more and no less. A dictionary for a locale the harness does not ship could
never be selected, and a locale the plugin has no dictionary for falls back to English. A
missing key also falls back to English, so a raw key is never shown.

## Files

| Path | Contents |
|---|---|
| `$DSH_HOME/settings.yaml` | Configuration, under the `offpeak` namespace, in the harness settings document. |
| `$DSH_HOME/offpeak-history.json` | Balance samples for the chart. |
| `$DSH_HOME/offpeak-paused.json` | Goals paused by this plugin, so a restart resumes only those. |

## Development

There is no build step for the host half: `index.js` and `src/*.js` are the source.

The browser half is generated, because a client bundle cannot import a relative file
and the schedule logic must be shared verbatim with the host:

```sh
node scripts/build-client.mjs   # src/{core,spend,i18n,client}.js -> client.js
node tests/run.mjs              # 143 tests
```

`tests/bundle.test.mjs` fails if `client.js` drifts from its sources, so run the build
after changing any of those four files.

When installing through a junction, the plugin is realpath'd out of the profile, so
`@deepseek-ai/*` stops resolving from it. A `node_modules/@deepseek-ai` junction inside
this directory pointing at the profile's own set fixes that; it is not needed for a
copied install.

### Three things that cost time to find

**The client `locale` service has to be declared in `inject`.** `ctx.get('locale')` reads as
a tolerant lookup, but a service is only returned once its providing fiber is active — read
it a moment too early and you get `undefined`, after which every string in the plugin
quietly falls back to English while the rest of the harness switches language. Declaring
`locale` parks activation until the service is live. The settings section label is projected
by the settings shell rather than by this plugin, so it is registered as a thunk; a plain
string keeps whatever language it was registered under.

**Connection's generic RPC is unusable from another plugin.** `ctx.connection.rpc.handle()`
looks like the right way to serve host facts to your own browser half, but it registers
the route through Connection's *own* fiber, which never injects `webServer`. The
registration throws and the route silently never exists. Its other seat,
`intercept('/api', ...)`, is already claimed by the API Gateway. So this plugin registers
its own `webServer` prefix route and calls `connection.requestRejection()` per request to
keep the same Host/Origin fence and browser-session check.

**A route registered before Connection activates has no fence.** Connection can come up
after the route is installed, so `requestRejection` is resolved per request rather than
captured once. Capturing it at install time silently serves an unauthenticated endpoint.

## Credits

This plugin exists because of [dsh-save-money](https://github.com/zhu168/dsh-save-money)
by [zhu168](https://github.com/zhu168), which is MIT licensed. Reading its source is how
the shape of the problem was learned: the `llm/stream` waterfall as the place to hold a
call, pausing goals rather than only their next request, the DeepSeek peak-hours preset,
and deriving spend from balance samples. The state machine's three phases and the
half-open, midnight-crossing window matching follow its design.

It was written fresh rather than forked, because several of its decisions could not be
kept: configuration resolved from live session state, a balance history keyed by API-key
fingerprint, unauthenticated HTTP routes, and a model-facing tool that could rewrite the
schedule. Those are documented in the commit history rather than copied here.

If you want the plugin this one replaces, use theirs. If you want the fixes, use this.

## Licence

MIT.

