// TDView.js (extended)
import React, { useState, useEffect } from "react";
import { gapi } from "gapi-script";
import { CLIENT_ID, API_KEY, SHEET_ID, SCOPES } from "./config";

export default function TDView() {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [pairings, setPairings] = useState([]);

  useEffect(() => {
    gapi.load("client:auth2", () => {
      gapi.client
        .init({
          apiKey: API_KEY,
          clientId: CLIENT_ID,
          discoveryDocs: [
            "https://sheets.googleapis.com/$discovery/rest?version=v4",
          ],
          scope: SCOPES,
        })
        .then(() => {
          const auth = gapi.auth2.getAuthInstance();
          setIsSignedIn(auth.isSignedIn.get());
          auth.isSignedIn.listen(setIsSignedIn);
        });
    });
  }, []);

  const handleLogin = () => gapi.auth2.getAuthInstance().signIn();
  const handleLogout = () => gapi.auth2.getAuthInstance().signOut();

  const loadPairings = async (round = 1) => {
    const res = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Pairings_Round${round}`,
    });
    setPairings(res.result.values || []);
  };

  const updateResult = async (round, rowIndex, result) => {
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Pairings_Round${round}!D${rowIndex + 1}`, // Result column
      valueInputOption: "RAW",
      resource: {
        values: [[result]],
      },
    });
    alert("Result updated!");
    loadPairings(round);
  };

  if (!isSignedIn) {
    return (
      <div>
        <h2>TD Login</h2>
        <button onClick={handleLogin}>Login with Google</button>
      </div>
    );
  }

  return (
    <div>
      <h2>TD Dashboard</h2>
      <button onClick={handleLogout}>Logout</button>
      <button onClick={() => loadPairings(1)}>Load Round 1 Pairings</button>

      {pairings.length > 0 && (
        <table border="1" cellPadding="4">
          <thead>
            <tr>
              {pairings[0].map((col, i) => (
                <th key={i}>{col}</th>
              ))}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pairings.slice(1).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
                <td>
                  <button onClick={() => updateResult(1, i + 2, "1-0")}>
                    White wins
                  </button>
                  <button onClick={() => updateResult(1, i + 2, "0-1")}>
                    Black wins
                  </button>
                  <button onClick={() => updateResult(1, i + 2, "½-½")}>
                    Draw
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
