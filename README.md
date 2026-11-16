![Logo](admin/tristar-mppt.png)
# ioBroker.tristar-mppt

[![NPM version](https://img.shields.io/npm/v/iobroker.tristar-mppt.svg)](https://www.npmjs.com/package/iobroker.tristar-mppt)
![Number of Installations](https://iobroker.live/badges/tristar-mppt-installed.svg)
[![Test and Release](https://github.com/joergoss/ioBroker.tristar-mppt/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/joergoss/ioBroker.tristar-mppt/actions/workflows/test-and-release.yml)

ioBroker-Adapter für Morningstar **TriStar MPPT**-Laderegler über **Modbus TCP**. Der Adapter liest Mess-, Status- und Tageswerte und stellt ausgewählte Steuerfunktionen bereit.

## Voraussetzungen und unterstützte Hardware

- Morningstar TriStar MPPT mit erreichbarer Modbus-TCP-Schnittstelle.
- Nach der Morningstar-Spezifikation ist die integrierte Ethernet-/Modbus-TCP-Schnittstelle bei **TS-MPPT-60**-Modellen vorhanden. Andere Modelle werden direkt über Ethernet nicht von dieser Adapterversion unterstützt. Modbus-RTU/serielle Verbindungen sind nicht implementiert.
- Die **TriStar-600V-Variante** besitzt eine separate Modbus-Spezifikation und ist mit diesem Adapter nicht geprüft.
- Standardmäßig Port **502** und Modbus Unit-ID **1**.
- Ein aktueller ioBroker js-controller und Node.js gemäß den Angaben in `io-package.json` bzw. `package.json`.

Die Registerimplementierung folgt der offiziellen [TriStar MPPT MODBUS Specification, MS-002582 v11](https://www.morningstarcorp.com/wp-content/uploads/technical-doc-tristar-mppt-modbus-specification-en.pdf).

## Installation und Konfiguration

Den Adapter installieren, eine Instanz anlegen und folgende Einstellungen vor dem Start vornehmen:

| Einstellung | Standard | Bedeutung |
|---|---:|---|
| `hostname` | leer | Hostname oder IP-Adresse des Controllers; Pflichtfeld |
| `port` | `502` | Modbus-TCP-Port, 1–65535 |
| `unitId` | `1` | Modbus Unit-ID, 1–247 |
| `interval` | `1` | Abfrageintervall in Sekunden, mindestens 1 |
| `installedWP` | `0` | Installierte PV-Leistung in Wp; `0` deaktiviert die Prozentberechnung |

Die Werte werden auch beim Adapterstart validiert. Bei ungültiger Konfiguration bleibt `info.connection` auf `false`; die Fehlermeldung steht im Adapter-Log.

## Datenpunkte

Alle Registerangaben sind **PDU-Adressen**, nicht die um eins höheren logischen Adressen aus der Morningstar-Tabelle. Datenpunkte mit Typ `array` enthalten ein JSON-kodiertes String-Array, z. B. `["RTS open"]`.

### Information, ADC und Temperatur

| Datenpunkt | Register | Einheit | Bedeutung |
|---|---|---:|---|
| `info.firmware` | `0x0004` | – | Firmwareversion als BCD-Ziffern |
| `adc.vb_f_med` | `0x0018` | V | Gefilterte Batteriespannung |
| `adc.vbTerm` | `0x0019` | V | Gefilterte Spannung an den Batterieklemmen |
| `adc.p12` | `0x001E` | V | Interne 12-V-Versorgung |
| `adc.p3` | `0x001F` | V | Interne 3-V-Versorgung |
| `adc.pMeter` | `0x0020` | V | MeterBus-Versorgung |
| `adc.p18` | `0x0021` | V | Interne 1,8-V-Versorgung |
| `adc.vRef` | `0x0022` | V | Referenzspannung |
| `temp.HS` | `0x0023` | °C | Kühlkörpertemperatur |
| `temp.RTS` | `0x0024` | °C | Remote-Temperatursensor; `null` bei `0x80` = nicht angeschlossen |
| `temp.BATT` | `0x0025` | °C | Batterie-Regelungstemperatur |

### Batterie

| Datenpunkt | Register | Einheit | Bedeutung |
|---|---|---:|---|
| `batt.V` | `0x0018` | V | Batteriespannung |
| `batt.SensedV` | `0x001A` | V | Gefilterte Battery-Sense-Spannung |
| `batt.A` | `0x001C` | A | Batterieladestrom |
| `batt.OutPower` | `0x003A` | W | Ausgangsleistung zur Batterie |
| `batt.Vmin` | `0x0028` | V | Langzeit-Minimum der Batteriespannung |
| `batt.Vmax` | `0x0029` | V | Langzeit-Maximum der Batteriespannung |
| `batt.Vf1m` | `0x0026` | V | Batteriespannung, etwa 1 Minute gefiltert |
| `batt.Af1m` | `0x0027` | A | Ladestrom, etwa 1 Minute gefiltert |
| `batt.Vtarget` | `0x0033` | V | Temperaturkompensierte Ziel-Ladespannung |

### Solar / MPPT

| Datenpunkt | Register | Einheit | Bedeutung |
|---|---|---:|---|
| `solar.V` | `0x001B` | V | Array-Spannung |
| `solar.I` | `0x001D` | A | Array-Strom; laut Morningstar nur eingeschränkt präzise |
| `solar.InPower` | `0x003B` | W | Array-Eingangsleistung |
| `solar.InPowerPercent` | aus `0x003B` | % | Eingangsleistung relativ zu `installedWP`; `null`, wenn `installedWP=0` |
| `solar.sweep.Pmax` | `0x003C` | W | Maximale Array-Leistung des letzten Sweeps |
| `solar.sweep.Vmp` | `0x003D` | V | Maximum-Power-Spannung des letzten Sweeps |
| `solar.sweep.Voc` | `0x003E` | V | Leerlaufspannung des letzten Sweeps |

Morningstar weist darauf hin, dass der Array-Strom nicht mit Präzisionsshunts gemessen wird und etwa **±20 %** abweichen kann. Daraus abgeleitete Eingangsleistung und Prozentwerte sind daher keine Eichmessung.

### Status und Zähler

| Datenpunkt | Register | Einheit | Bedeutung |
|---|---|---:|---|
| `state.charge` | `0x0032` | – | Ladestufe als Text (`START`, `MPPT`, `ABSORPTION`, `FLOAT`, …) |
| `state.hourmeter` | `0x002A/0x002B` | h | Betriebsstundenzähler |
| `state.kWhResetable` | `0x0038` | kWh | Ladungsmenge seit dem letzten Reset; historische Schreibweise der ID bleibt erhalten |
| `state.kWhTotal` | `0x0039` | kWh | Gesamte Solar-Ladungsmenge |
| `state.AhResettable` | `0x0034/0x0035` | Ah | Amperestunden seit dem letzten Reset |
| `state.AhTotal` | `0x0036/0x0037` | Ah | Gesamte Amperestunden |
| `state.faults` | `0x002C` | – | Aktive Controller-Faults als JSON-Array |
| `state.alarm` | `0x002E/0x002F` | – | Aktive Controller-Alarme als JSON-Array |
| `state.dip` | `0x0030` | – | DIP-Schalter als 8-Bit-Text; Bit 0 entspricht Schalter 1 |
| `state.led` | `0x0031` | – | Numerischer LED-Zustand |
| `state.ledText` | `0x0031` | – | LED-Zustand als Text |

### Tageswerte

| Datenpunkt | Register | Einheit | Bedeutung |
|---|---|---:|---|
| `today.batt.Vmin` | `0x0040` | V | Tagesminimum der Batteriespannung |
| `today.batt.Vmax` | `0x0041` | V | Tagesmaximum der Batteriespannung |
| `today.solar.Vmax` | `0x0042` | V | Tagesmaximum der Array-Spannung |
| `today.Ahc` | `0x0043` | Ah | Heute akkumulierte Ladung |
| `today.Whc` | `0x0044` | Wh | Heute akkumulierte Energie |
| `today.flags` | `0x0045` | – | Tages-Ereignis-Bitfeld |
| `today.batt.Pmax` | `0x0046` | W | Maximale Ausgangsleistung des Tages |
| `today.batt.Tmin` | `0x0047` | °C | Tagesminimum der Batterietemperatur |
| `today.batt.Tmax` | `0x0048` | °C | Tagesmaximum der Batterietemperatur |
| `today.fault` | `0x0049` | – | Tages-Fault-Bitfeld |
| `today.alarm` | `0x004B/0x004C` | – | Tagesalarme als JSON-Array |
| `today.timeAbsorption` | `0x004D` | s | Heutige Zeit in Absorption |
| `today.timeEqualize` | `0x004E` | s | Heutige Zeit in Equalization |
| `today.timeFloat` | `0x004F` | s | Heutige Zeit in Float |

## Steuerung und Sicherheit

> **Warnung:** Control-Datenpunkte verändern den Laderegler. Werte nur mit korrekter Anlagenkonfiguration und nach Prüfung der Morningstar-Dokumentation schreiben. Tests mit `Reset` oder Regelungs-Overrides gehören nicht in eine unbeaufsichtigte CI oder einen produktiven Ablauf.

Nur Benutzerkommandos mit **`ack=false`** werden geschrieben. Vom Adapter oder anderen Systemen quittierte Updates mit `ack=true` lösen keinen Modbus-Schreibzugriff aus. Erfolgreiche Kommandos werden mit `ack=true` bestätigt; bei einem Fehler erfolgt keine Erfolgsquittierung.

| Datenpunkt | Modbus | Funktion |
|---|---|---|
| `control.IbattRefSlave` | Holding Register `0x0058` | Batteriestrom-Override in A |
| `control.VbattRefSlave` | Holding Register `0x0059` | Batteriespannungs-Override in V |
| `control.VarrayFixed` | Holding Register `0x005A` | Fester Array-Spannungszielwert in V |
| `control.VarrayFixedPct` | Holding Register `0x005B` | Array-Ziel in Prozent von Voc, 0–100 % |
| `control.ClearFaults` | Coil `0x0014` | `true` löscht Controller-Faults |
| `control.ClearAlarm` | Coil `0x0015` | `true` löscht Controller-Alarme |
| `control.Reset` | Coil `0x00FF` | `true` startet den Controller nach der Modbus-Antwort neu |

### Slave-Control: 60-Sekunden-Bedingung

Ein positiver, nicht nuller Wert an `IbattRefSlave` oder `VbattRefSlave` aktiviert Slave-Control. Morningstar verlangt, dass das Register **mindestens alle 60 Sekunden erneut geschrieben** wird. Andernfalls meldet der Controller `Slave Control Timeout` (Fault-Bit 11).

Dieser Adapter führt **keinen automatischen Keepalive** aus. Das aufrufende Skript bzw. Regelsystem muss den Sollwert daher deutlich häufiger als alle 60 Sekunden erneut mit `ack=false` schreiben. Ein **negativer Wert** deaktiviert Slave-Control. Schutzfunktionen und interne Limits des Controllers können den tatsächlichen Strom trotzdem reduzieren.

### Feste Array-Spannung

Ein nicht nuller Wert an `VarrayFixed` oder `VarrayFixedPct` deaktiviert das normale MPPT-Tracking. `VarrayFixed` hat Vorrang vor dem Prozentziel. Diese Register besitzen keine Slave-Keepalive-Bedingung. Zum Zurückkehren zum normalen MPPT-Betrieb die Ziele gemäß Morningstar-Dokumentation auf `0` setzen.

Die Button-Datenpunkte werden nach erfolgreichem `true`-Kommando automatisch wieder auf `false` mit `ack=true` gesetzt. Ein Schreiben von `false` verursacht keinen Coil-Zugriff.

## Verbindung und Diagnose

- `info.connection=true`: Der letzte Registerzugriff war erfolgreich.
- `info.connection=false`: Konfiguration oder Kommunikation ist fehlerhaft bzw. der Adapter wurde noch nicht erfolgreich verbunden.
- Der TriStar schließt die TCP-Verbindung nach einer Modbus-Antwort. Der Adapter baut daher für serialisierte Lese-/Schreiboperationen neue Verbindungen auf.
- Socket- und Request-Fehler werden mit Fehlermeldung/Stack protokolliert. Zuletzt bekannte Messwerte bleiben erhalten; ihre Aktualität ist an `info.connection` zu prüfen.
- Auf Loglevel **debug** schreibt der Adapter die zuletzt empfangenen Rohregister. Diese Werte sind bei Ausreißern zusammen mit Zeitpunkt, betroffenem Datenpunkt und `installedWP` hilfreich.

## Migration von Version 0.0.2

Der frühere Datenpunkt `today.batt.Imax` war kein vom Protokoll dokumentierter Maximalstrom. Er las das falsche Register mit Stromskalierung. Er wird entfernt und durch `today.solar.Vmax` (maximale tägliche Array-Spannung) ersetzt. Der Template-Datenpunkt `testVariable` wird ebenfalls entfernt.

## Entwicklung

```bash
npm ci
npm run check
npm run lint
npm test
npm run build
npm run test:integration
```

Die Register-, Konvertierungs- und Kommandotests verwenden Fixtures bzw. Mocks und schreiben nicht auf reale Hardware.

## Changelog

### **WORK IN PROGRESS**
- (joerg) Modbus-Register, Skalierung, Vorzeichen und Metadaten gemäß Morningstar MS-002582 v11 korrigiert (#1, #3).
- (joerg) Rohregister-Diagnose für gemeldete Messwert-Ausreißer ergänzt; Ursachenklärung mit realen Rohdaten bleibt Teil von #2.
- (joerg) Sichere ACK-basierte Kommandoverarbeitung und serialisierte Modbus-Zugriffe (#4, #5).
- (joerg) Admin, Konfigurationsvalidierung und Template-Reste bereinigt (#6).
- (joerg) Aktuelle Test-/CI-Basis und echte Regressionstests (#7).
- (joerg) Vollständige Benutzer-/Datenpunkt-Dokumentation und zusätzliche RAM-Werte (#8, #9).

### 0.0.2 (2022-01-15)
- (joerg) initial release

## License

MIT License — siehe [LICENSE](LICENSE).
