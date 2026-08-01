<img src="admin/ecoflow-powerocean.png" alt="" width="96" align="right">

# ioBroker.ecoflow-powerocean

**English** · [Deutsch](README.de.md)

Reads live data from the **EcoFlow Ocean 2** (serial numbers starting with
`RE11`) and other PowerOcean systems, and writes PV, battery, grid and phase
values into the ioBroker object tree.

The adapter appears in ioBroker as **EcoFlow Ocean 2**.

Device manufacturer: [EcoFlow Ocean 2](https://www.ecoflow.com/de/pages/ecoflow-ocean-2-solarspeicher-heimspeicher)

## Why this adapter exists

EcoFlow's official **Developer API does not return live data for PowerOcean**:

- `/iot-open/sign/device/quota` returns error `1006` ("current device is not allowed to get device info")
- battery modules return error `8512` ("no permission")
- the official MQTT topic can be subscribed to, but never sends anything
- the history endpoints return field names with empty values

The only working path is the **MQTT broker that the EcoFlow app itself uses**.
The device pushes Protobuf telemetry there roughly every 2 seconds.

The **Ocean 2** (serial numbers starting with `RE11`) uses the previously
undocumented **`cmdFunc 254`** message class (`cmdId 39` = telemetry,
`cmdId 46` = battery module). The decoder in `src/lib/protobuf.ts` was
reverse-engineered from recorded traffic and verified against the EcoFlow web
portal (values matched within ~1 %). Older systems using `cmdFunc 96` are
handled as well.

> **Note:** This uses EcoFlow's inofficial app API. It may break at any time if
> EcoFlow changes it.

## Installation

The adapter is not in the official ioBroker repository yet. Install it from
GitHub — in the ioBroker admin under *Adapters → the cat icon (install from
custom source) → From GitHub*, enter:

```
jensfr1/ioBroker.ecoflow-powerocean
```

Or from the command line on your ioBroker host:

```bash
iobroker url https://github.com/jensfr1/ioBroker.ecoflow-powerocean/tarball/main
```

Then create an instance and fill in the settings below.

## Related projects

[foxthefox/ioBroker.ecoflow-mqtt](https://github.com/foxthefox/ioBroker.ecoflow-mqtt)
supports many EcoFlow devices including older PowerOcean generations, with far
more data points. **Try it first** — if it already works for your device, use it.
This adapter is focused on systems whose telemetry that adapter does not decode
yet.

[jensfr1/ha-ecoflow-ocean2](https://github.com/jensfr1/ha-ecoflow-ocean2) is the
same approach for Home Assistant, sharing the decoder logic.

## Configuration

| Setting | Description |
|---|---|
| E-mail | Your EcoFlow account (same as in the app) |
| Password | Stored encrypted by ioBroker |
| Serial number | Serial of the inverter, e.g. `RE11XXXXXXXXXXXX` |
| Update interval | How often states are written (1–60 s, default 10) |

## Objects

```
ecoflow-powerocean.0
├── info.connection            connected to the EcoFlow cloud
├── info.lastUpdate            timestamp of the last message
├── device.sn                  serial number
├── pv.power                   W    PV generation
├── pv.strings.<n>.power       W    per MPPT string
├── battery.soc                %    state of charge
├── battery.power              W    positive = charging, negative = discharging
├── battery.charging           bool
├── battery.remainingEnergy    Wh
├── battery.packs.<n>.*             per battery module (soc, temperature,
│                                   cellVoltage, remainingWh, power, soh, cycles)
├── grid.power                 W    positive = import, negative = export
├── house.power                W    calculated, see below
├── inverter.power             W    inverter AC output
├── energy.gridImported        Wh   cumulative counters, restart-proof
├── energy.gridExported        Wh
├── energy.pvProduced          Wh
├── energy.batteryCharged      Wh
├── energy.batteryDischarged   Wh
├── energy.houseConsumed       Wh
└── phases.<a|b|c>.*           V / A / W / var / VA
```

**`house.power` comes from the device**, which reports it balanced against
solar, battery and grid in the same instant. Only when that field is missing
does the adapter fall back to a calculation — and that fallback comes out
systematically low, because the fields it relies on are updated independently
and therefore stem from different moments.

> **What house consumption really means:** the device reports what your house
> draws *on top of* everything feeding in behind its meter. If you run a second,
> unmetered source — a balcony solar unit, for example — its output never shows
> up, and the value here is lower than your actual consumption.

## Development

```bash
npm install
npm run build      # TypeScript -> build/
npm test           # decoder + merge logic (no hardware needed)
```

Live check against a real system (prints snapshots for 40 s):

```bash
npx tsx test/live-check.ts <email> <password> <serial>
```

## Changelog

### 0.5.0

- **The pack voltage does exist after all — field 9, with the current in
  field 10.** Version 0.4.0 claimed it appears in none of the observed fields.
  That was wrong: 16.5 V looks implausibly low for a home battery, so the field
  was dismissed. The modules are wired **5S** — 16.46 V divided by 3.311 V per
  cell is exactly 5 cells in series. Confirmed through the power balance as
  well: field 9 times field 10 matches field 1 to within 1 %, independently on
  both modules. New states `battery.packs.N.voltage` and `.current`
- **The temperature fields are mapped**, from a 45-minute load test with the
  wallbox at up to 3.6 kW per module. What settles it is the dynamics, not the
  absolute value: in a system that heats up overall, every sluggish sensor
  correlates with the load by accident, which is why a plain average comparison
  labels nine of ten fields as power electronics
  - Fields 23/24/32/33 follow the load within a minute, 11–17 K of swing, up to
    7 K/min, and fall just as fast. Published as `tempMos` — the hottest of the
    four
  - Fields 31 ≤ 21 ≤ 30 hold that order in both modules at every point of both
    measurement runs, rise monotonically by 4–6 K over 45 minutes and ignore
    load changes: minimum, average and maximum **cell** temperature. New states
    `tempMinCell` and `tempMaxCell`; `temperature` keeps the average
  - Field 36 reads a constant 33 in both modules across both runs — not a
    temperature, and therefore not published
- The existing state `battery.packs.N.temperature` now carries the documented
  meaning "average cell temperature". Its value is unchanged

### 0.4.0

- **Three battery module fields were mapped wrongly** — reported by Sebastian
  ([ecoflow-energy-ha](https://github.com/shuette42/ecoflow-energy-ha)) and
  measured against a running system before changing anything:
  - Field 54 is the **remaining energy**, not the full capacity (4114 Wh at
    81.5 % puts full capacity at about 5046 Wh). Read as capacity the value
    drops while discharging — permanently misleading in operation
  - Field 39 is the **state of health**, not the state of charge: constant
    100.0 across the whole measurement while field 38 moved
  - Field 6 is a **cell voltage** (3329 mV), not the pack voltage — it follows
    the load. The object tree showed 332.6 V
- The state `battery.packs.N.voltage` is replaced by `cellVoltage`, and
  `capacityWh` by `remainingWh`. The old states stay behind in the object tree
  and can be deleted
- The pack voltage is no longer published at all: it appears in none of the 61
  observed fields, and a wrong number is worse than none

### 0.3.1

- **House consumption is now read from the device instead of being calculated.**
  The device reports it directly, balanced against solar, battery and grid in
  the same instant. The previous calculation (inverter output plus grid) came
  out systematically low, because those two fields are updated independently
  and therefore stem from different moments — 2018 W calculated against 2100 W
  reported on one system, 306 W against 490 W on another. This also corrects
  the `energy.houseConsumed` counter and every self-sufficiency figure derived
  from it

### 0.3.0

- **Energy counters** under `energy.*` in Wh: grid consumption and return,
  solar production, battery charged and discharged, house consumption. They
  survive an adapter restart and deliberately do **not** extrapolate across
  connection gaps — no energy is invented that never flowed

### 0.2.0

- Battery modules now also report **power**, **state of health** and **charge
  cycles**. The device was sending these all along — they were only read for
  the older generation

### 0.1.3

- Grid power now uses the same 30 W deadband as the EcoFlow app, so both
  displays agree when the meter idles around zero

### 0.1.2

- Grid power was read from the wrong field: `65.7` is a **setting**, not a
  measurement. On a zero-feed-in system it reads 0, on one with a 10 kW export
  limit it reads 10000 — constant either way. The real value is field `4.13`
- House consumption is now derived from inverter output plus grid import
  instead of `solar − battery + grid`, which is more accurate because
  conversion losses are already included in the inverter value

### 0.1.1

- Adapter now shuts down reliably: the keep-alive timer is managed by the
  adapter, so ioBroker can clear it on unload
- Installation from GitHub works: the compiled `build/` tree is part of the
  repository now (installing from GitHub does not run a build step)
- Admin dialog translated into eleven languages
- Integration and package tests added, CI runs on Node 22/24 across Linux,
  Windows and macOS

### 0.1.0
- Initial release: live data via EcoFlow app MQTT, support for `cmdFunc 254`
  (new PowerOcean generation) and `cmdFunc 96` (older generation)

## Support

I build this in my spare time and give it away. If it saves you something and you
can spare it, a small contribution is welcome — nothing is expected, and no
feature is gated behind it.

<a href="https://buymeacoffee.com/jensfr"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=flat&logo=buymeacoffee&logoColor=black" alt="Buy me a coffee"></a>

A GitHub star costs nothing and helps just as much.

## License

MIT License

Copyright (c) 2026 Jens Franke

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
