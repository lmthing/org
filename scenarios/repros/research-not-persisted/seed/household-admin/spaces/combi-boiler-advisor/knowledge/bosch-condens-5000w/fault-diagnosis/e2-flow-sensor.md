# E2 — CH Flow Temperature Sensor Faulty

The E2 code indicates that the central heating flow temperature sensor (an NTC thermistor) is returning an open-circuit or short-circuit reading to the Heatronic module. Without a valid flow temperature signal, the boiler cannot regulate its burner output safely.

**From the service manual:**
- Check the temperature sensor and its connecting lead for breaks or short circuits.
- Replace the sensor if it is out of spec. The expected resistance values (tolerance ±10%) are: 20 °C → ~14.8 kΩ, 30 °C → ~9.8 kΩ, 40 °C → ~6.7 kΩ, 60 °C → ~3.2 kΩ, 80 °C → ~1.7 kΩ.
- The flow NTC is item 10 on the ZWB 37-2 wiring diagram, located on the primary heat exchanger flow pipe.

This fault prevents the boiler from firing for central heating. Domestic hot water operation may also be affected because the flow sensor is used across both modes on the ZWB combi.