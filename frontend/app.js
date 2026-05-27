const { useState } = React;

function App() {
  const [text, setText] = useState("They left me for dead.");
  const [character, setCharacter] = useState("Hulk");
  const [preset, setPreset] = useState("villain");
  const [rawUrl, setRawUrl] = useState("");
  const [rawPath, setRawPath] = useState("");
  const [fxUrl, setFxUrl] = useState("");
  const [fxPath, setFxPath] = useState("");
  const [status, setStatus] = useState("Ready");

  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem("levramVoiceHistory");
    return saved ? JSON.parse(saved) : [];
  });

  async function generateVoice() {
    setStatus("Generating raw voice...");
    setFxUrl("");
    setFxPath("");

    const formData = new FormData();
    formData.append("text", text);
    formData.append("character", character);

    const response = await fetch("http://127.0.0.1:8000/generate", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    const fullUrl = "http://127.0.0.1:8000" + data.output_url;

    setRawUrl(fullUrl);
    setRawPath(data.output_url);
    setStatus("Raw voice generated.");
  }

  async function applyFx() {
    if (!rawPath) {
      setStatus("Generate raw voice first.");
      return;
    }

    setStatus("Applying voice FX...");

    const formData = new FormData();
    formData.append("input_path", rawPath);
    formData.append("preset", preset);

    const response = await fetch("http://127.0.0.1:8000/voice-fx", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    const fullUrl = "http://127.0.0.1:8000" + data.output_url;

    setFxUrl(fullUrl);
    setFxPath(data.output_url);
    setStatus("Voice FX applied.");

    setHistory(prev => {
      const updated = [
        {
          character,
          preset,
          text,
          rawPath,
          fxPath: data.output_url,
          fxUrl: fullUrl,
          createdAt: new Date().toLocaleString()
        },
        ...prev
      ];

      localStorage.setItem("levramVoiceHistory", JSON.stringify(updated));
      return updated;
    });
  }

  function clearHistory() {
    localStorage.removeItem("levramVoiceHistory");
    setHistory([]);
    setStatus("History cleared.");
  }

  return React.createElement("div", { className: "app" },
    React.createElement("h1", null, "LEVRAM Voice Lab"),

    React.createElement("textarea", {
      value: text,
      onChange: e => setText(e.target.value)
    }),

    React.createElement("input", {
      value: character,
      onChange: e => setCharacter(e.target.value),
      placeholder: "Character name"
    }),

    React.createElement("button", { onClick: generateVoice }, "Generate Voice"),

    React.createElement("p", { className: "status" }, status),

    rawUrl && React.createElement("h2", null, "Raw Voice"),

    rawUrl && React.createElement("audio", { controls: true, src: rawUrl }),

    rawUrl && React.createElement("p", { className: "file-path" }, rawPath),

    rawUrl && React.createElement("a", { href: rawUrl, download: true }, "Download Raw Voice"),

    rawUrl && React.createElement("div", { className: "fx-section" },
      React.createElement("select", {
        value: preset,
        onChange: e => setPreset(e.target.value)
      },
        React.createElement("option", { value: "villain" }, "Villain"),
        React.createElement("option", { value: "deep" }, "Deep"),
        React.createElement("option", { value: "clean" }, "Clean Boost")
      ),
      React.createElement("button", { onClick: applyFx }, "Apply Voice FX")
    ),

    fxUrl && React.createElement("h2", null, "Processed Voice"),

    fxUrl && React.createElement("audio", { controls: true, src: fxUrl }),

    fxUrl && React.createElement("p", { className: "file-path" }, fxPath),

    fxUrl && React.createElement("a", { href: fxUrl, download: true }, "Download Processed Voice"),

    history.length > 0 && React.createElement("div", { className: "history-header" },
      React.createElement("h2", null, "Generation History"),
      React.createElement("button", { onClick: clearHistory }, "Clear History")
    ),

    history.map((item, index) =>
      React.createElement("div", { className: "history-card", key: index },
        React.createElement("strong", null, item.character + " / " + item.preset),
        React.createElement("p", null, item.text),
        React.createElement("p", { className: "file-path" }, item.createdAt),
        React.createElement("p", { className: "file-path" }, item.fxPath),
        React.createElement("audio", { controls: true, src: item.fxUrl })
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
