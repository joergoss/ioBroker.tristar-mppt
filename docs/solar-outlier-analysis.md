# Analyse der Solar-Ausreißer (#2)

## Internetrecherche und theoretische Ursachenanalyse

### Externe Quelle mit gleichem Symptom

Im Video [Morningstar TS-MPPT-60 technical review](https://youtube.com/watch?v=kwrtFo_3Hwc) von FFcossag beschreibt der Betreiber eines eigenen TS-MPPT-60 ausdrücklich, dass der Morningstar-Datenlogger gelegentlich einen „ridiculous spike“ zumindest in der **Input Power** aufzeichnet. Solche Artefakte könnten mehrfach innerhalb weniger Stunden auftreten und den Graphen unbrauchbar machen.

Das ist kein offizieller Morningstar-Bugreport, aber ein wichtiger unabhängiger Beleg, dass ähnliche Spitzen auch ohne diesen ioBroker-Adapter und mit Morningstar-eigener Datenaufzeichnung auftreten.

Die [offizielle TriStar-MPPT-Firmwarehistorie](https://morningstarcorp.com/firmware/tristar-mppt-firmware) dokumentiert außerdem reale Logging-/Kommunikationsfehler, unter anderem Ethernet-/EEPROM-Probleme, Watchdog-/Reset-Fixes und WebView-/Logdatenkorrekturen. Sie bestätigt nicht ausdrücklich diesen konkreten Spike-Mechanismus.

### Mathematische Prüfung des alten Adaptercodes

Mit den realen Skalen V_PU=180 und I_PU=80:

```text
P_scale = 180 × 80 × 2^-17 = 0,10986328125 W/count
I_scale = 80 × 2^-15       = 0,00244140625 A/count
```

Die historischen Werte lassen sich direkt rekonstruieren:

```text
raw 25213 × P_scale = 2769,56 W → gerundet 2770 W
raw 26362 × I_scale = 64,360 A  → gerundet 64,36 A
```

Beide Rohwerte liegen unter `0x8000`. Die damals fälschlich angewandte Signed-Konvertierung der Power-Register ändert bei genau diesen Werten nichts. Sie konnte andere negative Fehlwerte erzeugen, ist aber nicht die Ursache dieser positiven Spitzen.

Auch die 155,6 % sind nur die arithmetisch korrekte Folge von `2770 W / 1780 Wp × 100`; sie erklären nicht den zugrunde liegenden Leistungswert.

### Bewertung möglicher Ursachen

**Sehr unwahrscheinlich: normale Spannungs-/Strom-/Leistungsskalierung im Adapter.**

- Registerindizes und Skalen entsprechen der Spezifikation und wurden am realen Gerät verifiziert.
- Die historischen Spitzen erfordern bereits hohe Rohworte.
- Normale Messungen und die reale Abschlussvalidierung sind physikalisch konsistent.
- Eine fehlerhafte Skala im selben Frame müsste auch andere abhängige Werte verändern; die Batterieleistung blieb dagegen niedrig und plausibel.

**Unwahrscheinlich: jsmodbus-Decodierung.**

- Der Vergleich jsmodbus 4.0.6 → 4.0.10 zeigt keine Änderung der Register-/Wertdecodierung, sondern vor allem Fehlerdetails und Verbindungsabbruchbehandlung.
- Neue Sockets und serialisierte Reads schließen veraltete Client-Antworten weitgehend aus.
- Zufällige TCP-/Parsingfehler würden nicht gezielt und reproduzierbar nur Solar-Eingangswerte betreffen.

**Nicht die Ursache: alter Prozent-, Tages- oder State-Code.**

- Division durch null betrifft nur den Prozent-State.
- Das falsche alte `today.batt.Imax`-Mapping betrifft weder `solar.I` noch `solar.InPower`.
- ACK-/State-Probleme können Werte wiederholen oder veralten lassen, aber keine neuen physikalischen Rohmaxima erzeugen.

**Plausibelste Richtung: Controller-/Firmware-/ADC-/Shadow-Logging-Artefakt.**

- Morningstar bezeichnet Array-Strom und abgeleitete Eingangsleistung selbst als potenziell deutlich fehlerbehaftet.
- Die Register heißen `adc_ia_f_shadow` und `power_in_shadow`.
- Die Spitzen sind isoliert, betreffen Solarstrom/-leistung, während die Batterieausgabe niedrig bleibt.
- MPPT-Sweeps, ADC-Offset-/Synchronisations- oder Shadow-Update-Artefakte sind technisch denkbare Mechanismen; ohne Originalrohdaten ist keiner davon bewiesen.
- Die unabhängige Beobachtung gleicher Input-Power-Spitzen mit Morningstar-Logging stützt diese Richtung deutlich.

**Eine echte physikalische 2770-W-Transient bei nur etwa 7 W Batterieausgabe ist angesichts der kurzen Dauer und Anlagenverhältnisse deutlich unwahrscheinlicher.**

### Fazit

Ein einfacher Fehler in der eigenen Skalierung oder Registerzuordnung war für die konkreten 2770-W-/64,36-A-Spitzen sehr wahrscheinlich **nicht** verantwortlich. Der Adapter hat vom Gerät gelieferte oder bereits vor der Decodierung entstandene Ausreißer korrekt umgerechnet und sichtbar gemacht. Die wahrscheinlichste Ursache liegt im Controller-/Firmware-/Mess- bzw. Shadow-Logging-Bereich; der genaue Mechanismus bleibt ohne Originalrohdaten offen.

Die aktuelle Lösung mit unveränderten Rohwerten, separaten Median-3-Datenpunkten und Rohregister-Diagnose ist daher fachlich angemessen: Sie unterdrückt isolierte Anzeigeartefakte, ohne echte physikalische Ereignisse durch willkürliches Clipping zu verstecken.