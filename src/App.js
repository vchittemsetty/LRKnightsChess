import React, { useState } from "react";
import TDSectionManager from "./TDSectionManager";
import ParentsView from "./ParentsView";

export default function App() {
  const [view, setView] = useState("parents"); // "td" or "parents"
  const [section, setSection] = useState("Open");

  return (
    <div>
      <h1>LR Knights Chess Tournament</h1>
      <div>
        <button onClick={() => setView("parents")}>Parents View</button>
        <button onClick={() => setView("td")}>TD Dashboard</button>
      </div>

      <div>
        <label>Select Section: </label>
        <select value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="Open">Open</option>
          <option value="U1200">U1200</option>
          <option value="U800">U800</option>
        </select>
      </div>

      {view === "td" ? (
        <TDSectionManager section={section} />
      ) : (
        <ParentsView section={section} />
      )}
    </div>
  );
}
