# Blue Marble Forecast

A modern, unofficial remake of the Wii Forecast Channel (2006–2013): a spinning
NASA globe with local and world forecasts, live radar, animated rain, UV index,
laundry check and pollen counts. Not affiliated with or endorsed by Nintendo.

**Live:** https://bluemarbleforecast.com

Plain HTML, CSS and JavaScript (ES modules) with no build step. It installs as a
home-screen app, works with game controllers, and is translated into English,
Spanish and Simplified Chinese.

## Data sources

All free and public, mostly from government science agencies:

| What | Source |
|---|---|
| Forecasts | NOAA GFS / HRRR models (via Open-Meteo), National Weather Service alerts |
| Globe imagery | NASA Blue Marble, Black Marble and GPM IMERG (NASA GIBS) |
| High resolution radar | Environment and Climate Change Canada (North America), DWD (Germany), EUMETNET OPERA (Europe) |
| 12-hour forecast rain | NOAA HRRR via the Iowa Environmental Mesonet (U.S.), DWD ICON-EU (Europe), NOAA GFS (elsewhere) |
| Pollen | Copernicus Atmosphere Monitoring Service (Europe) |
| Cities | Natural Earth populated places |

The in-app About panel (Settings) has the full credits.

## Layout

```
index.html, styles.css    the page
js/                       app.js (screens), globe.js (three.js Earth), frames.js (animation),
                          data.js + forecast-rain.js + opera.js (data), i18n.js, audio.js, ...
strings/                  en.json, es.json, zh-cn.json (every UI string)
data/places.json          map cities, built by tools/build-places.mjs from Natural Earth
tools/opera-relay/        the Cloudflare Worker that relays OPERA radar files (see below)
sw.js, manifest.webmanifest, icons/   home-screen app
```

## Run locally

Any static file server works. On Windows, `.claude/static-server.ps1` serves the
site at http://127.0.0.1:5510/ and includes a stand-in for the OPERA relay.

## OPERA relay

EUMETNET OPERA's European radar files are public but can't be read by browsers
directly (no CORS). `tools/opera-relay/worker.js` is a tiny read-only Cloudflare
Worker that forwards just those files:

```
cd tools/opera-relay
npx wrangler login
npx wrangler deploy
```

Then set `RELAY_URL` in `js/opera.js` to the Worker's URL (ending in `/`).

## Deploying

GitHub Pages serves the `main` branch at the domain in `CNAME`.
