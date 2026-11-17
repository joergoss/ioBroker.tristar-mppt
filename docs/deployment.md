# Deployment und Rollback

Dieses Runbook beschreibt den kontrollierten Branch-Deploy auf dem vorhandenen pi4-ioBroker. Für ein reguläres veröffentlichtes Release soll später der normale ioBroker-/npm-Installationsweg verwendet werden.

## Sicherheitsprinzipien

- Vorher Backup von Paket, Instanzobjekt und Paketmetadaten.
- Schreib-Opt-ins während Installation und Erstverifikation deaktiviert lassen.
- Zunächst ausschließlich read-only an realer Hardware prüfen.
- Keine automatischen EEPROM-Writes, Clear Faults oder Controller-Resets.
- Bei Fehlern auf die gesicherte Version zurückrollen.
- Kein gleichzeitiges Host-/Node-/js-controller-Upgrade ohne eigenen Plan.

## Lokaler Build

```bash
npm ci
npm test
npm run check
npm run lint
npm run build
npm pack --json
```

Der Tarball enthält `build/`, Admin-Dateien, README, `docs/`, `io-package.json` und Paketmetadaten, aber keine Tests oder Dev-Dependencies.

## Runtime-Voraussetzungen prüfen

```bash
docker exec iob_iobroker node --version
docker exec iob_iobroker iobroker version
docker exec iob_iobroker node -p "require('/opt/iobroker/node_modules/@iobroker/adapter-core/package.json').version"
docker exec iob_iobroker node -p "require('/opt/iobroker/node_modules/jsmodbus/package.json').version"
```

Der dokumentierte Stand verwendet Node.js 18, js-controller 7.0, adapter-core 3.2.x und jsmodbus 4.x. `adapter-core` 3.4.x ist nicht mit js-controller-common-db 7.0 kompatibel und darf dort nicht erzwungen werden.

## Backup

Auf dem pi4 wurden Paket und Instanzobjekt gesichert:

```bash
backup="/home/pi/backups/tristar-mppt-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
docker exec iob_iobroker iobroker object get system.adapter.tristar-mppt.0 > "$backup/instance.json"
docker cp "iob_iobroker:/opt/iobroker/node_modules/iobroker.tristar-mppt" "$backup/adapter"
docker cp "iob_iobroker:/opt/iobroker/package.json" "$backup/iobroker-package.json"
docker cp "iob_iobroker:/opt/iobroker/package-lock.json" "$backup/iobroker-package-lock.json"
```

Das tatsächliche Deployment-Backup liegt unter `/home/pi/backups/tristar-mppt-20261116-021858`.

## Tarball-Deploy ohne Git/npm im Produktivcontainer

Der ioBroker-Container enthält eine weitere Git-Dependency. Ein Root-`npm install` kann deshalb an nicht vorhandenen Git-/SSH-Programmen oder Netzwerkzugriffen hängen. Solange die bereits installierten Runtime-Dependencies den Tarball-Anforderungen entsprechen, wird nur der Adapter selbst ersetzt:

```bash
scp iobroker.tristar-mppt-0.0.2.tgz pi@pi4:/home/pi/backups/tristar-mppt-20261116-021858/
```

Auf dem pi4:

```bash
docker cp "/home/pi/backups/tristar-mppt-20261116-021858/iobroker.tristar-mppt-0.0.2.tgz" "iob_iobroker:/tmp/iobroker.tristar-mppt-0.0.2.tgz"
docker exec iob_iobroker iobroker stop tristar-mppt.0
docker exec iob_iobroker bash -c 'set -e; target=/opt/iobroker/node_modules/iobroker.tristar-mppt; rm -rf "$target"; mkdir -p "$target"; tar -xzf /tmp/iobroker.tristar-mppt-0.0.2.tgz --strip-components=1 -C "$target"'
docker exec iob_iobroker iobroker upload tristar-mppt
docker exec iob_iobroker iobroker start tristar-mppt.0
```

Dadurch werden keine anderen Adapter oder Root-Git-Dependencies verändert.

## Read-only-Verifikation

```bash
docker exec iob_iobroker iobroker state get tristar-mppt.0.info.connection
docker exec iob_iobroker iobroker state get tristar-mppt.0.solar.InPowerFiltered
docker exec iob_iobroker iobroker state get tristar-mppt.0.eeprom.charge.absorptionV
docker exec iob_iobroker iobroker state get tristar-mppt.0.eeprom.charge.floatV
docker exec iob_iobroker iobroker state get tristar-mppt.0.eeprom.info.model
docker exec iob_iobroker iobroker state get tristar-mppt.0.network.ip
docker exec iob_iobroker iobroker state get tristar-mppt.0.state.faults
docker exec iob_iobroker iobroker state get tristar-mppt.0.state.alarm
```

Zusätzlich Objektdefinitionen prüfen:

```bash
docker exec iob_iobroker iobroker object get tristar-mppt.0.control.Reset
docker exec iob_iobroker iobroker object get tristar-mppt.0.eeprom.charge.absorptionV
```

Erwartet werden `common.write=false`, solange die Opt-ins deaktiviert sind. Filter-Werte benötigen drei erfolgreiche Polls für ihren Warm-up. Statische Werte werden beim Start und anschließend alle fünf Minuten aktualisiert.

## Rollback

Falls der neue Stand nicht korrekt funktioniert:

```bash
backup="/home/pi/backups/tristar-mppt-20261116-021858"
docker exec iob_iobroker iobroker stop tristar-mppt.0
docker exec iob_iobroker rm -rf /opt/iobroker/node_modules/iobroker.tristar-mppt
docker cp "$backup/adapter" "iob_iobroker:/opt/iobroker/node_modules/iobroker.tristar-mppt"
docker exec iob_iobroker iobroker upload tristar-mppt
docker exec iob_iobroker iobroker start tristar-mppt.0
```

Die Instanzkonfiguration wurde beim dokumentierten Deploy nicht verändert; `interval=1`, die bestehende Wp-Leistung und die Geräteverbindung blieben erhalten. Beide neuen Schreib-Opt-ins blieben deaktiviert.

## Nach dem Deploy

- Logs und `info.connection` beobachten.
- Keine aktiven Faults/Alarme durch das Deployment erzeugen.
- InfluxDB-Historisierung für neue States separat konfigurieren; sie entsteht nicht automatisch.
- Keine EEPROM-Writes oder Resets als „Schnelltest“ ausführen.
- Vor einem Release Branch-Stand reviewen, PR mergen und erst danach Version/Changelog/Tag erzeugen.
