<img src="admin/ecoflow-powerocean.png" alt="" width="96" align="right">

# ioBroker.ecoflow-powerocean

**English** · [Deutsch](README.de.md)

Reads live data from **EcoFlow PowerOcean** systems — in particular the
**EcoFlow Ocean 2** (serial numbers starting with `RE11`) — and writes PV,
battery, grid and phase values into the ioBroker object tree.

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
├── battery.packs.<n>.*             per battery module (soc, temperature, voltage, …)
├── grid.power                 W    positive = import, negative = export
├── house.power                W    calculated, see below
├── inverter.power             W    inverter AC output
└── phases.<a|b|c>.*           V / A / W / var / VA
```

**`house.power` is calculated, not measured.** The device does not report house
load directly. It is derived from the energy balance:

```
house = PV − battery + grid
```

(battery positive = charging, grid positive = import). This matches how the
EcoFlow portal presents the value.

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

### 0.1.0
- Initial release: live data via EcoFlow app MQTT, support for `cmdFunc 254`
  (new PowerOcean generation) and `cmdFunc 96` (older generation)

## License

MIT License — Copyright (c) 2026 Jens Franke

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
