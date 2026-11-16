![Logo](admin/tristar-mppt.png)
# ioBroker.tristar-mppt

[![NPM version](https://img.shields.io/npm/v/iobroker.tristar-mppt.svg)](https://www.npmjs.com/package/iobroker.tristar-mppt)
![Number of Installations](https://iobroker.live/badges/tristar-mppt-installed.svg)
[![Test and Release](https://github.com/joergspoerl/ioBroker.tristar-mppt/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/joergspoerl/ioBroker.tristar-mppt/actions/workflows/test-and-release.yml)

ioBroker-Adapter für Morningstar **TriStar MPPT**-Laderegler über **Modbus TCP**. Der Adapter liest Mess-, Status- und Tageswerte und stellt ausgewählte Steuerfunktionen bereit.

## Voraussetzungen und unterstützte Hardware

- Morningstar TriStar MPPT mit erreichbarer Modbus-TCP-Schnittstelle.
- Nach der Morningstar-Spezifikation ist die integrierte Ethernet-/Modbus-TCP-Schnittstelle bei **TS-MPPT-60**-Modellen vorhanden. Andere Modelle werden direkt über Ethernet nicht von dieser Adapterversion unterstützt. Modbus-RTU/serielle Verbindungen sind nicht implementiert.
- Die **TriStar-600V-Variante** besitzt eine separate Modbus-Spezifikation und ist mit diesem Adapter nicht geprüft.
- Standardmäßig Port **502** und Modbus Unit-ID **1**.
- Runtime: Node.js `>=18.0.0` und js-controller `>=7.0.0`. Für Entwicklung und CI werden aktuelle Node.js-Versionen 22/24/26 verwendet; die Dev-Toolchain benötigt entsprechend neuere Node-Versionen als die Runtime.

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
| `enableControlWrites` | `false` | Opt-in für RAM-Control- und Coil-Kommandos inklusive Slave-Control, Clear und Reset |
| `enableEepromWrites` | `false` | Zusätzliches, unabhängiges Opt-in für die abgesicherte EEPROM-Ladeeinstellungen-Allowlist |

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
| `solar.IFiltered` | aus `0x001D` | A | Median-3 über drei aufeinanderfolgende Poll-Snapshots |
| `solar.InPowerFiltered` | aus `0x003B` | W | Median-3 über drei aufeinanderfolgende Poll-Snapshots |
| `solar.InPowerPercentFiltered` | gefilterte Leistung | % | Prozentwert aus demselben gefilterten Leistungs-Snapshot |
| `solar.sweep.Pmax` | `0x003C` | W | Maximale Array-Leistung des letzten Sweeps |
| `solar.sweep.Vmp` | `0x003D` | V | Maximum-Power-Spannung des letzten Sweeps |
| `solar.sweep.Voc` | `0x003E` | V | Leerlaufspannung des letzten Sweeps |

Morningstar weist darauf hin, dass der Array-Strom nicht mit Präzisionsshunts gemessen wird und etwa **±20 %** abweichen kann. Daraus abgeleitete Eingangsleistung und Prozentwerte sind daher keine Eichmessung.

#### Ausreißer / Median-3

Die historischen Daten zeigen gelegentliche einsekündige Solar-Strom-/Leistungsspitzen. Die ursprünglichen Datenpunkte `solar.I`, `solar.InPower` und `solar.InPowerPercent` bleiben deshalb **unveränderte Roh-/Rechenwerte**. Für Anzeige und Auswertung stehen zusätzliche `...Filtered`-Datenpunkte bereit. Ein Median-3 unterdrückt isolierte Ein-Sample-Spitzen ohne eine erfundene obere Leistungsgrenze. Er ersetzt weder Ursachenanalyse noch Schutzfunktionen und ist nicht für Energieintegration oder Schutzlogik vorgesehen.

- Warm-up: Die gefilterten Werte sind bis zu drei aufeinanderfolgenden erfolgreichen Polls `null`.
- Ein realer neuer Pegel wird ohne Absenkung übernommen, kann aber kurz verzögert erscheinen.
- Zwei aufeinanderfolgende hohe Samples werden nicht als isolierter Ausreißer unterdrückt.
- Verbindungslücken, Skalierungsänderungen, ungültige Werte und Adapter-Neustarts leeren den Filterpuffer.
- Rohregister werden auf Debug-Level protokolliert, um echte Geräte-/Kommunikationsfehler weiterhin untersuchen zu können.

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
| `state.dip` | `0x0030` | – | Vollständiges 16-Bit-Bitfeld als Text; Bit 0 entspricht Schalter 1 |
| `state.led` | `0x0031` | – | Numerischer LED-Zustand |
| `state.ledText` | `0x0031` | – | LED-Zustand als Text |
| `state.equalizeTriggered` | Coil `0x0000` | – | IST-Status „Equalize ausgelöst“, read-only |
| `state.chargeDisconnect` | Coil `0x0002` | – | IST-Status „Charge disconnect“, read-only |

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

## Statische Netzwerk- und EEPROM-Datenpunkte

Diese Werte werden beim ersten erfolgreichen RAM-Poll und anschließend alle fünf Minuten gelesen. Active-TCP-Werte verwenden FC03; die EEPROM-Tabelle einschließlich EEPROM-Netzwerk wird gemäß Morningstar mit **FC04 (Read Input Registers)** gelesen. Ein statischer Lesefehler wird separat protokolliert und verändert nicht den erfolgreichen RAM-Verbindungsstatus. Reservierte Register werden nicht exposiert.

### Active TCP Network Settings — alle read-only

| Datenpunkt | Register | Bedeutung |
|---|---|---|
| `network.processorBVersion` | `0x1000` | Netzwerk-Prozessorversion als Roh-Hexwert |
| `network.ip` | `0x100F/0x1010` | Aktive IPv4-Adresse |
| `network.subnetMask` | `0x1011/0x1012` | Subnetzmaske |
| `network.gateway` | `0x1013/0x1014` | Gateway |
| `network.primaryDns` | `0x1015/0x1016` | Primärer DNS |
| `network.secondaryDns` | `0x1017/0x1018` | Sekundärer DNS |
| `network.controllerId` | `0x101D–0x1024` | Controller-ID als ASCII-Text |
| `network.flags` | `0x1025` | Netzwerk-Flags |
| `network.dhcpEnabled` | `0x1025` | DHCP-Status als Boolean |
| `network.mac` | `0x1026–0x1028` | MAC-Adresse |
| `network.netbiosName` | `0x1029–0x1030` | NetBIOS-Name |

### EEPROM-Netzwerkeinstellungen — alle read-only

Diese Register bleiben wegen möglicher Remote-Lockouts und Firmwareabhängigkeiten bewusst nicht schreibbar.

| Datenpunkt | Register | Bedeutung |
|---|---|---|
| `eeprom.network.httpPort` | `0x151B` | HTTP-Port |
| `eeprom.network.modbusPort` | `0x151C` | Modbus-TCP-Port |
| `eeprom.network.ipBridging` | `0x151D` | IP-Bridging-Bit |
| `eeprom.network.snmpTrapPort` | `0x151E` | SNMP-Trap-Zielport |
| `eeprom.network.ethernetPowerSave` | `0x151F` | Ethernet-Power-Save-Bit |
| `eeprom.network.vlanEnabled` | `0x1520` | VLAN-Enable, Beta-Firmware 8.21 |
| `eeprom.network.vlanParameters` | `0x1521` | VLAN-Rohparameter |

### EEPROM-Ladeeinstellungen

**Opt-in** bedeutet: technisch schreibbar, aber nur nach `enableEepromWrites=true` und mit den unten beschriebenen Schutzprüfungen. **RO** bedeutet read-only, auch bei aktiviertem EEPROM-Opt-in.

| Datenpunkt | Register | Einheit | Zugriff |
|---|---|---:|---|
| `eeprom.charge.absorptionV` | `0xE000` | V | Opt-in |
| `eeprom.charge.floatV` | `0xE001` | V | Opt-in; `0` deaktiviert Float |
| `eeprom.charge.absorptionTime` | `0xE002` | s | Opt-in |
| `eeprom.charge.absorptionExtensionTime` | `0xE003` | s | Opt-in |
| `eeprom.charge.absorptionExtensionV` | `0xE004` | V | Opt-in |
| `eeprom.charge.floatCancelV` | `0xE005` | V | Opt-in |
| `eeprom.charge.floatExitTime` | `0xE006` | s | Opt-in |
| `eeprom.charge.equalizeV` | `0xE007` | V | Opt-in, besonders kritisch; `0` deaktiviert Equalize |
| `eeprom.charge.equalizeCalendarDays` | `0xE008` | d | Opt-in, 0–255 |
| `eeprom.charge.equalizeAboveTime` | `0xE009` | s | Opt-in |
| `eeprom.charge.equalizeRegulationTime` | `0xE00A` | s | Opt-in |
| `eeprom.charge.batteryServiceDays` | `0xE00B` | d | Opt-in |
| `eeprom.charge.temperatureCompensation` | `0xE00D` | V/°C | Opt-in; positive Magnitude, Controller wirkt negativ |
| `eeprom.charge.hvdV` | `0xE00E` | V | RO; Schutzabschaltung nicht remote verändern |
| `eeprom.charge.hvrV` | `0xE00F` | V | RO |
| `eeprom.charge.regulationLimitV` | `0xE010` | V | RO |
| `eeprom.charge.temperatureMax` | `0xE011` | °C | RO |
| `eeprom.charge.temperatureMin` | `0xE012` | °C | RO |
| `eeprom.charge.ledGreenToGreenYellowV` | `0xE015` | V | RO |
| `eeprom.charge.ledGreenYellowToYellowV` | `0xE016` | V | RO |
| `eeprom.charge.ledYellowToYellowRedV` | `0xE017` | V | RO |
| `eeprom.charge.ledYellowRedToRedV` | `0xE018` | V | RO |
| `eeprom.charge.modbusId` | `0xE019` | – | RO; Lockout-Risiko |
| `eeprom.charge.meterbusId` | `0xE01A` | – | RO |
| `eeprom.charge.currentLimitA` | `0xE01D` | A | RO; modell-/batterieabhängig |
| `eeprom.charge.arrayFixedV` | `0xE020` | V | RO; persistentes MPPT-Tracking-Risiko |
| `eeprom.charge.arrayFixedPct` | `0xE021` | % | RO |

### EEPROM-Historie und Geräteinfo — alle read-only

Diese Register enthalten persistierte Snapshots und sind keine sekundengenauen Live-Werte. Die Historie verwendet hier ausdrücklich **LO-Wort zuerst**, anders als die widersprüchliche RAM-Hourmeter-Dokumentation.

| Datenpunkt | Register | Einheit | Bedeutung |
|---|---|---:|---|
| `eeprom.history.hourmeter` | `0xE080/0xE081` | h | Persistierter Betriebsstundenzähler |
| `eeprom.history.ahResettable` | `0xE082/0xE083` | Ah | Persistente resettabele Ah |
| `eeprom.history.ahTotal` | `0xE084/0xE085` | Ah | Persistente Gesamt-Ah |
| `eeprom.history.kwhResettable` | `0xE086` | kWh | Persistente resettabele kWh |
| `eeprom.history.kwhTotal` | `0xE087` | kWh | Persistente Gesamt-kWh |
| `eeprom.history.batteryVmin` | `0xE088` | V | Persistiertes Batterie-Minimum |
| `eeprom.history.batteryVmax` | `0xE089` | V | Persistiertes Batterie-Maximum |
| `eeprom.history.arrayVmax` | `0xE08A` | V | Persistiertes Array-Maximum |
| `eeprom.history.daysSinceEqualize` | `0xE08B` | d | Tage seit Equalization |
| `eeprom.history.daysSinceBatteryService` | `0xE08C` | d | Tage seit Batterieservice |
| `eeprom.info.serial` | `0xE0C0–0xE0C3` | – | Seriennummer, Low-Byte zuerst gemäß Beispiel |
| `eeprom.info.model` | `0xE0CC` | – | TS-MPPT-45 oder TS-MPPT-60 |
| `eeprom.info.hardwareVersion` | `0xE0CD` | – | Hardware `Major.Minor` |

## Steuerung und Sicherheit

> **Warnung:** Control-Datenpunkte verändern den Laderegler. Werte nur mit korrekter Anlagenkonfiguration und nach Prüfung der Morningstar-Dokumentation schreiben. Tests mit `Reset` oder Regelungs-Overrides gehören nicht in eine unbeaufsichtigte CI oder einen produktiven Ablauf.

Nach Installation oder Upgrade sind sämtliche Schreibfunktionen zunächst deaktiviert. `enableControlWrites=true` aktiviert RAM-/Coil-Kommandos; `enableEepromWrites=true` aktiviert separat die EEPROM-Allowlist. Neben den Objekt-Metadaten gibt es zusätzliche Runtime-Guards.

Nur Benutzerkommandos mit **`ack=false`** werden geschrieben. Vom Adapter oder anderen Systemen quittierte Updates mit `ack=true` lösen keinen Modbus-Schreibzugriff aus. Erfolgreiche Kommandos werden mit `ack=true` bestätigt; bei einem Fehler erfolgt keine Erfolgsquittierung.

| Datenpunkt | Modbus | Funktion |
|---|---|---|
| `control.IbattRefSlave` | Holding Register `0x0058` | Batteriestrom-Override in A |
| `control.VbattRefSlave` | Holding Register `0x0059` | Batteriespannungs-Override in V |
| `control.VarrayFixed` | Holding Register `0x005A` | Fester Array-Spannungszielwert in V |
| `control.VarrayFixedPct` | Holding Register `0x005B` | Array-Ziel in Prozent von Voc, 0–100 % |
| `control.ClearFaults` | Coil `0x0014` | `true` löscht Controller-Faults |
| `control.ClearAlarm` | Coil `0x0015` | `true` löscht Controller-Alarme |
| `control.Reset` | Coil `0x00FF` | Morningstar-Reset-Control; Verbindung und Ladung können unterbrochen werden |

### Slave-Control: 60-Sekunden-Bedingung

Ein positiver, nicht nuller Wert an `IbattRefSlave` oder `VbattRefSlave` aktiviert Slave-Control. Morningstar verlangt, dass das Register **mindestens alle 60 Sekunden erneut geschrieben** wird. Andernfalls meldet der Controller `Slave Control Timeout` (Fault-Bit 11).

Dieser Adapter führt **keinen automatischen Keepalive** aus. Das aufrufende Skript bzw. Regelsystem muss den Sollwert daher deutlich häufiger als alle 60 Sekunden erneut mit `ack=false` schreiben. Ein **negativer Wert** deaktiviert Slave-Control. Schutzfunktionen und interne Limits des Controllers können den tatsächlichen Strom trotzdem reduzieren.

### Feste Array-Spannung

Ein nicht nuller Wert an `VarrayFixed` oder `VarrayFixedPct` deaktiviert das normale MPPT-Tracking. `VarrayFixed` hat Vorrang vor dem Prozentziel. Diese Register besitzen keine Slave-Keepalive-Bedingung. Zum Zurückkehren zum normalen MPPT-Betrieb die Ziele gemäß Morningstar-Dokumentation auf `0` setzen.

### EEPROM-Ladeeinstellungen schreiben

> **Hohes Risiko:** Falsche Absorption-, Float- oder Equalize-Werte können Batterien und angeschlossene Lasten beschädigen. Jeder EEPROM-Write setzt laut Morningstar einen `EEPROM changed`-Fault, der erst durch einen Controller-Reset gelöscht wird. Morningstar verifiziert Writes nicht selbst.

1. Standardmäßig ist `enableEepromWrites=false`; die Datenpunkte sind nicht schreibbar und ein zusätzlicher Runtime-Guard blockiert direkte State-Writes.
2. Vor einer Änderung alle aktuellen Werte lesen und dokumentieren bzw. sichern. Batteriehersteller-Vorgaben und das tatsächliche Batteriesystem sind maßgeblich; der Adapter erzwingt keine universellen Chemiegrenzen.
3. Nur die in der Tabelle mit **Opt-in** markierten Register sind allowlistbasiert schreibbar. HVD/HVR, Schutzlimits, Stromlimit, Netzwerk-/ID- und persistente MPPT-Einstellungen bleiben read-only.
4. Vor dem Schreiben liest der Adapter das Zielregister per **FC04** erneut. Hat sich der Rohwert seit der letzten Anzeige verändert, wird abgelehnt und eine erneute Prüfung verlangt.
5. Es wird **genau ein** FC06-Write gesendet. Danach liest der Adapter das Register per **FC04** in einer neuen Verbindung zurück und vergleicht das Rohwort. Der quittierte State verwendet den decodierten Readback-Wert.
6. Bei unklarem Write-/Readback-Ergebnis gibt es kein automatisches Retry. Sobald ein FC06 möglicherweise gesendet wurde, wird eine Write-Generation erhöht und ein neuer statischer Refresh erzwungen. Dadurch kann auch kein parallel gelesener, gemischter Snapshot als aktuell akzeptiert werden. Erst den IST-Wert erneut lesen und prüfen, ob das Kommando bereits ausgeführt wurde.
7. Der Adapter führt **kein** automatisches Clear Faults und **keinen** automatischen Controller-Reset aus. Nach einem EEPROM-Write wird der erforderliche Reset ausdrücklich im Log gemeldet; ein Reset ist separat manuell zu prüfen und auszulösen.

Ändern sich `V_PU` oder `I_PU`, werden statische Werte sofort auf `null` invalidiert, ihre alten Rohwerte verworfen und EEPROM-Writes bis zu einem erfolgreichen Neu-Decode blockiert. Bereits in der FIFO wartende RAM-/EEPROM-Kommandos tragen ihre Scale-Signatur und werden bei Abweichung **vor jedem Hardware-Write** verworfen. Auch ein rein roher Fresh-Read-Vergleich kann somit keine semantisch veraltete Skalierung übersehen.

Die Button-Datenpunkte werden nach erfolgreichem `true`-Kommando automatisch wieder auf `false` mit `ack=true` gesetzt. Ein Schreiben von `false` verursacht keinen Coil-Zugriff.

Nicht als normale Adapterfunktionen freigeschaltet sind destruktive Clear-/Reset-Coils für Gesamt- und Tageszähler, Force EEPROM Update, Factory-/Phasentest, Test Notifications und Reset Communications Server. Dafür wären separate Risiko- und Hardwareprüfungen erforderlich.

## Verbindung und Diagnose

- `info.connection=true`: Der letzte RAM-Modbus-Poll war erfolgreich.
- `info.connection=false`: Konfiguration oder RAM-Kommunikation ist fehlerhaft bzw. es gab noch keinen erfolgreichen Poll.
- Fehler beim optionalen statischen EEPROM-/Netzwerk-Read oder Coil-Status werden separat protokolliert und ändern nicht den nachweislich erfolgreichen RAM-Status. Auch ioBroker-State-DB-Fehler werden getrennt von der Geräteverbindung geloggt.
- Der TriStar schließt die TCP-Verbindung nach einer Modbus-Antwort. Der Adapter baut daher für serialisierte Lese-/Schreiboperationen neue Verbindungen auf.
- Socket- und Request-Fehler werden mit Fehlermeldung/Stack protokolliert. Zuletzt bekannte Messwerte bleiben erhalten; ihre Aktualität ist an `info.connection` zu prüfen.
- Auf Loglevel **debug** schreibt der Adapter die zuletzt empfangenen Rohregister. Diese Werte sind bei Ausreißern zusammen mit Zeitpunkt, betroffenem Datenpunkt und `installedWP` hilfreich.

## Migration von Version 0.0.2

Der frühere Datenpunkt `today.batt.Imax` war kein vom Protokoll dokumentierter Maximalstrom. Er las das falsche Register mit Stromskalierung. Er wird entfernt und durch `today.solar.Vmax` (maximale tägliche Array-Spannung) ersetzt. Der Template-Datenpunkt `testVariable` wird ebenfalls entfernt.

Nach dem Upgrade sind RAM-/Coil- und EEPROM-Schreibzugriffe standardmäßig deaktiviert. Bestehende Automationen müssen nach Sicherheitsprüfung ausdrücklich über `enableControlWrites` bzw. `enableEepromWrites` wieder aktiviert werden.

`state.dip` wird von einem 8-Bit- auf das dokumentierte 16-Bit-Textformat erweitert. Dadurch können auch gesetzte obere Bits nicht mehr den gesamten RAM-Poll abbrechen (#13).

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
- (joerg) Rohregister-Diagnose und separate Median-3-Datenpunkte für isolierte Solarspitzen ergänzt; Rohwerte bleiben unverändert (#2).
- (joerg) Sichere ACK-basierte Kommandoverarbeitung, serialisierte Modbus-Zugriffe sowie Peer-Close-/Unload-Regressionen behoben (#4, #5).
- (joerg) Admin, Konfigurationsvalidierung und Template-Reste bereinigt (#6).
- (joerg) Aktuelle Test-/CI-Basis und echte Regressionstests (#7).
- (joerg) Vollständige Benutzer-/Datenpunkt-Dokumentation und zusätzliche RAM-Werte (#8, #9).
- (joerg) Active-TCP-, EEPROM-Historie-, Ladeeinstellungs- und Coil-Status-Coverage ergänzt (#12).
- (joerg) Allowlistbasierte EEPROM-Ladeschreibzugriffe mit Opt-in, Fresh-Read, Readback und ohne Auto-Reset (#11).
- (joerg) Sämtliche RAM-/Coil-/EEPROM-Schreibzugriffe standardmäßig deaktiviert und durch getrennte Opt-ins plus Runtime-Guards geschützt (#4, #11).
- (joerg) DIP-Bitfeld vollständig auf 16 Bit korrigiert; exhaustive Konvertierungs- und deterministische Fuzz-Tests ergänzt (#13).
- (joerg) EEPROM-Reads/Fresh-Read/Readback auf FC04 korrigiert und Runtime-Kompatibilität mit Node.js 18 / js-controller 7.0 erhalten (#14, #15).
- (joerg) Poll-/ACK-Writes pro Datenpunkt serialisiert und Skalierungswechsel invalidieren EEPROM-Werte bis zum Neu-Decode (#16, #17).
- (joerg) Statische Refreshs blockieren RAM-Publishing nicht mehr; Unload während Initialisierung und Hintergrund-Reads ist sauber (#5).

### 0.0.2 (2022-01-15)
- (joerg) initial release

## License

MIT License — siehe [LICENSE](LICENSE).
