# Hardware-Abschlussvalidierung 2026-11-17

## Ziel und Sicherheit

Validierung des gemergten Treiberstands an einem realen Morningstar TS-MPPT-60, einschließlich RAM, Coils, Active TCP, EEPROM-Regelwerte, Historie und einem ausdrücklich freigegebenen No-op-EEPROM-Schreibtest.

- Vor jedem externen Direktzugriff wurde `tristar-mppt.0` gestoppt und der gestoppte Zustand bestätigt.
- Es lief immer nur ein Testclient mit höchstens einem ausstehenden Modbus-Request.
- Nach jedem Test wurde die ioBroker-Instanz automatisch wieder gestartet.
- Vollständige Rohdaten liegen ausschließlich im privaten Backup, nicht im öffentlichen Repository.

## Read-only-Zugriffsprofil

- RAM höchstens alle 5 Sekunden.
- Coils höchstens alle 30 Sekunden.
- Statische Blöcke nur am Anfang und Ende, mindestens 500 ms zwischen den Requests.
- Ausschließlich FC01/FC03/FC04; keine Writes in dieser Phase.
- Abbruch bei wiederholten Fehlern, langsamen Antworten oder neuen Diagnosemeldungen.

## Durchgeführter Umfang

- 60 RAM-Samples über ca. 5 Minuten.
- Vollständige Active-TCP-/EEPROM-Snapshots am Anfang und Ende.
- 11 Coil-Abfragen.
- Alle dokumentierten, nicht reservierten Registerbereiche einschließlich Regelwerte und Historie.

## Kommunikationsergebnis

| Kennzahl | Ergebnis |
|---|---:|
| Modbus-/Timeout-Fehler | 0 |
| Statische Blockfehler | 0 |
| Minimale Antwortzeit | 9 ms |
| Median | 23 ms |
| Durchschnitt | 26 ms |
| Maximale Antwortzeit | 73 ms |

Es gab keine Anzeichen einer Überlastung des Controllers oder Netzwerkprozessors.

## Fachliche Ergebnisse

- Skalierung durchgehend stabil: `V_PU=180`, `I_PU=80`.
- Start-/Ende-Rohregister vollständig identisch.
- Keine `NaN`/`Infinity`-Werte.
- Keine rückwärts laufenden Zähler.
- Aktive Faults/Alarme durchgehend leer.
- Equalize- und Charge-Disconnect-Coils durchgehend false.
- DIP-Bitfeld stabil und korrekt decodiert.
- RAM-/EEPROM-Hourmeter identisch; die implementierte RAM-Wortreihenfolge wurde an diesem Gerät bestätigt.
- Netzwerk, Identität, Modell und Hardwareversion stimmen mit dem realen Gerät überein.
- ADC-Versorgungen, Sweep-Werte, Tageswerte und Historie sind plausibel.

### Leistungskonsistenz

- Batterie-Ausgangsleistung vs. Batteriespannung × Batteriestrom: maximal ca. **0,7 %** Abweichung.
- Solar-Eingangsleistung vs. Array-Spannung × Array-Strom: maximal ca. **4,7 %** Abweichung und damit innerhalb der von Morningstar dokumentierten Messunsicherheit.

### Median-3-Filter

- Erste zwei Samples erwartungsgemäß `null`.
- Ab dem dritten aufeinanderfolgenden Snapshot numerische Werte.
- Keine Ausreißer im Testzeitraum und keine inkonsistenten Prozentwerte.

## Ausgelesene Regelwerte

| Einstellung | Wert |
|---|---:|
| Absorption | 14,00 V |
| Float | 13,50 V |
| Absorptionszeit | 9000 s |
| Absorptionsverlängerung | 10800 s |
| Absorptionsverlängerung-Schwelle | 12,50 V |
| Float-Cancel | 12,30 V |
| Float-Exit-Zeit | 3600 s |
| Equalize-Spannung/-Kalender/-Zeiten | 0 / deaktiviert |
| Temperaturkompensation, positive Magnitude | 0,03021 V/°C |
| HVD | 14,50 V |
| HVR | 13,80 V |
| Temperaturkompensationsgrenzen | −30 bis 80 °C |
| Persistente Array-Fixwerte | 0 / deaktiviert |
| Battery-Service-Intervall | 0 |

Zusätzlich bestätigt: Absorption > Float, HVD > HVR, Temperaturgrenzen und LED-Schwellen sind konsistent geordnet. Der vom Gerät gemeldete Stromlimitwert wird unverändert und spezifikationsgemäß skaliert ausgegeben; der Adapter verändert keine modellabhängigen Schutzgrenzen.

## Freigegebener No-op-EEPROM-Schreibtest

Ziel war ausschließlich `Et_batt_service` / `batteryServiceDays`, PDU `0xE00B`, ein Wert ohne Einfluss auf die Laderegelung.

- Vorher gültige RAM-Skalierung gelesen und leere aktive Diagnose bestätigt.
- FC04-Fresh-Read und Vergleich mit dem erwarteten Rohwert 0.
- Genau **ein FC06** mit dem unveränderten Wert 0.
- FC04-Readback korrekt, Wert weiterhin 0.
- Kein Retry, kein weiterer Write, kein Clear Faults und kein Reset.
- Ladestufe blieb unverändert; danach weiterhin keine Faults/Alarme.
- Der Adapter setzte sicherheitsgemäß `staticDataStale=true`.
- Das reale Gerät setzte beim No-op keinen EEPROM-changed-Fault; ein Reset war daher nicht erforderlich.

Ein tatsächlicher 0→1→0-Test wurde **nicht** durchgeführt und benötigt eine neue Freigabe.

## Normalbetrieb

Nach jedem Direkttest wurde die ioBroker-Instanz automatisch gestartet. Die Schreib-Opt-ins blieben deaktiviert. Anschließend wurden 20 Normalbetrieb-Samples über rund 17 Minuten ausschließlich über ioBroker-States erfasst, ohne parallelen Direktzugriff:

- `info.connection` durchgehend true,
- Ladestufe durchgehend MPPT,
- aktive Faults durchgehend leer,
- `batteryServiceDays` durchgehend unverändert 0,
- Batteriespannung plausibel im Bereich 13,34–13,45 V,
- Solarstrom plausibel im Bereich 0,67–0,89 A.

Damit wurde auch der Normalbetrieb nach dem No-op-Schreibtest bestätigt.

## Datenablage

Private Rohdaten und Summaries:

```text
/home/pi/backups/tristar-mppt-20261116-021858/hardware-validation-20261117
```

## Ergebnis

Die vollständige reale Registerabfrage, erweiterte Regelwertabfrage, FC03/FC04-Trennung, Leistungsberechnung, Zähler, Coils und der geschützte No-op-Write funktionieren am realen Gerät. Aus diesem Test ergaben sich keine neuen Treiberfehler.

Langfristige Morgen-/Abend-Ausreißer bleiben über die unveränderten Rohwerte, separaten Median-3-States und Rohregister-Logs beobachtbar. Issue #2 wurde mit dieser operativen Resolution abgeschlossen, ohne eine nicht bewiesene Hardwareursache zu behaupten; ein neuer tatsächlicher Rohdatensatz kann jederzeit erneut analysiert werden. Die Internetrecherche und mathematische Rekonstruktion stehen in [Analyse der Solar-Ausreißer](solar-outlier-analysis.md).
