require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const querystring = require('querystring');

const app = express();
const port = 3000;

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirect_uri = process.env.REDIRECT_URI;

let access_token = null;
let refresh_token = null;
const TOKEN_FILE = 'tokens.json';

// 🔹 Load tokens from file
if (fs.existsSync(TOKEN_FILE)) {
    const savedTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    access_token = savedTokens.access_token;
    refresh_token = savedTokens.refresh_token;
    console.log("✅ Loaded saved tokens from file");
}

// 🔹 Save tokens to file
function saveTokens() {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token, refresh_token }, null, 2));
}

// 🔹 Refresh token function
async function refreshAccessToken() {
    if (!refresh_token) {
        console.log("⚠️ No refresh token — log in again.");
        return { success: false, message: "No refresh token" };
    }

    try {
        const refreshResponse = await axios.post(
            'https://accounts.spotify.com/api/token',
            querystring.stringify({
                grant_type: 'refresh_token',
                refresh_token: refresh_token
            }),
            {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        access_token = refreshResponse.data.access_token;
        saveTokens();
        console.log("🔄 Access token refreshed");
        return { success: true, message: "Access token refreshed" };
    } catch (err) {
        console.error("❌ Refresh failed", err.response?.data || err.message);
        return { success: false, message: "Refresh failed" };
    }
}

// 🔹 Auto refresh every 50 minutes
setInterval(refreshAccessToken, 50 * 60 * 1000);

// 🔹 Instant refresh at startup
(async () => {
    if (refresh_token) {
        console.log("🚀 Trying instant refresh...");
        await refreshAccessToken();
    }
})();

// 🔹 Manual refresh route
app.get('/refresh', async (req, res) => {
    const result = await refreshAccessToken();
    res.json(result);
});

// 🔹 Login route
app.get('/login', (req, res) => {
    const scope = 'user-read-private user-read-email playlist-read-private';
    const auth_url = 'https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: client_id,
            scope: scope,
            redirect_uri: redirect_uri
        });
    res.redirect(auth_url);
});

// 🔹 Callback route
app.get('/callback', async (req, res) => {
    const code = req.query.code || null;

    try {
        const tokenResponse = await axios.post(
            'https://accounts.spotify.com/api/token',
            querystring.stringify({
                code: code,
                redirect_uri: redirect_uri,
                grant_type: 'authorization_code'
            }),
            {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        access_token = tokenResponse.data.access_token;
        refresh_token = tokenResponse.data.refresh_token;

        saveTokens();
        console.log("✅ Tokens saved");

        res.redirect('/playlists');
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: error.message });
    }
});

// 🔹 Playlists route
app.get('/playlists', async (req, res) => {
    if (!access_token) {
        return res.redirect('/login');
    }

    try {
        const playlistsResponse = await axios.get('https://api.spotify.com/v1/me/playlists', {
            headers: { 'Authorization': 'Bearer ' + access_token }
        });

        const playlists = playlistsResponse.data.items || [];

        let html = `
            <html>
            <head>
                <title>My Spotify Playlists</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; background: #121212; color: white; }
                    h1 { margin-top: 20px; }
                    .playlist { display: inline-block; margin: 15px; width: 200px; }
                    img { width: 200px; height: 200px; border-radius: 8px; }
                    a { text-decoration: none; color: #1DB954; font-weight: bold; display: block; margin-top: 8px; }
                </style>
            </head>
            <body>
                <h1>🎵 My Spotify Playlists</h1>
        `;

        playlists.forEach(p => {
            const imageUrl = p.images?.[0]?.url || 'https://via.placeholder.com/200?text=No+Image';
            const playlistUrl = p.external_urls?.spotify || '#';
            const playlistName = p.name || 'Untitled Playlist';

            html += `
                <div class="playlist">
                    <img src="${imageUrl}" alt="Cover" />
                    <a href="${playlistUrl}" target="_blank">${playlistName}</a>
                </div>
            `;
        });

        html += `</body></html>`;
        res.send(html);

    } catch (error) {
        if (error.response?.status === 401 && refresh_token) {
            console.log("🔄 Token expired — refreshing...");
            await refreshAccessToken();
            return res.redirect('/playlists');
        }
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});
