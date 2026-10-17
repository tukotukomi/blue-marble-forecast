# Blue Marble Forecast for iPhone and iPad

The iOS app is the website in a thin native shell
([Capacitor](https://capacitorjs.com)). The site's own code runs inside it, so
almost every change to the site is a change to the app too.

| | |
|---|---|
| App name | Blue Marble Forecast |
| Bundle ID | `com.bluemarbleforecast.app` |
| Minimum iOS | 15 (iPhone and iPad) |
| Privacy policy | https://bluemarbleforecast.com/privacy/ |

## What's here

- `build-www.mjs`: copies the site into `www/` for the app. The copy bundles
  three.js (no CDN, so the globe starts offline) and the native location
  plugin. The site itself is untouched.
- `make-icons.mjs`: draws the app icon and launch screen from `icons/icon.svg`.
- `ios/`: the Xcode project. Its `App/App/public` folder is filled in by
  `npm run sync`, so it isn't in git.
- `capacitor.config.json`: app ID, name and colours.

What's different inside the app (all in the site's code, see `js/native.js`):
location comes from iOS's own permission prompt, there's no service worker,
and the "Install the app" setting is hidden.

## On the Mac

These steps don't need administrator access, so they work on a rented cloud
Mac (MacinCloud's managed plans included) as well as your own.

### First time (about 30 minutes, most of it downloads)

1. **Xcode**: it must already be installed (it is on MacinCloud). Open it once
   and let it finish installing its components.
2. **Node.js**, installed just for your user (no admin password). Open
   **Terminal** and run:

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   ```

   Close Terminal, open it again, then:

   ```bash
   nvm install --lts
   ```

   (Already have Node 20 or newer? `node -v` will say. Skip this step.)
3. **Get the project and open it in Xcode:**

   ```bash
   git clone https://github.com/tukotukomi/blue-marble-forecast.git
   cd blue-marble-forecast/app
   npm ci
   npm run ios
   ```

   `npm run ios` builds the app's web files, copies them into the Xcode
   project and opens Xcode. The first time, Xcode spends a minute or two
   fetching Capacitor ("Resolving Package Graph"); wait for it to finish.
4. **Sign in to your Apple developer account**: **Xcode → Settings →
   Accounts → +**, Apple ID. On a shared cloud Mac, sign out again when you're
   done for the day.
5. **Signing**: in the left column click **App** (the blue icon), then the
   **App** target, then **Signing & Capabilities**. Tick **Automatically
   manage signing** and choose your **Team**. The bundle ID should already say
   `com.bluemarbleforecast.app`.

### Try it

- **In the Simulator** (any Mac): at the top of Xcode, pick a device such as
  *iPhone 16*, then press **▶ Run**. To test location, use the Simulator menu
  **Features → Location → Custom Location…**
- **On your iPhone** (only with a Mac you can plug the phone into, not a
  cloud Mac): plug it in, unlock it, trust the computer, pick it at the top
  of Xcode and press **▶ Run**. The first time, iOS asks you to turn on
  **Developer Mode** (Settings → Privacy & Security). On a cloud Mac, go
  straight to TestFlight below to get it on your phone.

Things to check: the location prompt, the globe and radar, search with the
keyboard, Calm View, music, and sending feedback.

### Upload to TestFlight

1. Once only: in [App Store Connect](https://appstoreconnect.apple.com),
   **Apps → + → New App**: iOS, name *Blue Marble Forecast*, bundle ID
   `com.bluemarbleforecast.app`, SKU `bmf-001`. Add the privacy policy URL
   under **App Information**.
2. At the top of Xcode, set the device to **Any iOS Device (arm64)**.
3. **Product → Archive**. When the Organizer window opens: **Distribute App →
   App Store Connect → Upload**, accepting the defaults.
4. After 15–30 minutes the build appears in App Store Connect under
   **TestFlight**. Add yourself under **Internal Testing**, then install it
   with Apple's **TestFlight** app on your iPhone.

The app already tells Apple it uses no special encryption, so there's no
export-compliance question for each build.

### Each new version

```bash
cd blue-marble-forecast
git pull
cd app
npm run sync
```

Then in Xcode raise the **Build** number (App target → General → Identity;
every upload needs a higher one; change **Version** for bigger releases) and
repeat **Product → Archive** above.

## On Windows (no Mac needed)

`npm run sync` and `npm run icons` work here too, and `npx cap add` /
`npx cap sync` can update the Xcode project. Only building and uploading need
the Mac.
