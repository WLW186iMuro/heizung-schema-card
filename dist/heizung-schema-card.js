/* Heizung Schema Card – Wärmepumpen-Schema im Stil des Bosch-HMI-800-Dashboards
 * Seitenspalten nutzen die Farben des HA-Themes (--ha-card-background).
 * Nutzung: type: custom:heizung-schema-card
 * Optional: entities: { flow: sensor.xyz, ... }, center_background: "#181818", side_width: 190
 * Primärkreis: Vorlauf = TC1, Rücklauf = TC0; Spreizung = TC3 − TC0 (so rechnet die WP, Soll = "Temp.diff. TC3/TC0 Heizen").
 * Heizkreis: Vorlauf = boiler_curflowtemp, Rücklauf = boiler_rettemp.
 * Im Warmwasserbetrieb ist der Heizkreis hydraulisch abgekoppelt: Heizkreis-Spreizung und -Durchfluss werden dann nicht angezeigt.
 *
 * Ersatzwerte: Fehlen die Entitäten heat_power, cop oder pc0flow_calc, berechnet die Karte sie selbst aus den
 * EMS-ESP-Standardentitäten. Ohne Entität bleiben icing/icing_status ("Aus") und pv_status (Feld ausgeblendet).
 */
const HSC_DEFAULT_ENTITIES = {
  outdoor: "sensor.boiler_outdoortemp",
  outdoor_damped: "sensor.thermostat_dampedoutdoortemp",
  pressure: "sensor.boiler_syspress",
  heat_power: "sensor.fbh_heizleistung",
  el_power: "sensor.boiler_hpcurrpower",
  flow: "sensor.boiler_curflowtemp",
  ret: "sensor.boiler_rettemp",
  flow_rate: "sensor.boiler_pc1flow",
  target_flow: "sensor.thermostat_hc1_targetflowtemp",
  dhw_actual: "sensor.boiler_dhw_curtemp",
  dhw_set: "sensor.boiler_dhw_settemp",
  valve3: "binary_sensor.boiler_dhw_3wayvalve",
  dhw_charging: "binary_sensor.boiler_dhw_charging",
  heating_active: "binary_sensor.boiler_heatingactive",
  comp_on: "binary_sensor.boiler_hpcompon",
  comp_speed: "sensor.boiler_hpcompspd",
  activity: "sensor.boiler_hpactivity",
  cop: "sensor.warmepumpe_arbeitszahl_gesamt",
  pv_status: "sensor.pv_uberschuss_warmepumpe_status",
  fan: "sensor.boiler_fanspd",
  tr1: "sensor.boiler_hptr1",
  ph1: "sensor.boiler_hpph1",
  tr3: "sensor.boiler_hptr3",
  tr6: "sensor.boiler_hptr6",
  hp4way: "binary_sensor.boiler_hp4way",
  pc0flow: "sensor.boiler_pc0flow",
  pc0flow_calc: "sensor.wp_primarkreis_durchfluss_berechnet",
  tc3: "sensor.boiler_hptc3",
  tc1: "sensor.boiler_hptc1",
  tc0: "sensor.boiler_hptc0",
  tl2: "sensor.boiler_hptl2",
  ta4: "sensor.boiler_hpta4",
  pan_heater: "binary_sensor.boiler_hpea0",
  aux_heater: "sensor.boiler_auxheaterstatus",
  aux_level: "sensor.boiler_auxheaterlevel",
  aux_step1: "switch.boiler_elheatstep1",
  aux_step2: "switch.boiler_elheatstep2",
  aux_step3: "switch.boiler_elheatstep3",
  aux_energy: "sensor.boiler_metereheat",
  icing: "sensor.wp_vereisung_verdampfer",
  icing_status: "sensor.wp_vereisung_status",
  // nur für die Ersatzberechnung (Arbeitszahl, Primärkreis-Durchfluss)
  nrg_total: "sensor.boiler_nrgtotal",
  meter_total: "sensor.boiler_metertotal",
  nrg_heat: "sensor.boiler_nrgheat",
  meter_heat: "sensor.boiler_meterheat",
  circ_spd: "sensor.boiler_hpcircspd",
};

const HSC_PV_TEXT = {
  off: "Aus", manual: "Manuell", pv_active: "PV-Betrieb", deficit_pending: "Defizit…",
  waiting: "Wartet", surplus_pending: "Überschuss…", locked: "Gesperrt", daily_limit: "Tageslimit",
  outside_window: "Außer Zeit", night: "Nacht", battery_low: "Akku leer", sensor_error: "Sensorfehler",
  price_cheap: "Strom günstig", price_high: "Strom teuer",
};

class HeizungSchemaCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._ent = Object.assign({}, HSC_DEFAULT_ENTITIES, this._config.entities || {});
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._sig = null;
  }

  set hass(hass) {
    this._hass = hass;
    const sig = Object.values(this._ent).map((id) => {
      const s = hass.states[id];
      return s ? s.state : "x";
    }).join("|") + (this._defrost() ? "|" + Math.floor(Date.now() / 60000) : "");
    if (sig === this._sig) return;
    this._sig = sig;
    this._render();
  }

  getCardSize() { return 9; }
  getGridOptions() { return { columns: "full", min_columns: 12 }; }
  static getStubConfig() { return {}; }

  _s(key) { return this._hass.states[this._ent[key]]; }
  _num(key) {
    const s = this._s(key);
    const v = s ? parseFloat(s.state) : NaN;
    if (!isNaN(v)) return v;
    const d = this._derived(key);
    return d ? d.v : null;
  }
  /* Selbst berechneter Ersatz, wenn der optionale Helfer fehlt oder keinen Wert hat. Liefert {v, unit} oder null. */
  _derived(key) {
    const g = (k) => {
      const st = this._s(k);
      const n = st ? parseFloat(st.state) : NaN;
      return isNaN(n) ? null : n;
    };
    if (key === "heat_power") {
      const a = this._s("activity");
      if (!a || !/heiz|heating/i.test(a.state)) return { v: 0, unit: "kW" };
      const q = g("flow_rate"), vl = g("flow"), rl = g("ret");
      return q === null || vl === null || rl === null ? null : { v: (q * 1.163 * (vl - rl)) / 1000, unit: "kW" };
    }
    if (key === "cop") {
      const w = g("nrg_total"), e = g("meter_total"), wh = g("nrg_heat"), eh = g("meter_heat");
      if (w === null || e === null || !(e > 0) || !(w > 0)) return null;
      if ((eh || 0) > 0 && !(wh > 0)) return null;
      return { v: w / e, unit: "" };
    }
    if (key === "pc0flow_calc") {
      // Kennlinie der Primärkreispumpe aus der Pumpendrehzahl (an einer WLW186i-7 mit TP70 ermittelt)
      const sp = g("circ_spd");
      if (sp === null) return null;
      if (sp <= 0) return { v: 0, unit: "L/h" };
      const f = this._isOn("valve3")
        ? Math.max(0, -78 + 17.5 * sp, -583 + 23.9 * sp)
        : sp < 50 ? 610 + 6.2 * sp : Math.max(126 + 15.9 * sp, -486 + 23.9 * sp);
      return { v: Math.round(f), unit: "L/h" };
    }
    return null;
  }
  _isOn(key) {
    const s = this._s(key);
    if (!s) return false;
    return ["on", "ein", "an", "heating", "true"].includes(String(s.state).toLowerCase());
  }
  _defrost() {
    const a = this._s("activity");
    return !!((a && /abt|defrost/i.test(a.state)) || this._isOn("hp4way"));
  }
  _txt(key) {
    const s = this._s(key);
    return s && !["unavailable", "unknown"].includes(s.state) ? String(s.state) : "–";
  }
  _fmt(key, dec = 1, unit) {
    const s = this._s(key);
    if (!s || ["unavailable", "unknown"].includes(s.state)) {
      const d = this._derived(key);
      if (!d) return "–";
      const du = unit !== undefined ? unit : d.unit;
      return d.v.toLocaleString("de-DE", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + (du ? " " + du : "");
    }
    const v = parseFloat(s.state);
    if (isNaN(v)) return s.state;
    const u = unit !== undefined ? unit : (s.attributes.unit_of_measurement || "");
    return v.toLocaleString("de-DE", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + (u ? " " + u : "");
  }

  _row(icon, label, value, key, color) {
    return `<div class="row" data-entity="${this._ent[key] || ""}">
      <ha-icon icon="${icon}" style="${color ? `color:${color}` : ""}"></ha-icon>
      <div class="txt"><div class="lbl">${label}</div><div class="val">${value}</div></div>
    </div>`;
  }

  _render() {
    const compOn = this._isOn("comp_on");
    const heating = this._isOn("heating_active");
    const valve3 = this._isOn("valve3");
    const activity = this._txt("activity");
    const defrost = this._defrost();
    const dsrc = /abt|defrost/i.test(activity) ? this._s("activity") : this._s("hp4way");
    const dmin = defrost && dsrc && dsrc.last_changed
      ? Math.max(0, Math.floor((Date.now() - new Date(dsrc.last_changed).getTime()) / 60000)) : null;
    const valve4 = this._isOn("hp4way");
    const dhwMode = /warm|dhw|brauch/i.test(activity);
    const dhwActive = valve3 || this._isOn("dhw_charging") || dhwMode;
    // E-Heizer (Heizstab 9 kW in der Inneneinheit, 3 Stufen à 3 kW): Stufen, Level (100 % = 9 kW), Zweck aus Zusatzheizerstatus
    const aux = this._txt("aux_heater");
    const auxLvl = this._num("aux_level");
    const auxSteps = ["aux_step1", "aux_step2", "aux_step3"].filter((k) => this._isOn(k)).map((k) => k.slice(-1));
    const auxOn = auxSteps.length > 0 || (auxLvl !== null && auxLvl > 0) || /heiz|warm/i.test(aux);
    const auxKw = auxLvl !== null && auxLvl > 0 ? Math.round(auxLvl * 0.09) : auxSteps.length * 3;
    const auxPurpose = /heiz/i.test(aux) ? "Heizen" : (/warm/i.test(aux) ? "Warmwasser" : "");
    const auxTxt = auxOn ? [auxPurpose, auxKw + " kW", auxSteps.length ? "Stufe " + auxSteps.join("+") : ""].filter(Boolean).join(" · ") : "Aus";
    const auxColor = auxOn ? "#ff5722" : "#9e9e9e";
    const heatPath = (compOn || auxOn) && !defrost && !dhwActive && (heating || /heiz/i.test(activity) || /heiz/i.test(aux));
    const tankPath = (compOn || auxOn) && !defrost && dhwActive;
    const spd = this._num("comp_speed") || 0;
    const spinDur = compOn && !defrost ? Math.max(0.6, 4 - spd / 30) : 0;
    const centerBg = this._config.center_background || "var(--secondary-background-color, #181818)";
    const sideW = parseInt(this._config.side_width, 10) || 190;
    const panOn = this._isOn("pan_heater");
    const fl = this._num("flow"), rt = this._num("ret");
    const spreadRaw = fl !== null && rt !== null ? (fl - rt).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " K" : "–";
    // Im WW-Betrieb ist der Heizkreis abgekoppelt (Rücklauf bleibt bei Fußbodenkreis-Temperatur) – Spreizung/Durchfluss nicht aussagekräftig
    const wwHint = "– (WW-Betrieb)";
    const spread = dhwActive ? wwHint : spreadRaw;
    const flowHK = dhwActive ? wwHint : this._fmt("flow_rate", 0, "L/h");
    const flowHKshort = dhwActive ? "–" : this._fmt("flow_rate", 0, "L/h");
    const spreadShort = dhwActive ? "–" : spreadRaw;
    // Primärkreis-Spreizung: TC3 (Kondensatorausgang) − TC0 (Rücklauf) – so rechnet die WP (Soll: Temp.diff. TC3/TC0 Heizen)
    const t3 = this._num("tc3"), t0 = this._num("tc0");
    const spreadPrim = t3 !== null && t0 !== null ? (t3 - t0).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " K" : "–";
    const pc0 = this._num("pc0flow");
    const pcc = this._num("pc0flow_calc");
    const flowPrim = pc0 !== null && pc0 > 0 ? this._fmt("pc0flow", 0, "L/h")
      : (pcc !== null ? "≈ " + this._fmt("pc0flow_calc", 0, "L/h") : "k. A.");
    const pvRaw = this._txt("pv_status");
    const pvTxt = HSC_PV_TEXT[pvRaw] || pvRaw;
    const actColor = defrost ? "#ffa726" : (compOn ? "#4cc38a" : "var(--secondary-text-color)");

    // Vereisung Verdampfer (Schätzung): Wert in %, "Abtauen", "Anlauf" (Einschwingphase) oder "Aus"
    const icing = this._num("icing");
    const icingPct = icing !== null ? Math.max(0, Math.min(100, Math.round(icing))) : null;
    const icingStart = !defrost && icingPct === null && /anlauf/i.test(this._txt("icing_status"));
    const icingTxt = defrost ? "Abtauen" : (icingPct !== null ? icingPct + " %" : (icingStart ? "Anlauf" : "Aus"));
    const icingShort = defrost ? "❄" : (icingPct !== null ? icingPct + " %" : (icingStart ? "Anlauf" : "Aus"));
    const icingColor = defrost ? "#ffa726"
      : (icingPct === null ? (icingStart ? "var(--secondary-text-color, #9e9e9e)" : "var(--disabled-text-color, #5f5f5f)")
      : (icingPct >= 80 ? "#ef5350" : (icingPct >= 50 ? "#fdd835" : "#4cc38a")));
    const icingH = !defrost && icingPct !== null ? Math.round(icingPct * 0.9) : 0;

    const e = (key) => this._ent[key];
    // Fließrichtung: Kältemittelkreis außen→innen (VL) und innen→außen (RL)
    const cls = (on, color) => `pipe ${color} ${on ? "flow" : "off"}`;

    const tbl = [
      ["Verdichterstatus", compOn ? "Ein" : "Aus", "comp_on"],
      ["Kompressordrehzahl", this._fmt("comp_speed", 0, "%"), "comp_speed"],
      ["Kältemittel (flüssig) (TR3)", this._fmt("tr3", 1), "tr3"],
      ["Kältemittelvorlauf TC1", this._fmt("tc1", 1), "tc1"],
      ["Kompressortemperatur (TR1)", this._fmt("tr1", 1), "tr1"],
      ["Hochdrucktemperatur (PH1)", this._fmt("ph1", 1), "ph1"],
    ].map((r, i) => {
      const y = 395 + i * 36;
      return `<text x="45" y="${y + 20}" class="t-lbl">${r[0]}</text>
        <g class="click" data-entity="${e(r[2])}">
        <rect x="370" y="${y}" width="150" height="28" rx="6" class="valbox"/>
        <text x="445" y="${y + 19}" text-anchor="middle" class="t-val">${r[1]}</text></g>`;
    }).join("");

    const radiators = [0, 1, 2, 3].map((i) =>
      `<rect x="${868 + i * 33}" y="45" width="20" height="110" rx="5" fill="url(#radgrad)" class="${heatPath ? "" : "dim"}"/>`
    ).join("");

    const left = [
      this._row("mdi:home-thermometer-outline", "Außentemperatur", this._fmt("outdoor"), "outdoor", "#42a5f5"),
      this._row("mdi:thermometer-low", "Außentemp. gedämpft", this._fmt("outdoor_damped"), "outdoor_damped", "#42a5f5"),
      this._row("mdi:gauge", "Anlagendruck", this._fmt("pressure", 2), "pressure", "#42a5f5"),
      this._row("mdi:radiator", "Heizleistung", this._fmt("heat_power", 2), "heat_power", "#ffa726"),
      this._row("mdi:flash", "Stromaufnahme", this._fmt("el_power", 0), "el_power", "#fdd835"),
      this._row("mdi:chart-line", "Arbeitszahl gesamt", this._fmt("cop", 2, ""), "cop", "#4cc38a"),
      this._row("mdi:thermometer-chevron-up", "Heizkreis Vorlauf", this._fmt("flow"), "flow", "#ef5350"),
      this._row("mdi:thermometer-chevron-down", "Heizkreis Rücklauf", this._fmt("ret"), "ret", "#42a5f5"),
      this._row("mdi:arrow-expand-vertical", "Spreizung Heizkreis (VL – RL)", spread, "flow", dhwActive ? "#9e9e9e" : "#ffa726"),
      this._row("mdi:arrow-expand-vertical", "Spreizung Primärkreis (TC3–TC0)", spreadPrim, "tc3", "#ffa726"),
      this._row("mdi:water-sync", "Durchfluss Kältemittel", flowPrim, "pc0flow_calc", "#26c6da"),
      this._row("mdi:water-sync", "Durchfluss Heizwasser", flowHK, "flow_rate", dhwActive ? "#9e9e9e" : "#26c6da"),
      this._row("mdi:thermometer-lines", "HK1 Soll-Vorlauf", this._fmt("target_flow"), "target_flow", "#ef5350"),
      this._row("mdi:water-boiler", "Warmwasser Ist", this._fmt("dhw_actual"), "dhw_actual", "#42a5f5"),
      this._row("mdi:water-thermometer-outline", "Warmwasser Soll", this._fmt("dhw_set"), "dhw_set", "#42a5f5"),
      this._row("mdi:valve", "3-Wege-Ventil", valve3 ? "WW-Betrieb" : "Heizbetrieb", "valve3", "#9e9e9e"),
      this._row("mdi:heating-coil", "E-Heizer (Heizstab)", auxTxt, "aux_heater", auxColor),
      this._row("mdi:lightning-bolt", "E-Heizer Strom gesamt", this._fmt("aux_energy", 1), "aux_energy", "#ff5722"),
    ].join("");

    const right = [
      this._row("mdi:cog", "TR1 Verdichter", this._fmt("tr1"), "tr1", "#ef5350"),
      this._row("mdi:speedometer", "Verdichterdrehzahl", this._fmt("comp_speed", 0, "%"), "comp_speed", "#4cc38a"),
      this._row("mdi:fan", "Lüfter", this._fmt("fan", 0, "%"), "fan", "#9e9e9e"),
      this._row("mdi:gauge-full", "PH1 Hochdruck", this._fmt("ph1"), "ph1", "#ef5350"),
      this._row("mdi:snowflake-thermometer", "TR3 Kältemittel flüssig", this._fmt("tr3"), "tr3", "#26c6da"),
      this._row("mdi:thermometer-high", "TR6 Kompressorausgang", this._fmt("tr6"), "tr6", "#ef5350"),
      this._row("mdi:heat-wave", "TC3 Kondensator", this._fmt("tc3"), "tc3", "#ef5350"),
      this._row("mdi:thermometer-chevron-up", "TC1 Kältemittelvorlauf", this._fmt("tc1"), "tc1", "#ef5350"),
      this._row("mdi:thermometer-chevron-down", "TC0 Kältemittelrücklauf", this._fmt("tc0"), "tc0", "#42a5f5"),
      this._row("mdi:weather-windy", "TL2 Lufteintritt", this._fmt("tl2"), "tl2", "#42a5f5"),
      this._row("mdi:snowflake", "TA4 Kondensatwanne", this._fmt("ta4"), "ta4", "#26c6da"),
      this._row("mdi:snowflake-alert", "Vereisung Verdampfer", icingTxt, "icing", icingColor),
      this._row("mdi:swap-horizontal", "4-Wege-Ventil", valve4 ? "Abtauen" : "Normal", "hp4way", valve4 ? "#ffa726" : "#9e9e9e"),
      this._row("mdi:water-pump", "Wannenheizung", panOn ? "Ein" : "Aus", "pan_heater", "#9e9e9e"),
    ].join("");

    this.shadowRoot.innerHTML = `
    <style>
      :host { display:block; }
      .wrap { display:grid; grid-template-columns: ${sideW}px minmax(0,1fr) ${sideW}px; gap:10px; align-items:stretch; }
      .side { background: var(--ha-card-background, var(--card-background-color, #1e1e1e));
              border: var(--ha-card-border-width,1px) solid var(--ha-card-border-color, var(--divider-color));
              border-radius: var(--ha-card-border-radius, 16px); padding:8px 6px 10px; box-sizing:border-box; min-width:0; }
      .side.outer { order:-1; } .side.inner { order:1; }
      .side h3 { margin:6px 6px 8px; font-size:12px; letter-spacing:.08em; font-weight:600;
                 color: var(--primary-text-color); text-transform:uppercase; }
      .row { display:flex; align-items:center; gap:8px; padding:6px 6px; border-radius:10px; cursor:pointer;
             border:1px solid transparent; min-width:0; }
      .row:hover { background: var(--secondary-background-color); }
      .row ha-icon { --mdc-icon-size:20px; flex:none; }
      .txt { min-width:0; flex:1; }
      .lbl { font-size:11.5px; color: var(--secondary-text-color); line-height:1.2; overflow-wrap:anywhere; }
      .val { font-size:13.5px; font-weight:500; color: var(--primary-text-color); line-height:1.3; white-space:nowrap; }
      .row.hl { border-color:${compOn ? "#4cc38a" : "var(--divider-color)"}; background: var(--secondary-background-color); margin-bottom:6px; }
      .center { background:${centerBg}; border: var(--ha-card-border-width,1px) solid var(--ha-card-border-color, var(--divider-color));
                border-radius: var(--ha-card-border-radius, 16px); overflow:hidden; min-width:0; }
      svg { display:block; width:100%; height:auto; font-size:16px; }
      .t-title { font-size:20px; font-weight:600; fill: var(--primary-text-color); }
      .t-sub { fill: var(--secondary-text-color); }
      .t-lbl { fill: var(--secondary-text-color); }
      .t-val { font-size:15px; font-weight:700; fill: var(--primary-text-color); }
      .t-vl { font-size:15px; font-weight:700; fill:#ef5350; }
      .t-rl { font-size:15px; font-weight:700; fill:#42a5f5; }
      .halo { paint-order: stroke; stroke: ${centerBg}; stroke-width:5px; stroke-linejoin:round; }
      .box { fill: var(--ha-card-background, var(--card-background-color, #1e1e1e)); stroke: var(--divider-color); stroke-width:1.5; }
      .valbox { fill: var(--secondary-background-color); stroke: var(--divider-color); stroke-width:1; }
      .pipe { fill:none; stroke-width:4; stroke-linecap:round; stroke-linejoin:round; }
      .red { stroke:#ef5350; } .blue { stroke:#42a5f5; }
      .pipe.off { opacity:.22; }
      .flow { stroke-dasharray:10 8; animation: hsc-dash 1.1s linear infinite; }
      @keyframes hsc-dash { to { stroke-dashoffset:-18; } }
      .dim { opacity:.3; }
      .glow { filter: drop-shadow(0 0 4px #ff5722); animation: hsc-glow 1.6s ease-in-out infinite; }
      @keyframes hsc-glow { 50% { opacity:.55; } }
      .click { cursor:pointer; }
      .spin { transform-box:fill-box; transform-origin:center; ${spinDur ? `animation: hsc-spin ${spinDur}s linear infinite;` : ""} }
      @keyframes hsc-spin { to { transform: rotate(360deg); } }
      .status-on { fill:#4cc38a; } .status-off { fill: var(--disabled-text-color, #5f5f5f); }
      @media (max-width: 1000px) {
        .wrap { grid-template-columns: 1fr 1fr; }
        .center { grid-column: 1 / -1; order:-1; }
      }
      @media (max-width: 600px) { .wrap { grid-template-columns: 1fr; } }
    </style>
    <div class="wrap">
      <div class="side inner"><h3>Inneneinheit</h3>${left}</div>

      <div class="center">
      <svg viewBox="0 0 1030 640" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="radgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ef5350"/><stop offset="1" stop-color="#42a5f5"/>
          </linearGradient>
        </defs>

        <!-- Kopfzeile: Außentemperatur + Statuschips -->
        <text x="120" y="30" text-anchor="middle" class="t-sub" font-size="14">Außentemperatur</text>
        <g class="click" data-entity="${e("outdoor")}">
          <rect x="40" y="38" width="160" height="34" rx="8" class="valbox"/>
          <text x="120" y="61" text-anchor="middle" class="t-val">${this._fmt("outdoor")}</text>
        </g>
        <text x="400" y="30" text-anchor="middle" class="t-sub" font-size="14">Betrieb</text>
        <g class="click" data-entity="${e("activity")}">
          <rect x="310" y="38" width="180" height="34" rx="8" class="valbox" style="stroke:${actColor}"/>
          <text x="400" y="61" text-anchor="middle" class="t-val" style="fill:${actColor}">${defrost ? "Abtauen" : activity}</text>
        </g>
        <text x="640" y="30" text-anchor="middle" class="t-sub" font-size="14">Arbeitszahl</text>
        <g class="click" data-entity="${e("cop")}">
          <rect x="580" y="38" width="120" height="34" rx="8" class="valbox"/>
          <text x="640" y="61" text-anchor="middle" class="t-val">${this._fmt("cop", 2, "")}</text>
        </g>
        ${this._s("pv_status") ? `<text x="880" y="30" text-anchor="middle" class="t-sub" font-size="14">PV-Überschuss</text>
        <g class="click" data-entity="${e("pv_status")}">
          <rect x="790" y="38" width="180" height="34" rx="8" class="valbox"/>
          <text x="880" y="61" text-anchor="middle" class="t-val">${pvTxt}</text>
        </g>` : ""}

        <!-- Außeneinheit -->
        <rect x="20" y="95" width="215" height="190" rx="14" class="box" ${defrost ? 'style="stroke:#ffa726;stroke-width:3"' : ""}/>
        <text x="38" y="125" class="t-title">Außeneinheit</text>
        ${defrost ? `<text x="217" y="126" text-anchor="end" font-size="20">❄️</text>` : ""}
        <g class="click" data-entity="${e("comp_on")}">
          <rect x="45" y="140" width="130" height="110" rx="8" fill="#24282d" stroke="var(--divider-color)"/>
          <circle cx="110" cy="195" r="46" fill="none" stroke="#5f6670" stroke-width="3"/>
          <g class="spin">
            <circle cx="110" cy="195" r="40" fill="none" stroke="#3a3f46" stroke-width="2"/>
            <path d="M110 195 L110 158 M110 195 L142 213 M110 195 L78 213" stroke="#8a929c" stroke-width="9" stroke-linecap="round"/>
          </g>
          <circle cx="110" cy="195" r="7" fill="#5f6670"/>
        </g>
        <!-- Vereisung Verdampfer: Füllbalken 0–100 %, Marken bei 50 % und 80 % -->
        <g class="click" data-entity="${e("icing")}">
          <text x="201" y="141" text-anchor="middle" class="t-sub" font-size="11">Eis</text>
          <rect x="192" y="147" width="18" height="90" rx="5" class="valbox" ${defrost ? 'style="stroke:#ffa726"' : ""}/>
          ${icingH > 0 ? `<rect x="192" y="${237 - icingH}" width="18" height="${icingH}" rx="5" fill="${icingColor}" fill-opacity=".85"/>` : ""}
          <line x1="188" y1="192" x2="214" y2="192" stroke="#fdd835" stroke-width="1.5" opacity=".7"/>
          <line x1="188" y1="165" x2="214" y2="165" stroke="#ef5350" stroke-width="1.5" opacity=".7"/>
          <text x="201" y="254" text-anchor="middle" font-size="12" style="fill:${icingColor};font-weight:700">${icingShort}</text>
        </g>
        <text x="127" y="275" text-anchor="middle" class="t-sub" font-size="13">Verdichter / Verdampfer</text>

        <!-- Kältemittelkreis: Vorlauf (heiß) außen → innen, Rücklauf innen → außen -->
        <path d="${defrost ? "M405 160 H235" : "M235 160 H405"}" class="${cls(compOn || defrost, "red")}"/>
        <path d="${defrost ? "M235 235 H405" : "M405 235 H235"}" class="${cls(compOn || defrost, "blue")}"/>
        <text x="320" y="187" text-anchor="middle" class="t-sub" font-size="12.5">Kältemittelkreis${defrost ? " (Umkehr)" : ""}</text>
        <g class="click" data-entity="${e("tc3")}"><text x="320" y="206" text-anchor="middle" class="t-sub" font-size="13">Spreizung TC3−TC0 <tspan style="fill:var(--primary-text-color);font-weight:700">${spreadPrim}</tspan></text></g>
        <g class="click" data-entity="${e("pc0flow_calc")}"><text x="320" y="226" text-anchor="middle" class="t-sub" font-size="14">Durchfluss <tspan style="fill:var(--primary-text-color);font-weight:700">${flowPrim}</tspan></text></g>
        <!-- Seite Außeneinheit: TC3 (Kondensatorausgang) und TC0 – Grundlage der Spreizung -->
        <text x="245" y="130" class="t-sub halo" font-size="12">TC3</text>
        <g class="click" data-entity="${e("tc3")}"><text x="245" y="150" class="t-vl halo">${this._fmt("tc3")}</text></g>
        <g class="click" data-entity="${e("tc0")}"><text x="245" y="258" class="t-rl halo">${this._fmt("tc0")}</text></g>
        <text x="245" y="276" class="t-sub halo" font-size="12">TC0</text>
        <!-- Seite Inneneinheit: TC1 (Vorlauf in der Inneneinheit) und TC0 -->
        <text x="397" y="130" text-anchor="end" class="t-sub halo" font-size="12">TC1</text>
        <g class="click" data-entity="${e("tc1")}"><text x="397" y="150" text-anchor="end" class="t-vl halo">${this._fmt("tc1")}</text></g>
        <g class="click" data-entity="${e("tc0")}"><text x="397" y="258" text-anchor="end" class="t-rl halo">${this._fmt("tc0")}</text></g>
        <text x="397" y="276" text-anchor="end" class="t-sub halo" font-size="12">TC0</text>

        <!-- Inneneinheit -->
        <rect x="405" y="95" width="155" height="190" rx="14" class="box" ${auxOn ? 'style="stroke:#ff5722;stroke-width:3"' : ""}/>
        <text x="482" y="125" text-anchor="middle" class="t-title">Inneneinheit</text>
        <text x="482" y="147" text-anchor="middle" class="t-sub" font-size="14">WLW 186i</text>
        <rect x="448" y="160" width="68" height="105" rx="4" fill="#15181b" stroke="#6b727b"/>
        <rect x="454" y="168" width="56" height="72" rx="2" fill="#2a2f35"/>
        <rect x="458" y="248" width="30" height="8" rx="2" fill="#9aa0a6" opacity=".6"/>
        <!-- E-Heizer / Heizstab: glüht bei Betrieb, Leistung in kW -->
        <g class="click" data-entity="${e("aux_heater")}"><title>E-Heizer (Heizstab 9 kW)</title>
          <path d="M462 204 h6 l4 -10 l8 20 l8 -20 l8 20 l4 -10 h6" fill="none" stroke="${auxOn ? "#ff5722" : "#6b727b"}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" ${auxOn ? 'class="glow"' : ""}/>
          <text x="482" y="232" text-anchor="middle" font-size="12" style="fill:${auxOn ? "#ff5722" : "var(--secondary-text-color)"};font-weight:700">${auxOn ? "⚡ " + auxKw + " kW" : "E-Heizer"}</text>
        </g>

        <!-- Heizwasserkreis: Vorlauf Inneneinheit → Heizkreis, Rücklauf zurück -->
        <path d="M560 160 H705" class="${cls(heatPath || tankPath, "red")}"/>
        <path d="M705 160 H850" class="${cls(heatPath, "red")}"/>
        <path d="M850 235 H640" class="${cls(heatPath, "blue")}"/>
        <path d="M640 235 H560" class="${cls(heatPath || tankPath, "blue")}"/>
        <g class="click" data-entity="${e("flow")}"><text x="575" y="148" class="t-vl halo">${this._fmt("flow")}</text></g>
        <g class="click" data-entity="${e("ret")}"><text x="575" y="262" class="t-rl halo">${this._fmt("ret")}</text></g>
        <g class="click" data-entity="${e("flow")}"><text x="788" y="206" text-anchor="middle" class="t-sub halo" font-size="13">VL − RL <tspan style="fill:var(--primary-text-color);font-weight:700">${spreadShort}</tspan></text></g>
        <g class="click" data-entity="${e("flow_rate")}"><text x="788" y="224" text-anchor="middle" class="t-sub halo" font-size="13">Durchfluss <tspan style="fill:var(--primary-text-color);font-weight:700">${flowHKshort}</tspan></text></g>

        <g class="click" data-entity="${e("valve3")}">
          <circle cx="705" cy="160" r="22" fill="var(--secondary-background-color)" stroke="${dhwActive ? "#ef5350" : "#9e9e9e"}" stroke-width="3"/>
          <path d="M695 152 H715 M705 152 V172" stroke="${dhwActive ? "#ef5350" : "#9e9e9e"}" stroke-width="3" fill="none" stroke-linecap="round"/>
        </g>
        <text x="705" y="122" text-anchor="middle" class="t-sub" font-size="14">3-WV</text>

        <rect x="850" y="95" width="165" height="190" rx="14" class="box"/>
        <text x="868" y="125" class="t-title">Heizkreis 1</text>
        ${heatPath ? `<text x="985" y="125" font-size="18">🔥</text>` : ""}
        <g transform="translate(0,95)">${radiators}</g>

        <!-- Speicherladung: Vorlauf vom 3-WV in den Speicher, Rücklauf aus dem Speicher -->
        <path d="M705 182 V455 H735" class="${cls(tankPath, "red")}"/>
        <path d="M735 535 H640 V235" class="${cls(tankPath, "blue")}"/>

        <text x="800" y="338" text-anchor="middle" class="t-sub" font-size="17">Warmwasserspeicher</text>
        <g class="click" data-entity="${e("dhw_actual")}">
          <path d="M700 360 Q800 335 900 360 V590 Q800 618 700 590 Z" class="box"/>
          <path d="M700 360 Q800 385 900 360" fill="none" stroke="var(--divider-color)" stroke-width="1.5"/>
          <path d="M735 455 H830 Q850 455 850 475 Q850 495 830 495 H770 Q750 495 750 515 Q750 535 770 535 H735"
                fill="none" stroke="${tankPath ? "#ef5350" : "#6b727b"}" stroke-width="7" stroke-linecap="round"/>
          <path d="M880 440 q-18 22 -18 36 a18 18 0 0 0 36 0 q0 -14 -18 -36z" fill="#3b82f6" opacity=".9"/>
          <text x="800" y="578" text-anchor="middle" style="fill:#ffa726;font-size:16px;font-weight:700">${this._fmt("dhw_actual")}</text>
          <text x="800" y="400" text-anchor="middle" class="t-sub" font-size="13">Soll ${this._fmt("dhw_set", 0)}</text>
        </g>

        <g class="click" data-entity="${e("valve3")}">
          <circle cx="500" cy="325" r="6" class="${valve3 ? "status-on" : "status-off"}"/>
          <text x="512" y="330" class="t-lbl halo" font-size="13">WW-Ventil</text>
        </g>
        <g class="click" data-entity="${e("aux_heater")}">
          <circle cx="918" cy="540" r="6" class="${auxOn ? "status-on" : "status-off"}"/>
          <text x="930" y="545" class="t-lbl" font-size="13">Heizstab</text>
        </g>
        <g class="click" data-entity="${e("pan_heater")}">
          <circle cx="918" cy="575" r="6" class="${panOn ? "status-on" : "status-off"}"/>
          <text x="930" y="580" class="t-lbl" font-size="13">Wanne</text>
        </g>

        ${defrost ? `<g class="click" data-entity="${e("activity")}">
          <rect x="20" y="296" width="465" height="34" rx="9" fill="#ffa726" fill-opacity=".16" stroke="#ffa726" stroke-width="1.5"/>
          <text x="36" y="318" style="fill:#ffa726;font-size:15px;font-weight:700">❄ Abtauprogramm aktiv${dmin !== null ? " · seit " + dmin + " min" : ""}</text>
          ${valve4 ? `<text x="472" y="318" text-anchor="end" style="fill:#ffa726;font-size:12px">4-Wege-Ventil umgeschaltet</text>` : ""}
        </g>` : ""}

        <rect x="20" y="340" width="535" height="285" rx="14" class="box"/>
        <text x="40" y="372" class="t-title">Verdichter &amp; Wärmepumpe</text>
        ${tbl}
      </svg>
      </div>

      <div class="side outer"><h3>Außeneinheit</h3>
        <div class="row hl" data-entity="${e("comp_on")}">
          <ha-icon icon="mdi:cog" style="color:${compOn ? "#f5b83d" : "var(--disabled-text-color)"}"></ha-icon>
          <div class="txt"><div class="lbl">Verdichter</div><div class="val">${compOn ? "Ein" : "Aus"}</div></div>
        </div>
        ${right}
      </div>
    </div>`;

    this.shadowRoot.querySelectorAll("[data-entity]").forEach((el) => {
      const id = el.getAttribute("data-entity");
      if (!id) return;
      el.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("hass-more-info", {
          detail: { entityId: id }, bubbles: true, composed: true,
        }));
      });
    });
  }
}

customElements.define("heizung-schema-card", HeizungSchemaCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "heizung-schema-card",
  name: "Heizung Schema",
  description: "Wärmepumpen-Schema (Buderus WLW186i) mit Seitenspalten im HA-Theme",
  preview: false,
});
