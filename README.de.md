<img src="admin/ecoflow-powerocean.png" alt="" width="96" align="right">

# ioBroker.ecoflow-powerocean

[English](README.md) · **Deutsch**

Liest Livedaten vom **EcoFlow Ocean 2** (Seriennummern beginnend mit `RE11`)
und anderen PowerOcean-Anlagen und schreibt PV, Batterie, Netz und Phasenwerte
in den ioBroker-Objektbaum.

Im ioBroker erscheint der Adapter als **EcoFlow Ocean 2**.

Gerätehersteller: [EcoFlow Ocean 2](https://www.ecoflow.com/de/pages/ecoflow-ocean-2-solarspeicher-heimspeicher)

## Warum es diesen Adapter gibt

Die offizielle **Developer-API von EcoFlow liefert für PowerOcean keine
Livedaten**:

- `/iot-open/sign/device/quota` antwortet mit Fehler `1006` („current device is not allowed to get device info")
- Batteriemodule antworten mit Fehler `8512` („no permission")
- Das offizielle MQTT-Topic lässt sich abonnieren, sendet aber nie etwas
- Die History-Endpunkte liefern Feldnamen mit leeren Werten

Der einzige funktionierende Weg ist der **MQTT-Broker, den die EcoFlow-App
selbst nutzt**. Dorthin schickt das Gerät etwa alle 2 Sekunden
Protobuf-Telemetrie.

Das **Ocean 2** (Seriennummern beginnend mit `RE11`) verwendet dabei die bislang
undokumentierte Nachrichtenklasse **`cmdFunc 254`** (`cmdId 39` = Telemetrie,
`cmdId 46` = Batteriemodul). Der Decoder in `src/lib/protobuf.ts` wurde aus
mitgeschnittenem Verkehr rekonstruiert und gegen das EcoFlow-Webportal verifiziert
(Abweichung ~1 %). Ältere Anlagen mit `cmdFunc 96` werden ebenfalls unterstützt.

> **Hinweis:** Das nutzt die inoffizielle App-API von EcoFlow. Sie kann sich
> jederzeit ändern.

## Installation

Der Adapter ist noch nicht im offiziellen ioBroker-Repository. Installation
daher über GitHub — im ioBroker-Admin unter *Adapter → Katzensymbol
(benutzerdefinierte Installation) → Aus GitHub*, dort eintragen:

```
jensfr1/ioBroker.ecoflow-powerocean
```

Oder auf der Kommandozeile des ioBroker-Hosts:

```bash
iobroker url https://github.com/jensfr1/ioBroker.ecoflow-powerocean/tarball/main
```

Danach eine Instanz anlegen und die Einstellungen unten ausfüllen.

## Verwandte Projekte

[foxthefox/ioBroker.ecoflow-mqtt](https://github.com/foxthefox/ioBroker.ecoflow-mqtt)
unterstützt viele EcoFlow-Geräte inklusive älterer PowerOcean-Generationen und
deutlich mehr Datenpunkte. **Probier den zuerst** — wenn er für dein Gerät
funktioniert, nimm ihn. Dieser Adapter zielt auf Anlagen, deren Telemetrie jener
Adapter noch nicht dekodiert.

[jensfr1/ha-ecoflow-ocean2](https://github.com/jensfr1/ha-ecoflow-ocean2) ist
derselbe Ansatz für Home Assistant, mit derselben Decoder-Logik.

## Konfiguration

| Einstellung | Beschreibung |
|---|---|
| E-Mail | Dein EcoFlow-Konto (wie in der App) |
| Passwort | Wird von ioBroker verschlüsselt abgelegt |
| Seriennummer | Die des Wechselrichters, z. B. `RE11XXXXXXXXXXXX` |
| Aktualisierungsintervall | Wie oft States geschrieben werden (1–60 s, Standard 10) |

Eine Instanz bedient genau ein Gerät. Für mehrere Anlagen mehrere Instanzen
anlegen.

## Objekte

```
ecoflow-powerocean.0
├── info.connection            mit der EcoFlow-Cloud verbunden
├── info.lastUpdate            Zeitstempel der letzten Nachricht
├── device.sn                  Seriennummer
├── pv.power                   W    PV-Erzeugung
├── pv.strings.<n>.power       W    je MPPT-String
├── battery.soc                %    Ladestand
├── battery.power              W    positiv = laden, negativ = entladen
├── battery.charging           bool
├── battery.remainingEnergy    Wh
├── battery.packs.<n>.*             je Batteriemodul (soc, temperature,
│                                   cellVoltage, remainingWh, power, soh, cycles)
├── grid.power                 W    positiv = Bezug, negativ = Einspeisung
├── house.power                W    berechnet, siehe unten
├── inverter.power             W    AC-Ausgang des Wechselrichters
├── energy.gridImported        Wh   Zählerstände, neustartfest
├── energy.gridExported        Wh
├── energy.pvProduced          Wh
├── energy.batteryCharged      Wh
├── energy.batteryDischarged   Wh
├── energy.houseConsumed       Wh
└── phases.<a|b|c>.*           V / A / W / var / VA
```

**`house.power` kommt vom Gerät**, das ihn im selben Moment mit Solar, Batterie
und Netz bilanziert meldet. Nur wenn dieses Feld fehlt, greift eine Rechnung —
und die fällt systematisch zu niedrig aus, weil die Felder, auf die sie sich
stützt, unabhängig voneinander aktualisiert werden und damit aus verschiedenen
Momenten stammen.

> **Was der Hausverbrauch wirklich bedeutet:** Das Gerät meldet, was dein Haus
> *zusätzlich* zu allem braucht, was hinter seinem Messpunkt einspeist. Läuft
> bei dir eine zweite, nicht mitgemessene Quelle — etwa ein Balkonkraftwerk —,
> taucht deren Ertrag nie auf, und der Wert hier liegt unter dem tatsächlichen
> Verbrauch.

## Entwicklung

```bash
npm install
npm run build      # TypeScript -> build/
npm test           # Decoder- und Merge-Logik (ohne Hardware)
```

Live-Test gegen eine echte Anlage (gibt 40 s lang Snapshots aus):

```bash
npx tsx test/live-check.ts <email> <passwort> <seriennummer>
```

## Changelog

### 0.4.0

- **Drei Felder im Batteriemodul waren falsch zugeordnet** — gemeldet von
  Sebastian ([ecoflow-energy-ha](https://github.com/shuette42/ecoflow-energy-ha))
  und vor der Änderung an einer laufenden Anlage nachgemessen:
  - Feld 54 ist die **Restenergie**, nicht die volle Kapazität (4114 Wh bei
    81,5 % ergibt rund 5046 Wh Vollkapazität). Als Kapazität gelesen sinkt der
    Wert beim Entladen — im Betrieb dauerhaft irreführend
  - Feld 39 ist der **Alterungszustand**, nicht der Ladestand: über die ganze
    Messung konstant 100,0, während Feld 38 sich bewegte
  - Feld 6 ist eine **Zellspannung** (3329 mV), keine Packspannung — sie folgt
    der Last. Im Objektbaum standen 332,6 V
- Der State `battery.packs.N.voltage` heißt jetzt `cellVoltage`, `capacityWh`
  heißt `remainingWh`. Die alten States bleiben als Leichen im Objektbaum
  stehen und können gelöscht werden
- Die Packspannung wird gar nicht mehr veröffentlicht: Sie steht in keinem der
  61 beobachteten Felder, und ein falscher Wert ist schlechter als keiner

### 0.3.1

- **Der Hausverbrauch kommt jetzt vom Gerät statt aus einer Rechnung.** Das
  Gerät meldet ihn direkt — im selben Moment wie Solar, Batterie und Netz und
  mit ihnen bilanziert. Die bisherige Rechnung (Wechselrichter plus Netz) lag
  systematisch zu niedrig, weil diese beiden Felder unabhängig voneinander
  aktualisiert werden und damit aus verschiedenen Momenten stammen: 2018 W
  gerechnet gegen 2100 W gemeldet an einer Anlage, 306 W gegen 490 W an einer
  anderen. Damit stimmt auch der Zähler `energy.houseConsumed` und jede daraus
  abgeleitete Autarkiequote

### 0.3.0

- **Energiezähler** unter `energy.*` in Wh: Netzbezug und -einspeisung,
  Solarerzeugung, Batterie geladen und entladen, Hausverbrauch. Sie überstehen
  einen Adapterneustart und rechnen Verbindungslücken bewusst **nicht** hoch —
  es wird keine Energie erfunden, die nie geflossen ist

### 0.2.0

- Batteriemodule melden jetzt auch **Leistung**, **Alterungszustand** und
  **Ladezyklen**. Das Gerät sendet diese Werte längst — sie wurden nur für die
  ältere Generation ausgelesen

### 0.1.3

- Die Netzleistung nutzt jetzt dieselbe Totzone von 30 W wie die
  EcoFlow-App, damit beide Anzeigen im Leerlauf übereinstimmen

### 0.1.2

- Die Netzleistung kam aus dem falschen Feld: `65.7` ist eine **Einstellung**,
  keine Messung. Bei Nulleinspeisung steht dort 0, bei einer Anlage mit
  10-kW-Begrenzung 10000 — beide Male konstant. Der echte Wert steht in `4.13`
- Der Hausverbrauch ergibt sich jetzt aus Wechselrichter-Ausgang plus
  Netzbezug statt aus `PV − Batterie + Netz`. Das ist genauer, weil die
  Wandlungsverluste schon im Wechselrichterwert stecken

### 0.1.1

- Adapter beendet sich zuverlässig: Der Weckruf-Timer läuft jetzt über den
  Adapter, damit ioBroker ihn beim Entladen abräumen kann
- Installation von GitHub funktioniert: Das kompilierte `build/` liegt im
  Repository (bei einer GitHub-Installation läuft kein Build-Schritt)
- Admin-Dialog in elf Sprachen übersetzt
- Integrations- und Pakettests ergänzt, CI läuft auf Node 22/24 unter Linux,
  Windows und macOS

### 0.1.0

- Erste Veröffentlichung: Livedaten über das EcoFlow-App-MQTT, Unterstützung für
  `cmdFunc 254` (Ocean 2) und `cmdFunc 96` (ältere Generation)

## Unterstützung

Ich baue das in meiner Freizeit und gebe es her. Wenn es dir etwas spart und du
es erübrigen kannst, freue ich mich über einen kleinen Beitrag — erwartet wird
nichts, und nichts ist davon abhängig.

<a href="https://buymeacoffee.com/jensfr"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=flat&logo=buymeacoffee&logoColor=black" alt="Buy me a coffee"></a>

Ein Stern auf GitHub kostet nichts und hilft genauso.

## Lizenz

MIT License

Copyright (c) 2026 Jens Franke

Vollständiger Text in [LICENSE](LICENSE).
