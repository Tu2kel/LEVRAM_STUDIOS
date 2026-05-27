const API_BASE = "http://localhost:8000";
const { useState } = React;

function App() {
  const [script, setScript] = useState("They left me for dead.");
  const [character, setCharacter] = useState("Hulk");
  const [preset, setPreset] = useState("villain");
  const [rawPath, setRawPath] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [status, setStatus] = useState("READY");
  const [timeline, setTimeline] = useState([]);

  async function generateVoice() {
    setStatus("GENERATING VOICE");

    const form = new FormData();
    form.append("text", script);
    form.append("character", character);

    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: "POST",
        body: form
      });

      const data = await res.json();
      console.log("VOICE:", data);

      if (!data.output_url) throw new Error("No output_url returned");

      setRawPath(data.output_path);
      setAudioUrl(`${API_BASE}${data.output_url}`);
      setTimeline(prev => [...prev, `VOICE — ${character} — ${script}`]);
      setStatus("VOICE READY");
    } catch (err) {
      console.error(err);
      setStatus("VOICE ERROR");
      alert("Voice generation failed. Check backend.");
    }
  }

  async function generateFX() {
    if (!rawPath) {
      alert("Generate voice first.");
      return;
    }

    setStatus("APPLYING FX");

    const form = new FormData();
    form.append("input_path", rawPath);
    form.append("preset", preset);

    try {
      const res = await fetch(`${API_BASE}/voice-fx`, {
        method: "POST",
        body: form
      });

      const data = await res.json();
      console.log("FX:", data);

      if (!data.output_url) throw new Error("No output_url returned");

      setAudioUrl(`${API_BASE}${data.output_url}`);
      setTimeline(prev => [...prev, `FX — ${preset} — ${character}`]);
      setStatus("FX READY");
    } catch (err) {
      console.error(err);
      setStatus("FX ERROR");
      alert("FX failed. Check backend.");
    }
  }

  function saveShot() {
    const shot = document.querySelector("#shotPrompt")?.value || "";
    setTimeline(prev => [...prev, `SHOT — ${shot.slice(0, 90)}`]);
    setStatus("SHOT SAVED");
  }

  return (
    <div className="app">

      <header className="topbar">
        <div>
          <div className="logo">LEVRAM</div>
          <div className="sublogo">GENERATOR CONTROL ROOM</div>
        </div>
        <div className="status">{status}</div>
      </header>

      <main className="grid">

        <section className="panel voice">
          <h2>VOICE LAB</h2>

          <label>Script / Line</label>
          <textarea
            className="script-input"
            value={script}
            onChange={e => setScript(e.target.value)}
          />

          <label>Character</label>
          <div className="chars">
            {["Hulk", "Wally", "Barry", "Narrator", "Female"].map(name => (
              <button
                key={name}
                className={character === name ? "active" : ""}
                onClick={() => setCharacter(name)}
              >
                {name}
              </button>
            ))}
          </div>

          <label>FX Preset</label>
          <select value={preset} onChange={e => setPreset(e.target.value)}>
            <option value="villain">Villain</option>
            <option value="deep">Deep</option>
            <option value="monster">Monster</option>
            <option value="ghost">Ghost</option>
            <option value="clean">Clean</option>
          </select>

          <div className="btn-row">
            <button className="main-btn" onClick={generateVoice}>GENERATE VOICE</button>
            <button className="main-btn blue" onClick={generateFX}>GENERATE FX</button>
          </div>
        </section>

        <section className="panel shot">
          <h2>SHOT BUILDER</h2>

          <div className="shot-grid">
            <input placeholder="Project" defaultValue="The Runner" />
            <input placeholder="Scene #" defaultValue="SC-001" />
            <select>
              <option>Extreme Close-Up</option>
              <option>Close-Up</option>
              <option>Wide Shot</option>
              <option>Tracking Shot</option>
            </select>
          </div>

          <textarea
            id="shotPrompt"
            defaultValue="Ground-level civilian POV. Rubble. A child alone on a cracked sidewalk. Blue-white speed blur in the sky above. The hero never looked back."
          />

          <button className="main-btn blue" onClick={saveShot}>SAVE SHOT CARD</button>
        </section>

        <section className="preview">
          <h2>PREVIEW / GENERATED OUTPUT</h2>

          {audioUrl ? (
            <audio controls src={audioUrl}></audio>
          ) : (
            <div className="empty">NO OUTPUT YET</div>
          )}
        </section>

        <section className="timeline">
          <h2>SHOT HISTORY / TIMELINE</h2>

          <div className="tracks">
            {timeline.length === 0 ? (
              <div className="empty">NO CLIPS YET</div>
            ) : (
              timeline.map((item, i) => (
                <div className="clip" key={i}>{item}</div>
              ))
            )}
          </div>
        </section>

      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
