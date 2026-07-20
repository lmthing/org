# fault-table-172

Section 17.2 of the manual (6 720 644 143, 2016/04) lists every fault the Heatronic module detects and shows as a two-character code on the display. Key codes include:

- **A7** — DHW temperature sensor faulty (ZWB). Check sensor and lead for breaks/shorts; check coding card.
- **A8** — BUS communication fault. Check BUS device connecting lead and controller.
- **Ad** — Cylinder temperature sensor not detected (recognised as BUS subscriber then reconnected). Check sensor and lead; reset Heatronic to standard settings (service function 8.E).
- **b1** — Code plug not detected. Check coding card is plugged in correctly.
- **b2/b3/b4/b5/b6** — Internal data error. Restore Heatronic to standard settings via service function 8.E.
- **C6** — Fan not running. Check fan lead, connector, and fan; replace as necessary.
- **CC** — Outside temperature sensor not detected. Check sensor and connecting lead; ensure correct terminal connection (A and F).
- **d3** — External temperature limiter faulty/tripped (locked out). Check limiter and lead; check jumper across 8-9 or PR-P0 is present; reset limiter.
- **d5** — External flow temperature sensor defective (flow equaliser). Check sensor and lead; ensure only one sensor is connected; reset Heatronic to standard settings.
- **E2** — CH flow temperature sensor faulty. Check sensor and lead for breaks/shorts.
- **E9** — Heat exchanger temperature limiter or flue gas temperature limiter tripped. Check both limiters and leads; check system operating pressure; check pump and PCB fuse; vent appliance; check heat exchanger on water side; check displacement bodies are fitted (if applicable).
- **EA** — Flame not detected. Check earth lead, gas valve open, gas supply pressure, power supply, electrodes and leads, flue gas system, gas/air ratio, external gas flow limiter (natural gas), air supply/ventilation (open flue), condensate trap discharge pipe, diaphragm in fan inlet, heat exchanger, and gas valve. On IT networks: insert 2 MΩ resistor between PE and N at PCB power supply.
- **F0** — Internal fault. Press reset for 3 seconds; check plug-in contacts and ignition leads; check gas/air ratio; replace PCB if required.
- **F1** — Internal data error. Restore Heatronic to standard settings (service function 8.E).
- **F7** — Flame detected although appliance is switched off. Check electrodes, flue gas system, and PCB for moisture.
- **FA** — Flame detected after gas switched off. Check gas valve, clean condensate trap, check electrodes and lead, check flue gas system.
- **Fd** — Reset pressed in error. Press reset again; check cable harness to high-limit safety cut-out and gas valve for earth connection.

Each code in the manual carries a specific diagnostic and remedy sequence; always follow the full table before replacing the PCB.